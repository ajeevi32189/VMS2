"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  Detection/intrusion.py                                                      ║
║  ROI-Based Intrusion Detection — YOLOv8 Person Detection + Priority Zones    ║
║                                                                              ║
║  Detector class that plugs into consumer.py's MODEL_DISPATCH pattern.        ║
║  detect() returns:                                                            ║
║    {                                                                          ║
║      "HIGH Intrusion":   <int>,   # only if alert fired                       ║
║      "MEDIUM Intrusion": <int>,   # only if alert fired                       ║
║      "LOW Intrusion":    <int>,   # only if alert fired                       ║
║      "frame":            <annotated BGR numpy array>                          ║
║    }                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""
from __future__ import annotations

import os
import time
import logging
import threading
import datetime
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
import requests

log = logging.getLogger("IntrusionDetector")


# ══════════════════════════════════════════════════════════════════════════════
#  CONFIG  (overridable via env vars set in consumer / dockerfile)
# ══════════════════════════════════════════════════════════════════════════════
ROI_API_URL             = os.getenv("ROI_API_URL", "http://api:8000")
ROI_API_TIMEOUT         = 5
ZONE_REFRESH_INTERVAL   = 30          # seconds between zone cache refreshes

CONF_THRESHOLD          = 0.45
IOU_THRESHOLD           = 0.45
OVERLAP_RATIO_THRESHOLD = 0.35        # fraction of person bbox that must overlap zone

COOLDOWN_LOW    = 10   # seconds between repeated LOW-priority alerts for same person+zone
COOLDOWN_MEDIUM = 5
COOLDOWN_HIGH   = 2

PRIORITY_CONFIG: dict[str, dict] = {
    "LOW": {
        "color_bgr":  (0,   200,  50),   # Green
        "thickness":  2,
        "label":      "LOW",
        "cooldown_s": COOLDOWN_LOW,
    },
    "MEDIUM": {
        "color_bgr":  (0,   165, 255),   # Orange
        "thickness":  2,
        "label":      "MEDIUM",
        "cooldown_s": COOLDOWN_MEDIUM,
    },
    "HIGH": {
        "color_bgr":  (0,     0, 220),   # Red
        "thickness":  3,
        "label":      "HIGH",
        "cooldown_s": COOLDOWN_HIGH,
    },
}

_FONT       = cv2.FONT_HERSHEY_SIMPLEX
_FONT_SMALL = 0.45
_FONT_MED   = 0.60


# ══════════════════════════════════════════════════════════════════════════════
#  DATA CLASSES
# ══════════════════════════════════════════════════════════════════════════════
@dataclass
class ZoneBox:
    """Single priority zone / ROI section."""
    roi_id:        str
    roi_name:      str
    section_level: int
    priority:      str   # "LOW" | "MEDIUM" | "HIGH"
    label:         str
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def color(self) -> tuple:
        return PRIORITY_CONFIG[self.priority]["color_bgr"]

    @property
    def thickness(self) -> int:
        return PRIORITY_CONFIG[self.priority]["thickness"]

    def overlap_ratio(self, bx1: int, by1: int, bx2: int, by2: int) -> float:
        """Returns the fraction of the person bbox that overlaps this zone."""
        ix1 = max(self.x1, bx1);  iy1 = max(self.y1, by1)
        ix2 = min(self.x2, bx2);  iy2 = min(self.y2, by2)
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        inter       = (ix2 - ix1) * (iy2 - iy1)
        person_area = max(1, (bx2 - bx1) * (by2 - by1))
        return inter / person_area


@dataclass
class IntrusionEvent:
    """Single detected intrusion instance."""
    person_id:  int
    zone:       ZoneBox
    confidence: float
    timestamp:  datetime.datetime = field(default_factory=datetime.datetime.now)
    bbox:       tuple             = field(default_factory=tuple)

    def to_log_string(self) -> str:
        ts = self.timestamp.strftime("%H:%M:%S")
        return (
            f"[{ts}] ⚠ INTRUSION | Priority: {self.zone.priority:6s} | "
            f"Zone: {self.zone.label} | "
            f"Person #{self.person_id} | Conf: {self.confidence:.2f}"
        )


