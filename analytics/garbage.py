import os
import cv2
import time
import datetime
import numpy as np
from collections import deque, defaultdict
from skimage.metrics import structural_similarity as ssim

# ──────────────────────────────────────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────────────────────────────────────
GARBAGE_CONF_THRESHOLD  = 0.30
GARBAGE_IOU_THRESHOLD   = 0.35
GARBAGE_MIN_WIDTH       = 25
GARBAGE_MIN_HEIGHT      = 25
GARBAGE_PERSIST_FRAMES  = 2          # frames tak stable ho tabhi confirm
GARBAGE_SSIM_THRESHOLD  = 0.95       # similar crop skip karo
GARBAGE_SSIM_HISTORY    = 5
GARBAGE_ALERT_COOLDOWN  = 3          # seconds — 10 tha, ab 3 kar diya short videos ke liye
GARBAGE_SAVE_DETECTIONS = True
GARBAGE_OUTPUT_DIR      = "garbage_detections"
PERSON_OVERLAP_RATIO    = 0.5        # ≥50% overlap with person → skip

# Colors (BGR)
COLOR_GARBAGE_BOX      = (0, 200, 255)   # orange
COLOR_GARBAGE_LABEL_BG = (0, 140, 180)
COLOR_GARBAGE_CHECKING = (80, 80, 80)    # gray — not yet stable
COLOR_GARBAGE_ALERT_BG = (0, 0, 180)
COLOR_PERSON           = (0, 255, 0)


# ──────────────────────────────────────────────────────────────────────────────
#  GARBAGE DETECTOR
# ──────────────────────────────────────────────────────────────────────────────

