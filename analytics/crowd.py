import cv2
import time
import numpy as np
from collections import deque, defaultdict
from deep_sort_realtime.deepsort_tracker import DeepSort

# ──────────────────────────────────────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────────────────────────────────────
CROWD_CONF_THRESHOLD  = 0.25
CROWD_IOU_THRESHOLD   = 0.45
CROWD_MIN_WIDTH       = 25
CROWD_MIN_HEIGHT      = 50
CROWD_THRESHOLD_DAY   = 7
CROWD_THRESHOLD_NIGHT = 5
CROWD_ALERT_COOLDOWN  = 5.0
CROWD_SMOOTH_WINDOW   = 8

# ──────────────────────────────────────────────────────────────────────────────
#  HUD STYLE CONSTANTS
# ──────────────────────────────────────────────────────────────────────────────
_FONT      = cv2.FONT_HERSHEY_DUPLEX
_CLR_GREEN = (0, 220, 90)
_CLR_PANEL = (10, 10, 10)
_CLR_ALERT = (0, 30, 200)


class CrowdDetector:

    def __init__(self, model):
        self.model = model

        # Per-camera state (all stored inside instance — thread-safe per camera)
        self.trackers    = {}
        self.smoothers   = {}
        self.crowd_state = defaultdict(lambda: {"last_alert_time": 0})

    # ─────────────────────────────────────────────
    #  Internal helpers
    # ─────────────────────────────────────────────

    def _get_tracker(self, camera_id):
        if camera_id not in self.trackers:
            self.trackers[camera_id] = DeepSort(
                max_age=10,
                n_init=3,
                max_iou_distance=0.65,
                nn_budget=100,
                embedder="mobilenet",
                half=True,
                bgr=True,
            )
        return self.trackers[camera_id]

    def _get_smoother(self, camera_id):
        if camera_id not in self.smoothers:
            self.smoothers[camera_id] = deque(maxlen=CROWD_SMOOTH_WINDOW)
        return self.smoothers[camera_id]

    def _rolling_median(self, buf, value):
        buf.append(value)
        return int(np.median(buf))

    def _is_night(self):
        h = time.localtime().tm_hour
        return h >= 23 or h < 6

    # ─────────────────────────────────────────────
    #  HUD drawing
    # ─────────────────────────────────────────────

    def _semi_rect(self, frame, pt1, pt2, color, alpha=0.55):
        x1, y1 = max(0, pt1[0]), max(0, pt1[1])
        x2, y2 = min(frame.shape[1], pt2[0]), min(frame.shape[0], pt2[1])
        if x2 <= x1 or y2 <= y1:
            return
        roi = frame[y1:y2, x1:x2]
        cv2.addWeighted(np.full_like(roi, color), alpha, roi, 1 - alpha, 0, roi)
        frame[y1:y2, x1:x2] = roi

    def _shadow_text(self, frame, text, org, scale=0.7,
                     color=(255, 255, 255), thickness=2):
        x, y = org
        cv2.putText(frame, text, (x+1, y+1), _FONT, scale,
                    (0, 0, 0), thickness + 1, cv2.LINE_AA)
        cv2.putText(frame, text, (x, y),     _FONT, scale,
                    color,       thickness,   cv2.LINE_AA)

    def _draw_hud(self, frame, smooth_count, threshold, alert):
        px, py, pw, ph = 12, 12, 280, 110
        self._semi_rect(frame, (px, py), (px+pw, py+ph), _CLR_PANEL, 0.65)
        cv2.rectangle(frame, (px, py), (px+pw, py+ph), _CLR_GREEN, 1)

        stats = [
            (f"Count  : {smooth_count}", (30, 220, 255), 1.0),
            (f"Thresh : {threshold}",    (200, 200, 200), 0.85),
        ]
        y_off = py + 36
        for text, color, scale in stats:
            thick = 2 if scale >= 1.0 else 1
            self._shadow_text(frame, text, (px+10, y_off),
                              scale=scale, color=color, thickness=thick)
            y_off += 32

        if alert:
            y1, y2 = 130, 165
            self._semi_rect(frame, (px, y1), (px + 430, y2), _CLR_ALERT, 0.70)
            cv2.rectangle(frame, (px, y1), (px + 430, y2), (0, 50, 255), 1)
            self._shadow_text(
                frame,
                f"!! CROWD ALERT  —  {smooth_count} persons detected !!",
                (px + 10, y1 + 25),
                scale=0.75, color=(255, 255, 255), thickness=2,
            )

    def _draw_tracked_boxes(self, frame, tracks, alert):
        box_col   = (0, 80, 220)  if alert else (0, 220, 90)
        label_col = (0, 50, 200)  if alert else (0, 160, 60)

        for track in tracks:
            if not track.is_confirmed():
                continue
            tid = track.track_id
            l, t, r, b = map(int, track.to_ltrb())
            l = max(0, l); t = max(0, t)
            r = min(frame.shape[1], r); b = min(frame.shape[0], b)

            cv2.rectangle(frame, (l, t), (r, b), box_col, 2)

            # Corner accents
            cl = min(12, (r - l) // 4, (b - t) // 4)
            for cx, cy, dx, dy in [
                (l, t, 1, 1), (r, t, -1, 1), (l, b, 1, -1), (r, b, -1, -1)
            ]:
                cv2.line(frame, (cx, cy), (cx + dx * cl, cy),       box_col, 3)
                cv2.line(frame, (cx, cy), (cx,           cy + dy * cl), box_col, 3)

            # ID label
            label = f" ID {tid} "
            (lw, lh), _ = cv2.getTextSize(label, _FONT, 0.50, 1)
            lx, ly = l, max(t - 4, lh + 4)
            cv2.rectangle(frame, (lx, ly - lh - 4), (lx + lw, ly + 2), label_col, -1)
            cv2.putText(frame, label, (lx, ly - 2), _FONT, 0.50,
                        (255, 255, 255), 1, cv2.LINE_AA)

    # ─────────────────────────────────────────────
    #  Main detect method
    # ─────────────────────────────────────────────

    def detect(self, frame, camera_id, person_boxes=None):
        """
        Run crowd detection + DeepSort tracking.

        Args:
            frame      : BGR numpy array
            camera_id  : str — unique per camera, used to maintain per-camera state
            person_boxes: unused (kept for API compatibility with consumer.py dispatch)

        Returns:
            {"crowd": smooth_count (>0 only on alert), "frame": annotated_frame}
        """
        if camera_id is None:
            camera_id = "default"

        tracker  = self._get_tracker(camera_id)
        smoother = self._get_smoother(camera_id)
        state    = self.crowd_state[camera_id]

        # ── Detection ────────────────────────────────────────────────────────
        results = self.model(
            frame,
            conf=CROWD_CONF_THRESHOLD,
            iou=CROWD_IOU_THRESHOLD,
            verbose=False,
            classes=[0],           # class 0 = person
        )[0]

        detections = []
        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            w, h = x2 - x1, y2 - y1
            if w > CROWD_MIN_WIDTH and h > CROWD_MIN_HEIGHT:
                detections.append(([x1, y1, w, h], float(box.conf[0]), "person"))

        # ── Tracking ─────────────────────────────────────────────────────────
        tracks = tracker.update_tracks(detections, frame=frame)

        # ── Smooth count via rolling median ───────────────────────────────────
        raw_count    = len(detections)
        smooth_count = self._rolling_median(smoother, raw_count)

        # ── Threshold & alert flag ────────────────────────────────────────────
        threshold = CROWD_THRESHOLD_NIGHT if self._is_night() else CROWD_THRESHOLD_DAY
        alert     = smooth_count >= threshold

        # ── Draw boxes + HUD ─────────────────────────────────────────────────
        self._draw_tracked_boxes(frame, tracks, alert)
        self._draw_hud(frame, smooth_count, threshold, alert)

        # ── Alert cooldown ────────────────────────────────────────────────────
        should_alert = False
        if alert:
            now = time.time()
            if now - state["last_alert_time"] > CROWD_ALERT_COOLDOWN:
                state["last_alert_time"] = now
                should_alert = True
                print(f"[Crowd] 🚨 Alert — camera: {camera_id} | count: {smooth_count}")

        result = {"frame": frame}
        if should_alert:
            result["crowd"] = smooth_count
        return result