# ══════════════════════════════════════════════════════════════════════════════
#  ROI API CLIENT
# ══════════════════════════════════════════════════════════════════════════════
class ROIApiClient:
    """
    Fetches ROI zone definitions from the backend REST API.

    GET {ROI_API_URL}/api/v1/rois?camera_id=<id>

    Expected response shape:
    {
      "rois": [
        {
          "camera_id": "4",
          "name": "Zone A",
          "sections": [
            {
              "section_level": 1,
              "priority": "HIGH",
              "label": "Restricted Area",
              "coordinates": [
                {"corner": "top-left",     "x": 100, "y": 50},
                {"corner": "bottom-right", "x": 400, "y": 300}
              ]
            }
          ]
        }
      ]
    }
    """

    def __init__(self, base_url: str = ROI_API_URL):
        self.base_url = base_url.rstrip("/")
        self.session  = requests.Session()
        self.session.headers.update({"Accept": "application/json"})

    def fetch_zones_for_camera(self, camera_id: str) -> list[ZoneBox]:
        try:
            resp = self.session.get(
                f"{self.base_url}/api/v1/rois",
                params={"camera_id": camera_id},
                timeout=ROI_API_TIMEOUT,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            log.error("ROI API fetch failed for camera '%s': %s", camera_id, exc)
            return []

        zones: list[ZoneBox] = []
        data  = resp.json()
        log.debug("[ROI API] Raw response: %s", data)

        for roi in data.get("rois", []):
            for sec in roi.get("sections", []):
                coords = sec.get("coordinates", [])
                tl_x = tl_y = br_x = br_y = 0.0

                for pt in coords:
                    if pt.get("corner") == "top-left":
                        tl_x = float(pt.get("x", 0))
                        tl_y = float(pt.get("y", 0))
                    elif pt.get("corner") == "bottom-right":
                        br_x = float(pt.get("x", 0))
                        br_y = float(pt.get("y", 0))

                priority = sec.get("priority", "LOW").upper()
                if priority not in PRIORITY_CONFIG:
                    priority = "LOW"

                zones.append(ZoneBox(
                    roi_id        = roi.get("camera_id", camera_id),
                    roi_name      = roi.get("name", "Unknown"),
                    section_level = sec.get("section_level", 1),
                    priority      = priority,
                    label         = sec.get(
                        "label", f"Section {sec.get('section_level', 1)}"),
                    x1=tl_x, y1=tl_y, x2=br_x, y2=br_y,
                ))

        log.info("[Intrusion] Loaded %d zone(s) for camera '%s'", len(zones), camera_id)
        for z in zones:
            log.info("  └─ [%s] %s  box=(%.0f,%.0f)→(%.0f,%.0f)",
                     z.priority, z.label, z.x1, z.y1, z.x2, z.y2)
        return zones


# ══════════════════════════════════════════════════════════════════════════════
#  ZONE CACHE  (per-camera, TTL-based refresh)
# ══════════════════════════════════════════════════════════════════════════════
class ZoneCache:
    """Thread-safe per-camera zone cache with TTL-based refresh."""

    def __init__(self, api_client: ROIApiClient,
                 refresh_interval: int = ZONE_REFRESH_INTERVAL):
        self._client   = api_client
        self._interval = refresh_interval
        self._cache:   dict[str, list[ZoneBox]] = {}
        self._fetched: dict[str, float]         = {}
        self._lock     = threading.Lock()

    def get(self, camera_id: str) -> list[ZoneBox]:
        now = time.monotonic()
        with self._lock:
            if now - self._fetched.get(camera_id, 0) > self._interval:
                self._cache[camera_id]   = \
                    self._client.fetch_zones_for_camera(camera_id)
                self._fetched[camera_id] = now
        return self._cache.get(camera_id, [])


# ══════════════════════════════════════════════════════════════════════════════
#  ALERT MANAGER  (per-priority cooldowns)
# ══════════════════════════════════════════════════════════════════════════════
class AlertManager:
    """Enforces per-priority cooldowns before firing an alert."""

    def __init__(self):
        self._last_alert: dict[tuple, float] = {}
        self._lock        = threading.Lock()
        self.total_alerts: dict[str, int] = defaultdict(int)

    def should_fire(self, event: IntrusionEvent) -> bool:
        key      = (event.person_id, event.zone.roi_id, event.zone.section_level)
        cooldown = PRIORITY_CONFIG[event.zone.priority]["cooldown_s"]
        now      = time.monotonic()

        with self._lock:
            if now - self._last_alert.get(key, 0) < cooldown:
                return False
            self._last_alert[key] = now

        msg = event.to_log_string()
        if event.zone.priority == "HIGH":
            log.warning(msg)
        else:
            log.info(msg)

        self.total_alerts[event.zone.priority] += 1
        return True


# ══════════════════════════════════════════════════════════════════════════════
#  PERSON ID MAPPER  (track_id → sequential display ID, per camera)
# ══════════════════════════════════════════════════════════════════════════════
class PersonIDMapper:
    def __init__(self):
        self._map: dict[str, dict[int, int]] = defaultdict(dict)
        self._seq: dict[str, int]            = defaultdict(int)

    def get(self, camera_id: str, track_id: int) -> int:
        cam_map = self._map[camera_id]
        if track_id not in cam_map:
            self._seq[camera_id] += 1
            cam_map[track_id]    = self._seq[camera_id]
        return cam_map[track_id]


# ══════════════════════════════════════════════════════════════════════════════
#  FRAME ANNOTATOR HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def _draw_zones(frame: np.ndarray, zones: list[ZoneBox]) -> None:
    """Draw semi-transparent zone rectangles with priority labels."""
    for z in zones:
        x1, y1, x2, y2 = int(z.x1), int(z.y1), int(z.x2), int(z.y2)
        overlay = frame.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), z.color, -1)
        cv2.addWeighted(overlay, 0.08, frame, 0.92, 0, frame)
        cv2.rectangle(frame, (x1, y1), (x2, y2), z.color, z.thickness)
        label = f" {z.label} [{z.priority}] "
        (tw, th), _ = cv2.getTextSize(label, _FONT, _FONT_SMALL, 1)
        cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 4, y1), z.color, -1)
        cv2.putText(frame, label, (x1 + 2, y1 - 4),
                    _FONT, _FONT_SMALL, (255, 255, 255), 1, cv2.LINE_AA)


