from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from fastapi.staticfiles import StaticFiles
import requests
from typing import Dict, Optional
from datetime import datetime, timezone
import os
import time
import json
import subprocess
import threading
import re
from pathlib import Path

app = FastAPI(title="MediaMTX Controller", description="Standalone Recording & Health API")

# =========================
# CORS
# =========================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# SECURITY HEADERS
# =========================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://unpkg.com; "
            "img-src 'self' data: blob: https://fastapi.tiangolo.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "media-src 'self' blob:; "
            "connect-src 'self'"
        )
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )
        return response

app.add_middleware(SecurityHeadersMiddleware)

# =========================
# CONFIG
# =========================

MTX_BASE = os.getenv("MTX_API", "http://mediamtx:9997")
RECORDINGS_DIR = os.getenv("RECORDINGS_DIR", "/recordings")
CONFIG_FILE = os.getenv("CONFIG_FILE", "/recordings/active_cameras.json")

# =========================
# CLIP EXTRACTION CONFIG
# =========================

VMS_API_URL = os.getenv("VMS_API_URL", "http://14.195.152.244:8006/api/CameraAlert/")
VMS_POLL_INTERVAL = int(os.getenv("VMS_POLL_INTERVAL", "15"))   # seconds
CLIP_BEFORE_SEC = int(os.getenv("CLIP_BEFORE_SEC", "5"))         # seconds before detection
CLIP_AFTER_SEC = int(os.getenv("CLIP_AFTER_SEC", "5"))           # seconds after detection
CLIP_DELAY_SEC = int(os.getenv("CLIP_DELAY_SEC", "6"))           # wait before extracting (so T+5 is recorded)
CLIPS_SUBDIR = "clips"                                             # subfolder inside camera recording dir
PROCESSED_ALERTS_FILE = os.path.join(RECORDINGS_DIR, "processed_face_alerts.json")

# =========================
# 🔥 API VERSION AUTO-DETECT
# =========================

def detect_api():
    """Try v3, v1, v2 endpoints to find which API version MediaMTX supports"""
    for version in ["v3", "v1", "v2"]:
        try:
            r = requests.get(f"{MTX_BASE}/{version}/paths/list", timeout=3)
            if r.status_code == 200:
                return version
        except:
            pass
    return None

API_VERSION = None

def get_api():
    global API_VERSION
    if not API_VERSION:
        API_VERSION = detect_api()
        print(f"🔥 Using MediaMTX API: {API_VERSION}")
    return API_VERSION

def mtx_url(path: str):
    version = get_api()
    if not version:
        raise Exception("MediaMTX API version not detected")
    return f"{MTX_BASE}/{version}{path}"

MTX_HEALTH_API = lambda: mtx_url("/paths/list")

# =========================
# CONFIG FILE
# =========================

def load_config() -> Dict:
    if os.path.exists(CONFIG_FILE):
        # Guard: if Docker created a directory instead of a file, remove it
        if os.path.isdir(CONFIG_FILE):
            print(f"[CONFIG] '{CONFIG_FILE}' is a directory, removing and starting fresh.")
            import shutil
            shutil.rmtree(CONFIG_FILE)
            return {}
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading config: {e}")
    return {}

def save_config(camera_id: str, rtsp_url: str, is_recording: bool):
    # Guard: if path is a directory, remove it first
    if os.path.isdir(CONFIG_FILE):
        import shutil
        shutil.rmtree(CONFIG_FILE)
    config = load_config()
    # Preserve existing RTSP URL if new one is empty
    existing_url = config.get(camera_id, {}).get("rtsp_url", "")
    config[camera_id] = {
        "rtsp_url": rtsp_url if rtsp_url else existing_url,
        "is_recording": is_recording,
        "updated_at": datetime.now().isoformat()
    }
    try:
        # Ensure parent directory exists
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
    except Exception as e:
        print(f"Error saving config: {e}")

def save_full_config(config: Dict):
    """Overwrite the entire config file (used by sync)"""
    if os.path.isdir(CONFIG_FILE):
        import shutil
        shutil.rmtree(CONFIG_FILE)
    try:
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
    except Exception as e:
        print(f"Error saving config: {e}")