class GarbageDetector:
    """
    Garbage Detection with:
      - Person overlap filter  (garbage on a person is skipped)
      - Persistence filter     (must appear for N consecutive frames)
      - SSIM dedup             (similar crop → skip saving only, still counted)
      - Alert cooldown         (re-alert only after GARBAGE_ALERT_COOLDOWN seconds)

    detect() returns:
        {"garbage": count (>0 only when alert fires), "frame": annotated_frame}
    """

    def __init__(self, model):
        self.model = model

        # Per-camera state — all inside the instance (no globals)
        self.persist_count   = defaultdict(int)
        self.crop_history    = defaultdict(lambda: deque(maxlen=GARBAGE_SSIM_HISTORY))
        self.last_alert_time = defaultdict(float)
        self.total_alerts    = 0

        if GARBAGE_SAVE_DETECTIONS:
            os.makedirs(os.path.join(GARBAGE_OUTPUT_DIR, "frames"), exist_ok=True)
            os.makedirs(os.path.join(GARBAGE_OUTPUT_DIR, "crops"),  exist_ok=True)

    # ─────────────────────────────────────────────
    #  Internal helpers
    # ─────────────────────────────────────────────

    def _key(self, camera_id, cx, cy, grid=60):
        return f"{camera_id}_{int(cx/grid)}_{int(cy/grid)}"

    def _update_persistence(self, camera_id, active_keys):
        """Increment count for active keys, decay inactive ones. Return confirmed keys."""
        all_keys  = set(self.persist_count.keys()) | active_keys
        confirmed = set()
        for k in all_keys:
            if k in active_keys:
                self.persist_count[k] += 1
                if self.persist_count[k] >= GARBAGE_PERSIST_FRAMES:
                    confirmed.add(k)
            else:
                self.persist_count[k] = max(0, self.persist_count[k] - 1)
        return confirmed

    def _is_duplicate_crop(self, camera_id, crop):
        """True if crop is visually similar to a recent crop (SSIM)."""
        if crop is None or crop.size == 0:
            return False
        try:
            curr = cv2.cvtColor(cv2.resize(crop, (80, 80)), cv2.COLOR_BGR2GRAY)
            for prev in self.crop_history[camera_id]:
                p = cv2.cvtColor(cv2.resize(prev, (80, 80)), cv2.COLOR_BGR2GRAY)
                if ssim(curr, p) > GARBAGE_SSIM_THRESHOLD:
                    return True
        except Exception:
            pass
        return False

    def _overlap_ratio(self, box_a, box_b):
        """What fraction of box_a's area does box_b cover?"""
        ax1, ay1, ax2, ay2 = box_a
        bx1, by1, bx2, by2 = box_b
        ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
        ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        return ((ix2 - ix1) * (iy2 - iy1)) / max(1, (ax2-ax1) * (ay2-ay1))

    def _is_on_person(self, garbage_bbox, person_boxes):
        for pb in person_boxes:
            if self._overlap_ratio(garbage_bbox, pb) >= PERSON_OVERLAP_RATIO:
                return True
        return False

    # ─────────────────────────────────────────────
    #  Draw helpers
    # ─────────────────────────────────────────────

    def _draw_box(self, frame, det):
        x1, y1, x2, y2 = det["bbox"]
        text = f"{det['label']} {det['score']:.2f}"
        cv2.rectangle(frame, (x1, y1), (x2, y2), COLOR_GARBAGE_BOX, 2)
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(frame,
                      (x1, y1 - th - 10), (x1 + tw + 6, y1),
                      COLOR_GARBAGE_LABEL_BG, -1)
        cv2.putText(frame, text, (x1 + 3, y1 - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    def _draw_stats(self, frame, count, alert):
        ov = frame.copy()
        cv2.rectangle(ov, (8, 8), (330, 80), (20, 20, 20), -1)
        cv2.addWeighted(ov, 0.55, frame, 0.45, 0, frame)
        cv2.putText(frame, f"Garbage : {count}",
                    (16, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.85, COLOR_GARBAGE_BOX, 2)
        cv2.putText(frame, f"Alerts: {self.total_alerts}   conf={GARBAGE_CONF_THRESHOLD}  persist={GARBAGE_PERSIST_FRAMES}f",
                    (16, 64), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (180, 255, 180), 1)
        if alert:
            ov2 = frame.copy()
            cv2.rectangle(ov2, (8, 86), (390, 120), COLOR_GARBAGE_ALERT_BG, -1)
            cv2.addWeighted(ov2, 0.65, frame, 0.35, 0, frame)
            cv2.putText(frame, "!! GARBAGE ALERT TRIGGERED !!",
                        (16, 112), cv2.FONT_HERSHEY_SIMPLEX, 0.78, (255, 255, 255), 2)

    # ─────────────────────────────────────────────
    #  Main detect method
    # ─────────────────────────────────────────────

    def detect(self, frame, camera_id, person_boxes=None):
        """
        Args:
            frame       : BGR numpy array (640×480 expected)
            camera_id   : str — used to keep per-camera state
            person_boxes: list of (x1,y1,x2,y2) — garbage overlapping persons is skipped.
                          Comes from consumer.py shared person model output.

        Returns:
            {"garbage": count (>0 only when alert fires), "frame": annotated_frame}
        """
        if person_boxes is None:
            person_boxes = []

        # ── Step 1: YOLO detection ────────────────────────────────────────────
        gb_results = self.model(
            frame,
            conf=GARBAGE_CONF_THRESHOLD,
            iou=GARBAGE_IOU_THRESHOLD,
            verbose=False,
        )[0]

        gb_raw         = []
        gb_active_keys = set()

        for box in gb_results.boxes.data.tolist():
            gx1, gy1, gx2, gy2, gscore, gcls_id = box
            gx1, gy1, gx2, gy2 = int(gx1), int(gy1), int(gx2), int(gy2)
            gx1 = max(0, gx1); gy1 = max(0, gy1)
            gx2 = min(frame.shape[1], gx2)
            gy2 = min(frame.shape[0], gy2)

            # ── Size filter ──────────────────────────────────────────────────
            if (gx2 - gx1) < GARBAGE_MIN_WIDTH or (gy2 - gy1) < GARBAGE_MIN_HEIGHT:
                continue

            # ── Person overlap filter ────────────────────────────────────────
            if self._is_on_person((gx1, gy1, gx2, gy2), person_boxes):
                cv2.rectangle(frame, (gx1, gy1), (gx2, gy2), (50, 50, 200), 1)
                cv2.putText(frame, "person-skip", (gx1, gy1 - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, (50, 50, 200), 1)
                continue

            gcx  = (gx1 + gx2) // 2
            gcy  = (gy1 + gy2) // 2
            gkey = self._key(camera_id, gcx, gcy)
            gb_active_keys.add(gkey)
            gb_raw.append({
                "bbox":  (gx1, gy1, gx2, gy2),
                "label": gb_results.names[int(gcls_id)],
                "score": gscore,
                "cx":    gcx, "cy": gcy,
                "key":   gkey,
                "crop":  frame[gy1:gy2, gx1:gx2].copy(),
            })

        # ── Step 2: Persistence filter ────────────────────────────────────────
        confirmed_keys = self._update_persistence(camera_id, gb_active_keys)
        gb_confirmed   = []

        for det in gb_raw:
            gx1, gy1, gx2, gy2 = det["bbox"]

            if det["key"] not in confirmed_keys:
                # Show gray "checking" box — not yet stable
                count_now = self.persist_count[det["key"]]
                cv2.rectangle(frame, (gx1, gy1), (gx2, gy2),
                              COLOR_GARBAGE_CHECKING, 1)
                cv2.putText(
                    frame,
                    f"checking {count_now}/{GARBAGE_PERSIST_FRAMES}",
                    (gx1, gy1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, COLOR_GARBAGE_CHECKING, 1,
                )
                continue

            # ── SSIM dedup ───────────────────────────────────────────────────
            # FIX: duplicate ho ya na ho — count mein add karo
            # sirf saving skip karo duplicate ke liye
            is_dup = self._is_duplicate_crop(camera_id, det["crop"])
            if not is_dup:
                self.crop_history[camera_id].append(det["crop"])

            gb_confirmed.append(det)   # <-- FIXED: hamesha count mein aayega
            self._draw_box(frame, det)

            # Save crop sirf non-duplicate ke liye
            if GARBAGE_SAVE_DETECTIONS and not is_dup and det["crop"].size > 0:
                ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
                cv2.imwrite(
                    os.path.join(GARBAGE_OUTPUT_DIR, "crops",
                                 f"crop_{camera_id}_{ts}_{det['label']}.jpg"),
                    det["crop"],
                    [cv2.IMWRITE_JPEG_QUALITY, 92],
                )

        # ── Step 3: Alert — confirmed_keys mein koi bhi key ho = garbage present = alert
        # (SSIM se alert block nahi hoga, sirf saving block hogi)
        can_alert = (time.time() - self.last_alert_time[camera_id]) > GARBAGE_ALERT_COOLDOWN
        alert_now = bool(confirmed_keys) and can_alert

        self._draw_stats(frame, len(gb_confirmed), alert_now)

        # ── Step 4: Fire alert + save frame ──────────────────────────────────
        if alert_now:
            self.last_alert_time[camera_id] = time.time()
            self.total_alerts += 1
            print(f"[Garbage] 🚨 Alert — camera: {camera_id} | count: {len(gb_confirmed)}")

            if GARBAGE_SAVE_DETECTIONS:
                ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
                fp = os.path.join(GARBAGE_OUTPUT_DIR, "frames",
                                  f"frame_{camera_id}_{ts}_alert.jpg")
                cv2.imwrite(fp, frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
                print(f"[Garbage] ALERT — {len(confirmed_keys)} pile(s) | saved: {fp}")

        return {
            "garbage": len(gb_confirmed) if alert_now else 0,
            "frame":   frame,
        }