def _draw_person(frame: np.ndarray,
                 bx1: int, by1: int, bx2: int, by2: int,
                 pid: int, conf: float,
                 intruding_zones: list[ZoneBox]) -> None:
    """Draw bounding box + label only for persons inside a zone."""
    if not intruding_zones:
        return
    top_zone = max(intruding_zones, key=lambda z: z.section_level)
    color    = top_zone.color
    thick    = top_zone.thickness + 1
    label    = f"P#{pid} {conf:.2f} [{top_zone.priority}]"
    cv2.rectangle(frame, (bx1, by1), (bx2, by2), color, thick)
    cx, cy = (bx1 + bx2) // 2, (by1 + by2) // 2
    cv2.circle(frame, (cx, cy), 4, color, -1)
    (tw, th), _ = cv2.getTextSize(label, _FONT, _FONT_SMALL, 1)
    lx, ly = bx1, max(by1 - 6, th + 4)
    cv2.rectangle(frame, (lx, ly - th - 4), (lx + tw + 4, ly + 2), color, -1)
    cv2.putText(frame, label, (lx + 2, ly - 2),
                _FONT, _FONT_SMALL, (255, 255, 255), 1, cv2.LINE_AA)


def _draw_alert_flash(frame: np.ndarray,
                      bx1: int, by1: int, bx2: int, by2: int,
                      zone: ZoneBox) -> None:
    """Flash red overlay on HIGH priority intrusions."""
    if zone.priority != "HIGH":
        return
    overlay = frame.copy()
    cv2.rectangle(overlay, (bx1, by1), (bx2, by2), (0, 0, 255), -1)
    cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)