def sync_config_from_mtx():
    """Pull live state from MediaMTX and update active_cameras.json dynamically"""
    try:
        # Get all configured paths from MediaMTX
        response = requests.get(mtx_url("/config/paths/list"), timeout=3)
        if response.status_code != 200:
            print("[SYNC] Could not fetch paths from MediaMTX")
            return

        items = response.json().get("items", []) or []
        if not items:
            print("[SYNC] No paths configured in MediaMTX.")
            save_full_config({})
            return

        # Also get live path status
        status_response = requests.get(mtx_url("/paths/list"), timeout=3)
        live_paths = {}
        if status_response.status_code == 200:
            for p in (status_response.json().get("items", []) or []):
                live_paths[p.get("name")] = p

        config = {}
        for item in items:
            cam_id = item.get("name", "")
            if not cam_id:
                continue
            source = item.get("source", "")
            is_recording = item.get("record", False)
            live = live_paths.get(cam_id, {})
            config[cam_id] = {
                "rtsp_url": source,
                "is_recording": is_recording,
                "status": "online" if live.get("ready", False) else "offline",
                "readers": live.get("readersCount", 0),
                "bytes_received": live.get("bytesReceived", 0),
                "updated_at": datetime.now().isoformat()
            }

        save_full_config(config)
        print(f"[SYNC] Config synced from MediaMTX: {len(config)} camera(s)")

    except Exception as e:
        print(f"[SYNC] Error syncing from MediaMTX: {e}")

# =========================
# STARTUP
# =========================

def wait_for_mtx():
    """Wait for MediaMTX to be reachable, then detect API version"""
    global API_VERSION
    print(f"[STARTUP] Connecting to MediaMTX at: {MTX_BASE}")
    for attempt in range(30):
        for version in ["v3", "v1", "v2"]:
            try:
                r = requests.get(f"{MTX_BASE}/{version}/paths/list", timeout=2)
                if r.status_code == 200:
                    API_VERSION = version
                    print(f"✔ MediaMTX Connected (API: {version})")
                    return True
            except:
                pass
        print(f"⚠ Waiting for MediaMTX... (attempt {attempt + 1}/30)")
        time.sleep(2)
    print("❌ MediaMTX not reachable after 30 attempts")
    return False

def call_mtx_with_retry(method, url, **kwargs):
    for i in range(5):
        try:
            return requests.request(method, url, timeout=3, **kwargs)
        except Exception as e:
            print(f"[Retry {i+1}] MediaMTX not ready: {e}")
            time.sleep(2)
    raise Exception("MediaMTX unreachable")

def restore_active_cameras():
    config = load_config()
    if not config:
        print("[RESTORE] No previous configuration found.")
        return

    active = {k: v for k, v in config.items() if v.get("is_recording")}
    if not active:
        print("[RESTORE] No active recordings to restore.")
        return

    print(f"[RESTORE] Restoring {len(active)} active camera(s)...")
    for cam_id, info in active.items():
        rtsp = info.get("rtsp_url", "")
        if not rtsp:
            print(f"  ⚠ Skipping {cam_id} (no RTSP URL saved)")
            continue
        print(f"  → Restoring: {cam_id} ({rtsp})")
        toggle_recording_enhanced(cam_id, True, rtsp)

# =========================
# FACE CLIP EXTRACTION
# =========================

def load_processed_alerts() -> set:
    """Load already-processed alert IDs from disk to survive restarts"""
    if os.path.exists(PROCESSED_ALERTS_FILE):
        try:
            with open(PROCESSED_ALERTS_FILE, "r") as f:
                data = json.load(f)
                return set(data.get("ids", []))
        except Exception as e:
            print(f"[CLIPS] Error loading processed alerts: {e}")
    return set()


def save_processed_alerts(alert_ids: set):
    """Persist processed alert IDs to disk"""
    try:
        os.makedirs(os.path.dirname(PROCESSED_ALERTS_FILE), exist_ok=True)
        with open(PROCESSED_ALERTS_FILE, "w") as f:
            json.dump({"ids": list(alert_ids)}, f)
    except Exception as e:
        print(f"[CLIPS] Error saving processed alerts: {e}")


# In-memory set — loaded from disk at startup
_processed_alert_ids: set = set()


