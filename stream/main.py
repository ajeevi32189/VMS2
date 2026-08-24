from fastapi import FastAPI, HTTPException, Response, Request
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
import requests
from fastapi.middleware.cors import CORSMiddleware
import yaml
import os
import socket
from urllib.parse import urlparse
import re
import sqlite3
import asyncio
from datetime import datetime, timedelta
app = FastAPI()
import httpx
import logging

# Professional Logger Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("VMS_AUTO_SYNC")
# Connection reuse ke liye global client

@app.on_event("shutdown")
async def shutdown_event():
    # Memory leaks rokne ke liye client close karna zaroori hai
    await shared_client.aclose()
    logger.info("Shared AsyncClient closed.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Security Headers Middleware ───────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    # CSP for Swagger UI docs (needs CDN resources)
    DOCS_CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
        "img-src 'self' data: fastapi.tiangolo.com cdn.jsdelivr.net; "
        "connect-src 'self';"
    )
    # Strict CSP for all API endpoints
    API_CSP = "default-src 'none'; frame-ancestors 'none';"

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        is_docs = request.url.path in ("/docs", "/redoc", "/openapi.json")

        # Security headers for API and Docs
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()"
        response.headers["Content-Security-Policy"] = self.DOCS_CSP if is_docs else self.API_CSP
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"

        return response

app.add_middleware(SecurityHeadersMiddleware)

# ✅ ENV BASED (no static IP)
GO2RTC_URL = os.getenv("GO2RTC_URL", "http://go2rtc:1984")

# ✅ Public URL (for HLS response)
GO2RTC_PUBLIC_URL = os.getenv("GO2RTC_PUBLIC_URL", "http://localhost:1984")

# ✅ /config is the mount point inside Docker container
CONFIG_PATH = "/config/go2rtc.yaml"
DB_PATH = "/config/uptime.db"  # Uptime tracker DB
camera_display_names = {}  # Ye memory mein labels hold karega
class CameraRequest(BaseModel):
    id: str
    rtspurl: str
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # History for Uptime (Hourly/Daily)
    c.execute('''CREATE TABLE IF NOT EXISTS uptime_log
                 (camera_id TEXT, timestamp DATETIME, is_online INTEGER, is_active INTEGER)''')
    # Current Stats for Dashboard
    c.execute('''CREATE TABLE IF NOT EXISTS current_stats
                 (camera_id TEXT PRIMARY KEY, latency REAL, last_updated DATETIME)''')
    conn.commit()
    conn.close()
async def poll_uptime():
    while True:
        config = read_config()
        cameras = config.get("streams", {})
        if not cameras:
            await asyncio.sleep(60)
            continue

        try:
            # 🔥 still needed for status (producers/consumers)
            resp = await shared_client.get(f"{GO2RTC_URL}/api/streams")
            go2rtc_data = resp.json() if resp.status_code == 200 else {}

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            now = datetime.now()

            for cam_id in cameras.keys():

                # =========================
                # STATUS LOGIC (same as before)
                # =========================
                stream_info = go2rtc_data.get(cam_id, {})
                is_online = 1 if stream_info.get("producers") else 0
                is_active = 1 if stream_info.get("consumers") else 0

                # =========================
                # SAVE TO DB
                # =========================
                c.execute(
                    "INSERT INTO uptime_log VALUES (?, ?, ?, ?)",
                    (cam_id, now, is_online, is_active)
                )

            conn.commit()
            conn.close()

        except Exception as e:
            logger.error(f"Polling error: {e}")

        await asyncio.sleep(60)