def _draw_hud(frame: np.ndarray,
              camera_id: str,
              zones: list[ZoneBox],
              alert_counts: dict) -> None:
    """Draw top status bar and bottom priority legend."""
    h, w = frame.shape[:2]
    cv2.rectangle(frame, (0, 0), (w, 36), (20, 20, 20), -1)
    ts = datetime.datetime.now().strftime("%Y-%m-%d  %H:%M:%S")
    cv2.putText(frame, f"CAM: {camera_id}   {ts}",
                (10, 24), _FONT, _FONT_MED, (220, 220, 220), 1, cv2.LINE_AA)

    legend_y = h - 12
    x_off    = 10
    for priority in ("LOW", "MEDIUM", "HIGH"):
        count = alert_counts.get(priority, 0)
        cfg   = PRIORITY_CONFIG[priority]
        text  = f"{cfg['label']} alerts:{count}"
        (tw, _), _ = cv2.getTextSize(text, _FONT, _FONT_SMALL, 1)
        cv2.rectangle(frame, (x_off - 2, legend_y - 16),
                      (x_off + tw + 4, legend_y + 4), (20, 20, 20), -1)
        cv2.putText(frame, text, (x_off, legend_y),
                    _FONT, _FONT_SMALL, cfg["color_bgr"], 1, cv2.LINE_AA)
        x_off += tw + 20

    if not zones:
        cv2.putText(frame, "NO ROI ZONES LOADED",
                    (w // 2 - 120, h // 2),
                    _FONT, 0.9, (0, 0, 255), 2, cv2.LINE_AA)


# ══════════════════════════════════════════════════════════════════════════════
#  INTRUSION DETECTOR  (main class — plugs into consumer.py MODEL_DISPATCH)
# ══════════════════════════════════════════════════════════════════════════════
class IntrusionDetector:
    """
    ROI-based intrusion detector.

    Usage (matches existing detector API in consumer.py):
        detector = IntrusionDetector(yolo_model)
        result   = detector.detect(frame, camera_id, person_boxes=None)

    Returns:
        {
            "HIGH Intrusion":   <int>,   # omitted if 0 alerts fired
            "MEDIUM Intrusion": <int>,   # omitted if 0 alerts fired
            "LOW Intrusion":    <int>,   # omitted if 0 alerts fired
            "frame":            <annotated BGR numpy array>
        }

    NOTE: person_boxes param is accepted for API compatibility but ignored —
    intrusion detection does its own YOLO inference to get accurate bboxes
    with the tuned conf/iou thresholds for person detection.
    """

    def __init__(self, model):
        self.model = model

        # Shared singletons (per detector instance = per process, not per camera)
        self._api_client    = ROIApiClient(ROI_API_URL)
        self._zone_cache    = ZoneCache(self._api_client, ZONE_REFRESH_INTERVAL)
        self._alert_manager = AlertManager()
        self._pid_mapper    = PersonIDMapper()

    # ──────────────────────────────────────────────────────────────────────────
    #  Public API
    # ──────────────────────────────────────────────────────────────────────────

    def detect(self, frame: np.ndarray, camera_id: str,
               person_boxes=None) -> dict:
        """
        Run ROI intrusion detection on a single frame.

        Args:
            frame       : BGR numpy array (already resized by consumer)
            camera_id   : unique camera identifier for zone lookup + tracking
            person_boxes: ignored (kept for API compatibility)

        Returns:
            dict with optional priority-keyed counts + annotated "frame"
        """
        if camera_id is None:
            camera_id = "default"

        # ── Fetch zones (TTL-cached per camera) ───────────────────────────────
        zones = self._zone_cache.get(camera_id)

        # ── Draw zone overlays ────────────────────────────────────────────────
        _draw_zones(frame, zones)

        # ── YOLO person detection ─────────────────────────────────────────────
        results = self.model.predict(
            frame,
            classes = [0],              # class 0 = person
            conf    = CONF_THRESHOLD,
            iou     = IOU_THRESHOLD,
            verbose = False,
        )

        detected_object: dict[str, int] = {}

        if results and results[0].boxes is not None:
            boxes = results[0].boxes

            for i in range(len(boxes)):
                xyxy = boxes.xyxy[i].cpu().numpy()
                conf = float(boxes.conf[i].cpu().numpy())
                bx1, by1, bx2, by2 = (int(v) for v in xyxy)

                # Use detection index as person display ID (no tracker needed)
                pid = self._pid_mapper.get(camera_id, i)

                # ── Overlap check against each zone ───────────────────────────
                intruding_zones: list[ZoneBox] = []

                for zone in zones:
                    ratio = zone.overlap_ratio(bx1, by1, bx2, by2)
                    log.debug(
                        "OVERLAP | person=(%d,%d,%d,%d) zone=%s=(%.0f,%.0f,%.0f,%.0f) ratio=%.3f",
                        bx1, by1, bx2, by2,
                        zone.label, zone.x1, zone.y1, zone.x2, zone.y2, ratio,
                    )
                    if ratio < OVERLAP_RATIO_THRESHOLD:
                        continue

                    intruding_zones.append(zone)

                    event = IntrusionEvent(
                        person_id  = pid,
                        zone       = zone,
                        confidence = conf,
                        bbox       = (bx1, by1, bx2, by2),
                    )

                    if self._alert_manager.should_fire(event):
                        _draw_alert_flash(frame, bx1, by1, bx2, by2, zone)

                        alert_key = f"{zone.priority.upper()} Intrusion"
                        detected_object[alert_key] = (
                            detected_object.get(alert_key, 0) + 1
                        )

                _draw_person(frame, bx1, by1, bx2, by2,
                             pid, conf, intruding_zones)

        # ── HUD ───────────────────────────────────────────────────────────────
        _draw_hud(frame, camera_id, zones, self._alert_manager.total_alerts)

        result = {"frame": frame}
        result.update(detected_object)   # add priority counts only if non-zero
        return result
