import requests
from django.db.models import Q
import os
import base64
import io
from PIL import Image
from django.utils import timezone
from datetime import timedelta

from .models import Location, Cameras, Cameraalerts, Cameragodownmapping

# External endpoints
ICCC_API_BASE = os.getenv('ICCC_API', 'https://co2ph3master.ajeevi.in')
LOCATION_SUMMARY_URL = f"{ICCC_API_BASE}/api/camera-summary"
ALERT_DETAILS_URL = f"{ICCC_API_BASE}/api/camera-alerts"


def compress_image_to_base64(image_bytes, max_size=(800, 600), quality=70):
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Resize preserving aspect ratio (thumbnail uses ANTIALIAS/LANCZOS automatically)
        img.thumbnail(max_size)
        
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", optimize=True, quality=quality)
        return base64.b64encode(buffer.getvalue()).decode('utf-8')
    except Exception as e:
        print(f"[WARN] Image compression failed: {e}. Sending uncompressed.")
        return base64.b64encode(image_bytes).decode('utf-8')


def build_location_payloads(user_id=None):
    locations = Location.objects.all()
    if user_id:
        locations = locations.filter(userid=user_id)

    since = timezone.now() - timedelta(days=1)

    results = []
    for loc in locations:
        camera_count = Cameras.objects.filter(location=loc.id).count()

        fire_count = Cameraalerts.objects.filter(
            cameraId__location=loc.id,
            objectName__icontains='fire',
            regDate__gte=since,
        ).count()

        smoke_count = Cameraalerts.objects.filter(
            cameraId__location=loc.id,
            objectName__icontains='smoke',
            regDate__gte=since,
        ).count()

        rodant_count = Cameraalerts.objects.filter(
            cameraId__location=loc.id,
            regDate__gte=since,
        ).filter(Q(objectName__icontains='rodant') | Q(objectName__icontains='rodent')).count()

        results.append({
            "locationName": loc.name or "",
            "state": loc.state or "",
            "city": loc.city or "",
            "pinCode": loc.pincode or "",
            "cameraCount": camera_count,
            "fireCount": fire_count,
            "smokeCount": smoke_count,
            "rodantCount": rodant_count,
        })

    return results


def post_location_summaries(user_id=None):
    payloads = build_location_payloads(user_id)
    headers = {"Content-Type": "application/json"}

    for payload in payloads:
        try:
            resp = requests.post(LOCATION_SUMMARY_URL, json=payload, headers=headers, timeout=15)
            resp.raise_for_status()
            print(f"Posted summary for '{payload.get('locationName')}' -> {resp.status_code}")
        except Exception as e:
            print(f"Failed to post summary for '{payload.get('locationName')}': {e}")