async def poll_latency():
    while True:
        config = read_config()
        cameras = config.get("streams", {})
        if not cameras:
            await asyncio.sleep(5)
            continue
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        for cam_id in cameras.keys():
            try:
                start = datetime.now()
                # Frame request is good for real latency
                await shared_client.get(f"{GO2RTC_URL}/api/frame.jpeg?src={cam_id}", timeout=5)
                ms = (datetime.now() - start).total_seconds() * 1000
                
                c.execute("INSERT OR REPLACE INTO current_stats (camera_id, latency, last_updated) VALUES (?, ?, ?)",
                          (cam_id, ms, datetime.now()))
            except:
                c.execute("INSERT OR REPLACE INTO current_stats (camera_id, latency, last_updated) VALUES (?, ?, ?)",
                          (cam_id, None, datetime.now()))
        
        conn.commit()
        conn.close()
        await asyncio.sleep(5) # 5 sec is good for live feel      
def get_camera_metrics(cam_id: str):
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        cutoff = datetime.now() - timedelta(hours=24)
        c.execute(
            "SELECT * FROM uptime_log WHERE camera_id = ? AND timestamp > ? ORDER BY timestamp ASC",
            (cam_id, cutoff.strftime('%Y-%m-%d %H:%M:%S'))
        )
        rows = c.fetchall()
        
        c.execute("SELECT latency, last_updated FROM current_stats WHERE camera_id = ?", (cam_id,))
        live_lat = c.fetchone()
    finally:
        if conn:
            conn.close()

    total_active_sec = 0
    total_down_sec = 0
    
    for i in range(len(rows) - 1):
        try:
            t1 = datetime.fromisoformat(rows[i]['timestamp'])
            t2 = datetime.fromisoformat(rows[i+1]['timestamp'])
            diff = (t2 - t1).total_seconds()
            if diff < 150:
                if rows[i]['is_online'] == 1:
                    total_active_sec += diff
                if rows[i]['is_online'] == 0:
                    total_down_sec += diff
        except Exception as e:
            logger.error(f"Row parse error for {cam_id}: {e}")
            continue

    latency_status = "N/A"
    if live_lat:
        try:
            lat_val = live_lat["latency"]
            last_upd = live_lat["last_updated"]
            if lat_val is not None and last_upd is not None:
                last_updated = datetime.fromisoformat(str(last_upd))
                if (datetime.now() - last_updated).total_seconds() > 30:
                    latency_status = "STALE"
                else:
                    latency_status = f"{round(float(lat_val), 1)}ms"
        except Exception as e:
            logger.error(f"Latency parse error for {cam_id}: {e}")
            latency_status = "N/A"

    return {
        "uptime_active": f"{int(total_active_sec // 3600)}h {int((total_active_sec % 3600) // 60)}m",
        "total_downtime": f"{int(total_down_sec // 3600)}h {int((total_down_sec % 3600) // 60)}m",
        "latency": latency_status
    }
@app.on_event("startup")
async def startup_event():
    init_db()
    # 1. Background task: Django se cameras sync karega (Loop mein)
    asyncio.create_task(sync_cameras_from_django())
    # 2. Background task: Uptime logs record karega
    asyncio.create_task(poll_uptime())
    asyncio.create_task(poll_latency()) 