def parse_recording_filename(filename: str):
    """
    Parse MediaMTX recording filename to datetime.
    Expected format: 2026-07-28_06-45-00 (with or without extension)
    Returns datetime object or None.
    """
    name = Path(filename).stem  # strip extension
    match = re.match(r"(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})$", name)
    if match:
        date_part = match.group(1)          # 2026-07-28
        time_part = match.group(2).replace("-", ":")  # 06:45:00
        try:
            return datetime.strptime(f"{date_part} {time_part}", "%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass
    return None


def find_recording_file(camera_name: str, detection_dt: datetime):
    """
    Find the .mp4 recording file that contains the given detection datetime.
    Returns absolute path string or None.
    """
    cam_dir = os.path.join(RECORDINGS_DIR, camera_name)
    if not os.path.isdir(cam_dir):
        print(f"[CLIPS] Camera directory not found: {cam_dir}")
        return None

    candidates = []
    for fname in os.listdir(cam_dir):
        if not fname.endswith(".mp4") and not fname.endswith(".ts"):
            continue
        start_dt = parse_recording_filename(fname)
        if start_dt is None:
            continue
        candidates.append((start_dt, fname))

    if not candidates:
        print(f"[CLIPS] No recording files found in: {cam_dir}")
        return None

    # Sort by start time ascending
    candidates.sort(key=lambda x: x[0])

    # Find the file whose window contains detection_dt
    # Each segment is ~1 hour (recordSegmentDuration: 1h)
    matched_file = None
    for i, (start_dt, fname) in enumerate(candidates):
        # Next file's start = end of current segment
        if i + 1 < len(candidates):
            next_start = candidates[i + 1][0]
        else:
            # Last file — assume 1h window
            from datetime import timedelta
            next_start = start_dt + timedelta(hours=1)

        if start_dt <= detection_dt < next_start:
            matched_file = os.path.join(cam_dir, fname)
            break

    if matched_file:
        print(f"[CLIPS] Found recording: {matched_file}")
    else:
        print(f"[CLIPS] No matching recording file for detection at {detection_dt} in {cam_dir}")

    return matched_file


def extract_clip_ffmpeg(recording_file: str, detection_dt: datetime, alert_id: int, camera_name: str) -> str:
    """
    Extract a clip using FFmpeg: CLIP_BEFORE_SEC before to CLIP_AFTER_SEC after detection.
    Returns output clip path on success, None on failure.
    """
    # Parse recording file start time
    start_dt = parse_recording_filename(os.path.basename(recording_file))
    if start_dt is None:
        print(f"[CLIPS] Could not parse start time from: {recording_file}")
        return None

    # Calculate seek offset (seconds from file start)
    total_offset = (detection_dt - start_dt).total_seconds() - CLIP_BEFORE_SEC
    seek_offset = max(0.0, total_offset)  # clamp to 0 (don't seek before file start)
    duration = CLIP_BEFORE_SEC + CLIP_AFTER_SEC  # total clip duration

    # Ensure clips subfolder exists
    clips_dir = os.path.join(RECORDINGS_DIR, camera_name, CLIPS_SUBDIR)
    os.makedirs(clips_dir, exist_ok=True)

    # Output filename: face_{alert_id}_{YYYYMMDD_HHMMSS}.mp4
    ts_str = detection_dt.strftime("%Y%m%d_%H%M%S")
    out_filename = f"face_{alert_id}_{ts_str}.mp4"
    out_path = os.path.join(clips_dir, out_filename)

    # Build FFmpeg command
    # -ss before -i for fast seeking, -c copy for no re-encode (fastest)
    cmd = [
        "ffmpeg",
        "-y",                        # overwrite output
        "-ss", str(seek_offset),     # seek to offset
        "-i", recording_file,        # input file
        "-t", str(duration),         # clip duration
        "-c", "copy",               # stream copy (no re-encode)
        "-avoid_negative_ts", "make_zero",
        out_path
    ]

    print(f"[CLIPS] Running FFmpeg: offset={seek_offset:.1f}s duration={duration}s → {out_filename}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            size_kb = os.path.getsize(out_path) / 1024
            print(f"[CLIPS] ✅ Clip saved: {out_path} ({size_kb:.1f} KB)")
            return out_path
        else:
            print(f"[CLIPS] ❌ FFmpeg error (code {result.returncode}): {result.stderr[-300:]}")
            return None
    except subprocess.TimeoutExpired:
        print(f"[CLIPS] ❌ FFmpeg timed out for alert {alert_id}")
        return None
    except FileNotFoundError:
        print(f"[CLIPS] ❌ FFmpeg not found! Install ffmpeg in the container.")
        return None
    except Exception as e:
        print(f"[CLIPS] ❌ Unexpected error running FFmpeg: {e}")
        return None


def process_face_alert(alert: dict):
    """
    Handle a single face detection alert:
    - Wait CLIP_DELAY_SEC so the T+5 portion is fully recorded
    - Find the matching recording file
    - Extract the 10-sec clip
    """
    alert_id = alert.get("id")
    camera_name = alert.get("camera_name", "")
    reg_date_str = alert.get("regDate", "")

    print(f"[CLIPS] Processing face alert id={alert_id} camera={camera_name} time={reg_date_str}")

    # Parse regDate and convert to UTC (since MediaMTX records in UTC by default)
    try:
        # e.g., "2026-07-28T12:12:53.605834+05:30" or "2026-07-28T06:42:53Z"
        if reg_date_str.endswith("Z"):
            reg_date_str = reg_date_str[:-1] + "+00:00"
        
        # Parse ISO string with timezone info
        dt = datetime.fromisoformat(reg_date_str)
        
        # Convert to UTC and make it naive so we can compare with recording filenames
        detection_dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        
    except ValueError as e:
        print(f"[CLIPS] ❌ Could not parse regDate '{reg_date_str}': {e}")
        return

    # Wait so that T+5 portion is fully written to disk
    print(f"[CLIPS] Waiting {CLIP_DELAY_SEC}s before extracting clip for alert {alert_id}...")
    time.sleep(CLIP_DELAY_SEC)

    # Find matching recording file
    recording_file = find_recording_file(camera_name, detection_dt)
    if not recording_file:
        print(f"[CLIPS] ⚠ No recording file found for alert {alert_id}, skipping.")
        return

    # Extract clip
    extract_clip_ffmpeg(recording_file, detection_dt, alert_id, camera_name)


def _face_clip_worker(alert: dict):
    """Runs in a separate thread so polling loop is not blocked"""
    try:
        process_face_alert(alert)
    except Exception as e:
        print(f"[CLIPS] Unhandled error in clip worker: {e}")


def poll_vms_for_face_alerts():
    """
    Background polling loop:
    - Hits VMS CameraAlert API every VMS_POLL_INTERVAL seconds
    - Filters FaceAnalysis alerts only
    - Spawns a thread per new alert to extract clip
    """
    global _processed_alert_ids
    print(f"[CLIPS] 🚀 VMS polling started (interval={VMS_POLL_INTERVAL}s, url={VMS_API_URL})")

    while True:
        try:
            # Fetch latest alerts (first page — newest alerts come first)
            resp = requests.get(
                VMS_API_URL,
                params={"page": 1},
                timeout=10
            )
            if resp.status_code != 200:
                print(f"[CLIPS] VMS API returned {resp.status_code}, retrying later.")
            else:
                alerts = resp.json().get("results", [])
                new_count = 0
                for alert in alerts:
                    alert_id = alert.get("id")
                    object_name = alert.get("objectName", "")

                    # Only process FaceAnalysis alerts
                    if "FaceAnalysis" not in str(object_name):
                        continue

                    # Skip already processed
                    if alert_id in _processed_alert_ids:
                        continue

                    # Mark as processed immediately to avoid duplicate processing
                    _processed_alert_ids.add(alert_id)
                    save_processed_alerts(_processed_alert_ids)
                    new_count += 1

                    # Spawn a thread per alert (non-blocking)
                    t = threading.Thread(
                        target=_face_clip_worker,
                        args=(alert,),
                        daemon=True,
                        name=f"clip-worker-{alert_id}"
                    )
                    t.start()

                if new_count:
                    print(f"[CLIPS] Found {new_count} new face alert(s), spawning clip workers.")

        except requests.exceptions.RequestException as e:
            print(f"[CLIPS] VMS API unreachable: {e}")
        except Exception as e:
            print(f"[CLIPS] Unexpected polling error: {e}")

        time.sleep(VMS_POLL_INTERVAL)


def start_clip_polling_thread():
    """Load persisted alert IDs and start background polling thread"""
    global _processed_alert_ids
    _processed_alert_ids = load_processed_alerts()
    print(f"[CLIPS] Loaded {len(_processed_alert_ids)} previously processed alert IDs.")

    t = threading.Thread(
        target=poll_vms_for_face_alerts,
        daemon=True,
        name="vms-face-alert-poller"
    )
    t.start()
    print("[CLIPS] Background polling thread started.")


@app.on_event("startup")
def startup_event():
    """Runs when uvicorn starts the app (since __main__ block doesn't execute)"""
    print("[STARTUP] Waiting for MediaMTX...")
    if wait_for_mtx():
        # First try to restore from saved config
        restore_active_cameras()
        # Then sync live state from MediaMTX → config file
        sync_config_from_mtx()

    # Start face detection clip extraction polling (independent of MediaMTX)
    start_clip_polling_thread()

# =========================
# RECORDING CONTROL
# =========================

def toggle_recording_enhanced(camera_id: str, enable: bool, rtsp_url: str = None) -> bool:
    try:
        get_url = mtx_url(f"/config/paths/get/{camera_id}")
        response_check = call_mtx_with_retry("GET", get_url)

        if response_check.status_code == 404 and enable:
            if not rtsp_url:
                print(f"Error: No RTSP URL for {camera_id}")
                return False

            print(f"Creating new path: {camera_id}")

            add_url = mtx_url(f"/config/paths/add/{camera_id}")
            response = call_mtx_with_retry(
                "POST",
                add_url,
                json={"source": rtsp_url, "record": True}
            )

        else:
            payload = {"record": enable}
            if rtsp_url:
                payload["source"] = rtsp_url

            patch_url = mtx_url(f"/config/paths/patch/{camera_id}")
            response = call_mtx_with_retry(
                "PATCH",
                patch_url,
                json=payload
            )

        if response.status_code in [200, 201, 204]:
            print(f"Recording {'started' if enable else 'stopped'}: {camera_id}")
            save_config(camera_id, rtsp_url or "", enable)
            return True

        print(f"MediaMTX error: {response.status_code} {response.text}")
        return False

    except Exception as e:
        print(f"Error communicating with MediaMTX: {e}")
        return False

# =========================
# API ROUTES
# =========================

@app.post("/api/v1/record/start/{camera_id}")
async def start_camera_recording(camera_id: str, rtsp_url: str = None):
    if toggle_recording_enhanced(camera_id, True, rtsp_url):
        return {"status": "success", "message": f"Recording started for {camera_id}", "timestamp": datetime.now().isoformat()}
    raise HTTPException(status_code=502, detail="Failed to communicate with MediaMTX")

@app.post("/api/v1/record/stop/{camera_id}")
async def stop_camera_recording(camera_id: str):
    if toggle_recording_enhanced(camera_id, False):
        return {"status": "success", "message": f"Recording stopped for {camera_id}", "timestamp": datetime.now().isoformat()}
    raise HTTPException(status_code=502, detail="Failed to communicate with MediaMTX")

# =========================
# CAMERAS (LIVE STATUS)
# =========================

@app.get("/api/v1/cameras")
async def get_cameras():
    """Returns live camera status, dynamically fetched from MediaMTX"""
    try:
        # Sync config from MediaMTX first
        sync_config_from_mtx()
        config = load_config()
        cameras = []
        for cam_id, info in config.items():
            cameras.append({
                "camera_id": cam_id,
                "rtsp_url": info.get("rtsp_url", ""),
                "is_recording": info.get("is_recording", False),
                "status": info.get("status", "unknown"),
                "readers": info.get("readers", 0),
                "bytes_received": info.get("bytes_received", 0),
                "updated_at": info.get("updated_at", "")
            })
        return {"total": len(cameras), "cameras": cameras}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =========================
# RECORDINGS
# =========================

if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)

app.mount("/recordings", StaticFiles(directory=RECORDINGS_DIR), name="recordings")

@app.get("/api/v1/recordings")
async def get_recordings(camera_id: Optional[str] = None):
    try:
        if not os.path.exists(RECORDINGS_DIR):
            return {"total": 0, "recordings": []}

        recordings = []

        for cam_dir in sorted(os.listdir(RECORDINGS_DIR)):
            cam_path = os.path.join(RECORDINGS_DIR, cam_dir)
            if os.path.isdir(cam_path):
                for file in sorted(os.listdir(cam_path), reverse=True):
                    file_path = os.path.join(cam_path, file)
                    if os.path.isfile(file_path):
                        recordings.append({
                            "fileName": file,
                            "fileUrl": f"/recordings/{cam_dir}/{file}",
                            "camera_id": cam_dir
                        })

        return {"total": len(recordings), "recordings": recordings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =========================
# FACE DETECTION CLIPS
# =========================

@app.get("/api/v1/clips")
async def get_face_clips(camera_id: Optional[str] = None):
    """List all auto-generated face detection clips"""
    try:
        result = []
        scan_dirs = []

        if camera_id:
            cam_path = os.path.join(RECORDINGS_DIR, camera_id)
            if os.path.isdir(cam_path):
                scan_dirs.append((camera_id, cam_path))
        else:
            for entry in sorted(os.listdir(RECORDINGS_DIR)):
                cam_path = os.path.join(RECORDINGS_DIR, entry)
                if os.path.isdir(cam_path) and entry != CLIPS_SUBDIR:
                    scan_dirs.append((entry, cam_path))

        for cam_name, cam_path in scan_dirs:
            clips_dir = os.path.join(cam_path, CLIPS_SUBDIR)
            if not os.path.isdir(clips_dir):
                continue
            for fname in sorted(os.listdir(clips_dir), reverse=True):
                if fname.endswith(".mp4"):
                    fpath = os.path.join(clips_dir, fname)
                    result.append({
                        "fileName": fname,
                        "fileUrl": f"/recordings/{cam_name}/{CLIPS_SUBDIR}/{fname}",
                        "camera_id": cam_name,
                        "sizeKB": round(os.path.getsize(fpath) / 1024, 1),
                        "createdAt": datetime.fromtimestamp(os.path.getctime(fpath)).isoformat()
                    })

        return {"total": len(result), "clips": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/clips/status")
async def get_clip_extraction_status():
    """Show how many face alerts have been processed so far"""
    return {
        "processed_alert_count": len(_processed_alert_ids),
        "poll_interval_sec": VMS_POLL_INTERVAL,
        "clip_window_sec": CLIP_BEFORE_SEC + CLIP_AFTER_SEC,
        "vms_api_url": VMS_API_URL
    }

# =========================
# HEALTH
# =========================

@app.get("/api/v1/health")
async def get_system_health():
    try:
        response_health = requests.get(MTX_HEALTH_API(), timeout=3)
        response_config = requests.get(mtx_url("/config/paths/list"), timeout=3)

        if response_health.status_code != 200 or response_config.status_code != 200:
            raise HTTPException(status_code=502, detail="MediaMTX error")

        active_paths = response_health.json().get("items", []) or []
        configs = {}
        for item in (response_config.json().get("items", []) or []):
            configs[item.get("name")] = item

        cameras = []
        for path in active_paths:
            cam_name = path.get("name")
            conf = configs.get(cam_name, {})
            cameras.append({
                "id": cam_name,
                "status": "online" if path.get("ready", False) else "offline",
                "is_recording": conf.get("record", False),
                "source": conf.get("source", "unknown"),
                "readers": path.get("readersCount", 0),
                "bytes_received": path.get("bytesReceived", 0),
            })

        return {
            "status": "ok",
            "timestamp": datetime.now().isoformat(),
            "mtx_api": MTX_BASE,
            "total_cameras": len(cameras),
            "cameras": cameras
        }

    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="MediaMTX unreachable")

# =========================
# RUN
# =========================

if __name__ == "__main__":
    import uvicorn
    if wait_for_mtx():
        restore_active_cameras()

    uvicorn.run(app, host="0.0.0.0", port=8001)