def build_alert_payloads(user_id=None):
    """Build alert details for alerts in the last 24 hours using timezone-aware filtering."""
    # Get current time in configured timezone (Asia/Kolkata +05:30)
    current_time = timezone.now()
    since = current_time - timedelta(hours=24)
    
    print(f"[AlertPayload] Current time (with TZ): {current_time.isoformat()}")
    print(f"[AlertPayload] Filtering alerts from: {since.isoformat()}")
    print(f"[AlertPayload] Filtering alerts until: {current_time.isoformat()}")
    
    # Get alerts from last 24 hours with camera pre-fetched
    alerts = Cameraalerts.objects.filter(regDate__gte=since, regDate__lte=current_time).select_related('cameraId').order_by('-regDate')
    
    if user_id:
        alerts = alerts.filter(userid=user_id)

    # Extract all unique location and camera IDs for bulk loading
    location_ids = set()
    camera_ids = set()
    
    for alert in alerts:
        if alert.cameraId:
            camera_ids.add(alert.cameraId.id)
            if alert.cameraId.location:
                location_ids.add(alert.cameraId.location)
    
    # Bulk load locations
    locations_map = {}
    if location_ids:
        locations = Location.objects.filter(id__in=location_ids).values('id', 'name', 'state', 'city', 'pincode')
        locations_map = {loc['id']: loc for loc in locations}
    
    # Bulk load mappings
    mappings_map = {}
    if camera_ids:
        mappings = Cameragodownmapping.objects.filter(cameraId__in=camera_ids).select_related('godownId', 'columnId').values(
            'cameraId', 'godownId__name', 'columnId__name'
        )
        mappings_map = {m['cameraId']: m for m in mappings}

    results = []

    for alert in alerts:
        camera = alert.cameraId
        if not camera:
            continue

        # Get location info from pre-fetched map
        location = locations_map.get(camera.location) if camera.location else None

        # Get godown and column mapping from pre-fetched map
        mapping = mappings_map.get(camera.id)
        
        # Build image URL
        image_url = ""
        if alert.framePath:
            base_url = os.getenv('VMS_IMAGE_BASE_URL', 'http://14.195.152.244:9006')
            path = alert.framePath
            # framePath in DB = /app/media/... but Django serves at /media/
            if path.startswith('/app/'):
                path = path[4:]   # /app/media/... → /media/...
            image_url = f"{base_url}{path}"

        results.append({
            "cameraIP": str(camera.cameraIP) or "",
            "cameraName": str(camera.name) or "",
            "locationName": str(location['name']) if location else "",
            "shadName": str(mapping['godownId__name']) if mapping else "",
            "columnName": str(mapping['columnId__name']) if mapping else "",
            "state": str(location['state']) if location else "",
            "pinCode": str(location['pincode']) if location else "",
            "city": str(location['city']) if location else "",
            "cameraId": str(camera.id),
            "imagePath": image_url,
            "imageBase64": "",
            "framePath": str(alert.framePath) if alert.framePath else "",
            "alertType": str(alert.objectName) or "",
            "alertDateTime": str(alert.regDate.isoformat()) if alert.regDate else "",
        })

    return results


def post_alert_details(user_id=None):
    """Post alert details for last 24 hours to external API as JSON (server returns 415 on multipart)."""
    payloads = build_alert_payloads(user_id)

    total_alerts = len(payloads)
    if total_alerts == 0:
        print("No alerts to post")
        return

    print(f"Posting {total_alerts} alerts as application/json...")
    headers = {"Content-Type": "application/json"}

    for i, payload in enumerate(payloads):
        frame_path = payload.pop('framePath', '')
        # Hum image_url dictionary mein bhej rahe hain, par image actual folder se padhenge
        image_url = payload.get('imagePath', '')

        if frame_path and os.path.exists(frame_path):
            try:
                with open(frame_path, 'rb') as f:
                    image_bytes = f.read()
                payload['imageBase64'] = compress_image_to_base64(image_bytes)
                print(f"[OK] base64 image read directly from volume & compressed for '{payload.get('cameraName')}'")
            except Exception as e:
                print(f"[ERROR] reading local image {frame_path}: {e}")
                payload['imageBase64'] = ""
        else:
            if frame_path:
                print(f"[WARN] local image file not found on volume: {frame_path}")
            payload['imageBase64'] = ""

        try:
            resp = requests.post(ALERT_DETAILS_URL, json=payload, headers=headers, timeout=15)
            resp.raise_for_status()
            print(f"Posted alert for camera '{payload.get('cameraName')}' (ID: {payload.get('cameraId')}) -> {resp.status_code}")
        except requests.exceptions.RequestException as e:
            error_msg = f"Failed to post alert for camera '{payload.get('cameraName')}': {e}"
            if getattr(e, 'response', None) is not None:
                error_msg += f"\nResponse Body: {e.response.text}"
            print(error_msg)

        if (i + 1) % 10 == 0:
            print(f"Processed batch: {min(i + 1, total_alerts)}/{total_alerts} alerts")


def post_all_data(user_id=None):
    """Post both location summaries and alert details."""
    print("Posting location summaries...")
    post_location_summaries(user_id)
    print("Posting alert details...")
    post_alert_details(user_id)
    print("Data posting completed.")