def get_24h_uptime(cam_id: str) -> str:
    """Calculates actual duration between pings with edge-case handling"""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        cutoff = datetime.now() - timedelta(hours=24)
        c.execute("""
            SELECT timestamp, is_online FROM uptime_log 
            WHERE camera_id = ? AND timestamp > ?
            ORDER BY timestamp ASC
        """, (cam_id, cutoff.strftime('%Y-%m-%d %H:%M:%S')))
        
        rows = c.fetchall()
        conn.close()

        if not rows:
            return "0h 0m"

        total_uptime_seconds = 0
        now = datetime.now()
        
        # Loop for intervals between records
        for i in range(len(rows) - 1):
            curr_row = rows[i]
            next_row = rows[i+1]
            
            if curr_row['is_online'] == 1:
                t1 = datetime.fromisoformat(curr_row['timestamp'])
                t2 = datetime.fromisoformat(next_row['timestamp'])
                
                duration = (t2 - t1).total_seconds()
                
                # Logic: Agar gap 2x polling interval (120s) se kam hai, toh uptime jodo
                if duration < 120: 
                    total_uptime_seconds += duration

        # 🔥 FIX: Handle the last segment (Last record to "Now")
        last_row = rows[-1]
        if last_row['is_online'] == 1:
            last_time = datetime.fromisoformat(last_row['timestamp'])
            last_segment = (now - last_time).total_seconds()
            
            # Agar last ping pichle 2 min ke andar tha, toh use active maano
            if last_segment < 120:
                total_uptime_seconds += last_segment

        hours = int(total_uptime_seconds // 3600)
        minutes = int((total_uptime_seconds % 3600) // 60)
        
        return f"{hours}h {minutes}m"
    except Exception as e:
        print(f"Uptime Final Error: {e}")
        return "0h 0m"

def read_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        return {"streams": {}}
    with open(CONFIG_PATH, "r") as f:
        content = f.read().strip()
    if not content:
        return {"streams": {}}
    try:
        data = yaml.safe_load(content)
        if not isinstance(data, dict):
            return {"streams": {}}
        if data.get("streams") is None:
            data["streams"] = {}
        for k, v in data["streams"].items():
            if isinstance(v, str):
                data["streams"][k] = [v]
        return data
    except Exception as e:
        print(f"YAML read error: {e}")
        return {"streams": {}}

# 1. Global client taaki baar-baar connection na banana pade
shared_client = httpx.AsyncClient()

async def sync_cameras_from_django():
    django_url = os.getenv("DJANGO_API_URL", "http://14.195.152.244:8006/api/camera_status/")
    
    while True:
        logger.info("Checking Django for camera updates...")
        try:
            resp = await shared_client.get(django_url, timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                cameras = data.get("results", [])
                
                config = read_config()
                existing_streams = config.get("streams", {})
                existing_ids = set(existing_streams.keys())
                incoming_ids = set()
                config_changed = False

                for cam in cameras:
                    cam_id = f"cam_{cam.get('id')}"
                    incoming_ids.add(cam_id)
                    camera_display_names[cam_id] = cam.get("name") or cam.get("camera_name") or cam_id
                    rtsp_url = cam.get("rtspurl")
                    if not rtsp_url: continue
                    
                    # 🔥 Use native RTSP for video (fast snapshots) and FFmpeg ONLY for AAC audio track
                    clean_url = rtsp_url.replace('#ffmpeg', '')
                    src_list = [clean_url, f"ffmpeg:{cam_id}#audio=aac"]

                    # SCENARIO: ADD ya UPDATE (RTSP badla toh bhi update hoga)
                    if cam_id not in existing_ids or existing_streams.get(cam_id) != src_list:
                        logger.info(f"Syncing camera: {cam_id}")
                        await shared_client.put(f"{GO2RTC_URL}/api/streams", params=[("name", cam_id), ("src", src_list[0]), ("src", src_list[1])])
                        config["streams"][cam_id] = src_list
                        config_changed = True

                # 🔥 Disabled auto-deletion in background to prevent accidental stream loss
                # Deletions will only happen explicitly when /remove-camera/{id} is called.
                pass

                # Batch Restart: Sirf tab jab koi badlav hua ho
                if config_changed:
                    write_config(config)
                    await shared_client.post(f"{GO2RTC_URL}/api/restart")
                    logger.info("Batch update complete. go2rtc restarted.")

        except Exception as e:
            logger.error(f"Sync Loop Error: {e}")
        
        await asyncio.sleep(60)
def write_config(data: dict):
    with open(CONFIG_PATH, "w") as f:
        if not data.get("streams"):
            f.write("streams:\n")
        else:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

def ping_camera(cam_id: str) -> bool:
    """
    Real NVR Check: go2rtc ko bolta hai us specific channel ka ek frame (photo) laao.
    Agar frame successfully aa gaya, matlab camera ON hai. Nahi aaya toh OFF.
    """
    try:
        url = f"{GO2RTC_URL}/api/frame.jpeg?src={cam_id}"
        # 3 second ka wait karega, nahi aaya toh false
        resp = requests.get(url, timeout=3)
        return resp.status_code == 200
    except Exception:
        return False

@app.post("/add-camera")
def add_camera(cam: CameraRequest):
    try:
        # 🔥 Use native RTSP for video (fast snapshots) and FFmpeg ONLY for AAC audio track
        clean_url = cam.rtspurl.replace('#ffmpeg', '')
        src_list = [clean_url, f"ffmpeg:{cam.id}#audio=aac"]
        
        resp = requests.put(
            f"{GO2RTC_URL}/api/streams",
            params=[("name", cam.id), ("src", src_list[0]), ("src", src_list[1])],
            timeout=5
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"go2rtc error: {resp.text}")

        config = read_config()
        config["streams"][cam.id] = src_list
        write_config(config)

        return {
            "camera_id": cam.id,
            "hls_url": f"{GO2RTC_PUBLIC_URL}/api/stream.m3u8?src={cam.id}&mp4",
            "message": "Camera added successfully"
        }
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=500, detail="go2rtc not reachable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/remove-camera/{id}")
def remove_camera(id: str):
    try:
        config = read_config()
        if id not in config.get("streams", {}):
            return {"message": f"{id} not found in config"}

        del config["streams"][id]
        write_config(config)

        requests.delete(
            f"{GO2RTC_URL}/api/streams",
            params={"name": id},
            timeout=5
        )
        requests.post(f"{GO2RTC_URL}/api/restart", timeout=5)

        return {"message": f"{id} deleted permanently"}
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=500, detail="go2rtc not reachable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/stop/{id}")
def stop_stream(id: str):
    try:
        # 1️⃣ Stop all active consumers (HLS / UI playback)
        stop_resp = requests.post(
            f"{GO2RTC_URL}/api/stop",
            params={"src": id},
            timeout=5
        )

        # 2️⃣ (Optional but important) small cleanup delay logic
        # ensures no stale sessions remain
        return {
            "camera_id": id,
            "message": "Stream stopped successfully",
            "go2rtc_response": stop_resp.text
        }

    except requests.exceptions.RequestException:
        raise HTTPException(status_code=500, detail="go2rtc not reachable")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stream-status/{id}")
def stream_status(id: str):
    try:
        resp = requests.get(f"{GO2RTC_URL}/api/streams", timeout=5)
        data = resp.json()

        is_running = id in data

        return {"id": id, "isStreaming": is_running}
    except:
        return {"id": id, "isStreaming": False}

@app.get("/active-streams")
def active_streams():
    try:
        resp = requests.get(f"{GO2RTC_URL}/api/streams", timeout=5)
        return resp.json()
    except:
        return {}        
    
@app.get("/get-stream/{id}")
def get_stream(id: str):
    return {"hls_url": f"{GO2RTC_PUBLIC_URL}/api/stream.m3u8?src={id}&mp4"}


@app.get("/cameras")
def list_cameras():
    config = read_config()
    return {"cameras": list(config.get("streams", {}).keys())}


# ================= DETAILED STATS ENDPOINT (FPS & STATUS) =================
@app.get("/camera-stats/{id}")
def get_camera_stats(id: str):
    metrics = get_camera_metrics(id)

    stats = {
    "id": id,
    "status": "Offline",
    "is_active": False,
    "hardware_fps": 0.0,
    "uptime_active": metrics["uptime_active"],   # ✅ MAIN CHANGE
    "total_downtime": metrics["total_downtime"], # ✅ add this
    "latency": metrics["latency"]                # ✅ add this
}
    
    try:
        config = read_config()
        if id not in config.get("streams", {}):
            return stats 

        # go2rtc API call
        resp = requests.get(f"{GO2RTC_URL}/api/streams?src={id}", timeout=2)
        if resp.status_code == 200:
            full_data = resp.json()
            
            # FIXED: API Parsing Logic
            # /api/streams?src=id returns the object directly, NOT {id: {...}}
            if "producers" in full_data:
                stream_info = full_data
            else:
                stream_info = full_data.get(id, {})

            producers = stream_info.get("producers", [])
            consumers = stream_info.get("consumers", [])

            # Status Check
            if producers:
                stats["status"] = "Online"
                # FPS logic
                sdp = producers[0].get("sdp", "")
                fps_match = re.search(r'a=framerate:([0-9.]+)', sdp)
                if fps_match:
                    stats["hardware_fps"] = round(float(fps_match.group(1)), 2)

            # Simplified Active Logic (No misleading receivers)
            stats["is_active"] = len(consumers) > 0 if consumers else False
                        
        return stats
    except Exception:
        return stats
# ================= FIXED: SNAPSHOT =================
# Purane wale @app.get("/snapshot/{id}") ko isse replace kar dein:
@app.get("/snapshot/{id}")
def snapshot(id: str):
    try:
        url = f"{GO2RTC_URL}/api/frame.jpeg?src={id}"
        resp = requests.get(url, timeout=10)
        
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail="Snapshot failed or camera is offline")

        return Response(content=resp.content, media_type="image/jpeg")

    except requests.exceptions.RequestException:
        raise HTTPException(status_code=500, detail="go2rtc not reachable")
@app.get("/all-camera-stats")
def get_all_camera_stats():
    """Enterprise-grade: All stats in one single call"""
    try:
        config = read_config()
        cameras = config.get("streams", {})
        
        # Ek hi baar go2rtc hit karo
        resp = requests.get(f"{GO2RTC_URL}/api/streams", timeout=3)
        go2rtc_data = resp.json() if resp.status_code == 200 else {}
        
        results = []
        for cam_id in cameras.keys():
            try:
                # go2rtc returns { "cam_id": { ... } } in bulk mode
                stream_info = go2rtc_data.get(cam_id, {})
                producers = stream_info.get("producers", [])
                consumers = stream_info.get("consumers", [])
                
                # Simple & Correct logic as per audit
                status = "Online" if producers else "Offline"
                is_active = len(consumers) > 0 if consumers else False
                
                # Hardware FPS extraction
                hw_fps = 0.0
                if producers:
                    sdp = producers[0].get("sdp", "")
                    fps_match = re.search(r'a=framerate:([0-9.]+)', sdp)
                    if fps_match:
                        hw_fps = round(float(fps_match.group(1)), 2)
                metrics = get_camera_metrics(cam_id)
                results.append({
                    "id": cam_id,
                    "display_name": camera_display_names.get(cam_id, cam_id),
                    "status": status,
                    "is_active": is_active,
                    "hardware_fps": hw_fps,
                    "uptime_active": metrics["uptime_active"], # Uptime
                    "total_downtime": metrics["total_downtime"], # Global Downtime
                    "latency": metrics["latency"]
                })
            except Exception as e:
                logger.error(f"Stats error for {cam_id}: {e}")
                results.append({
                    "id": cam_id,
                    "display_name": camera_display_names.get(cam_id, cam_id),
                    "status": "Error",
                    "is_active": False,
                    "hardware_fps": 0.0,
                    "uptime_active": "N/A",
                    "total_downtime": "N/A",
                    "latency": "N/A"
                })
            
        return results
    except Exception as e:
        return {"error": str(e)}
@app.post("/sync-cameras")
async def manual_sync_trigger():
    """Frontend se trigger hone wala manual sync"""
    await sync_cameras_from_django()
    return {"message": "Sync process triggered. Check logs for details."}    
@app.get("/health")
def health():
    return {"status": "ok"}