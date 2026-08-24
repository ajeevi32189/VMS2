import cv2
import time
import numpy as np
from collections import defaultdict, deque
from skimage.metrics import structural_similarity as ssim


# ─────────────────────────────────────────────
#  Tracking state (per-instance ya global)
# ─────────────────────────────────────────────

class FireDetector:

    def __init__(self, model):
        self.model = model

        # Crop histories for similarity check
        self.fire_crop_history  = defaultdict(lambda: deque(maxlen=5))
        self.smoke_crop_history = defaultdict(lambda: deque(maxlen=5))

        # Movement tracking dicts
        self.fire_tracking  = {}   # bade fire ke liye
        self.fire_trackings = {}   # chote fire ke liye
        self.smoke_tracking = {}

        # Persistence tracking dict
        self.fire_persistence = {}

    # ──────────────────────────────────────────
    #  SSIM similarity check (crop frame)
    # ──────────────────────────────────────────

    def _is_similar_frame(self, current_frame, previous_frame, threshold=0.96):
        if current_frame is None or previous_frame is None:
            return False
        try:
            cur  = cv2.cvtColor(cv2.resize(current_frame,  (120, 120)), cv2.COLOR_BGR2GRAY)
            prev = cv2.cvtColor(cv2.resize(previous_frame, (120, 120)), cv2.COLOR_BGR2GRAY)
            return ssim(cur, prev) > threshold
        except Exception as e:
            print(f"[SSIM Error] {e}")
            return False

    # ──────────────────────────────────────────
    #  Gray / Yellow region filter
    # ──────────────────────────────────────────

    def _is_gray_or_yellow_region(self, img, gray_sat_thresh=25, yellow_sat_thresh=140, yellow_bright_thresh=245):
        if img is None or img.size == 0:
            return True
        img = cv2.resize(img, (80, 80))
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        h = hsv[:, :, 0]
        s = hsv[:, :, 1]
        v = hsv[:, :, 2]
        mean_sat = np.mean(s)
        if mean_sat < gray_sat_thresh:
            return True
        yellow_mask = (
            (h >= 20) & (h <= 40) &
            (s >= yellow_sat_thresh) &
            (v >= yellow_bright_thresh)
        )
        yellow_ratio = yellow_mask.mean()
        if yellow_ratio > 0.18:
            return True
        return False

    # ──────────────────────────────────────────
    #  Fire movement tracker (bada fire)
    # ──────────────────────────────────────────

    def _is_fire_moving(self, camera_id, x, y, movement_threshold=8, required_duration=1):
        current_time = time.time()
        key = f"{camera_id}_{int(x/50)}_{int(y/50)}"
        if key not in self.fire_tracking:
            self.fire_tracking[key] = {"last_pos": (x, y), "move_start": None}
            return False
        last_pos = self.fire_tracking[key]["last_pos"]
        dx = abs(x - last_pos[0])
        dy = abs(y - last_pos[1])
        distance = (dx**2 + dy**2) ** 0.5
        self.fire_tracking[key]["last_pos"] = (x, y)
        if distance > movement_threshold:
            if self.fire_tracking[key]["move_start"] is None:
                self.fire_tracking[key]["move_start"] = current_time
            elif current_time - self.fire_tracking[key]["move_start"] >= required_duration:
                return True
        else:
            self.fire_tracking[key]["move_start"] = None
        return False

    # ──────────────────────────────────────────
    #  Fire movement tracker (chota fire)
    # ──────────────────────────────────────────

    def _is_fire_movings(self, camera_id, x, y, movement_threshold=12, required_duration=2):
        current_time = time.time()
        key = f"{camera_id}_{int(x/40)}_{int(y/40)}"
        if key not in self.fire_trackings:
            self.fire_trackings[key] = {"last_pos": (x, y), "move_start": None}
            return False
        last_pos = self.fire_trackings[key]["last_pos"]
        dx = abs(x - last_pos[0])
        dy = abs(y - last_pos[1])
        distance = (dx**2 + dy**2) ** 0.5
        self.fire_trackings[key]["last_pos"] = (x, y)
        if distance > movement_threshold:
            if self.fire_trackings[key]["move_start"] is None:
                self.fire_trackings[key]["move_start"] = current_time
            elif current_time - self.fire_trackings[key]["move_start"] >= required_duration:
                return True
        else:
            self.fire_trackings[key]["move_start"] = None
        return False

    # ──────────────────────────────────────────
    #  Fire persistence tracker (static fire check)
    # ──────────────────────────────────────────

    def _is_fire_persistent(self, camera_id, x, y, required_count=3, grid_size=50, reset_timeout=5):
        current_time = time.time()
        key = f"{camera_id}_{int(x/grid_size)}_{int(y/grid_size)}"
        if key not in self.fire_persistence:
            self.fire_persistence[key] = {"count": 1, "last_seen": current_time}
            return False
        if current_time - self.fire_persistence[key]["last_seen"] > reset_timeout:
            self.fire_persistence[key] = {"count": 1, "last_seen": current_time}
            return False
        self.fire_persistence[key]["count"] += 1
        self.fire_persistence[key]["last_seen"] = current_time
        if self.fire_persistence[key]["count"] >= required_count:
            return True
        return False

    # ──────────────────────────────────────────
    #  Smoke movement tracker
    # ──────────────────────────────────────────

    def _is_smoke_moving(self, camera_id, x, y, movement_threshold=15, required_duration=3):
        current_time = time.time()
        key = f"{camera_id}_{int(x/50)}_{int(y/50)}"
        if key not in self.smoke_tracking:
            self.smoke_tracking[key] = {"last_pos": (x, y), "move_start": None}
            return False
        last_pos = self.smoke_tracking[key]["last_pos"]
        dx = abs(x - last_pos[0])
        dy = abs(y - last_pos[1])
        distance = (dx**2 + dy**2) ** 0.5
        self.smoke_tracking[key]["last_pos"] = (x, y)
        if distance > movement_threshold:
            if self.smoke_tracking[key]["move_start"] is None:
                self.smoke_tracking[key]["move_start"] = current_time
            elif current_time - self.smoke_tracking[key]["move_start"] >= required_duration:
                return True
        else:
            self.smoke_tracking[key]["move_start"] = None
        return False

    # ──────────────────────────────────────────
    #  Main detect method
    # ──────────────────────────────────────────

    def detect(self, frame, camera_id=None, person_boxes=None, conf=0.42):
        """
        Args:
            frame       : BGR numpy array
            camera_id   : unique camera identifier (movement tracking ke liye zaroori)
            person_boxes: list of (x1,y1,x2,y2) — fire/smoke jo person ke andar ho skip ho
            conf        : base confidence threshold

        Returns:
            dict: {
                "fire":  <int count>,
                "smoke": <int count>,
                "frame": <annotated frame>   # bounding boxes bane hue
            }
        """
        if person_boxes is None:
            person_boxes = []

        height, width = frame.shape[:2]

        fire_count  = 0
        smoke_count = 0

        results = self.model(frame, verbose=False)[0]

        all_dets = results.boxes.data.tolist()
        print(f"🔎 [FireDetector] YOLO ran. Total detections: {len(all_dets)}. Frame size: {frame.shape}")

        for det in all_dets:
            x1, y1, x2, y2, score, cls_id = det
            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
            label = results.names[int(cls_id)]
            cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
            
            print(f"🤖 [YOLO Raw] Detected: {label} (Score: {score:.3f})")

            # ── FIRE ──────────────────────────────
            if label == "Fire":
                print(f"🔥 [Debug Fire] Raw detect: {label} with score {score:.3f} at ({cx}, {cy})")

                if score <= 0.35:
                    print(f"   ↳ ❌ Dropped: Score {score:.3f} is lower than 0.35 threshold")
                    continue

                # Person ke andar hai to skip
                if any(px1 < cx < px2 and py1 < cy < py2
                       for px1, py1, px2, py2 in person_boxes):
                    print(f"   ↳ ❌ Dropped: Fire is inside a Person box!")
                    continue

                crop = frame[y1:y2, x1:x2]

                # Gray/Yellow region filter
                if self._is_gray_or_yellow_region(crop):
                    print("   ↳ ❌ Dropped: Gray/Yellow region (Sun/Light Glare filter)")
                    continue

                # Similarity check (threshold 0.90)
                history = self.fire_crop_history[camera_id]
                if history and any(self._is_similar_frame(crop, prev, threshold=0.90) for prev in history):
                    print("   ↳ ❌ Dropped: Similar frame (Not flickering enough, SSIM > 0.90)")
                    continue
                history.append(crop)

                # Movement check + Persistence check
                fire_moving = self._is_fire_moving(camera_id, cx, cy)
                fire_persistent = self._is_fire_persistent(camera_id, cx, cy)
                print(f"   ↳ DEBUG: fire_moving={fire_moving}, fire_persistent={fire_persistent}")

                if fire_moving or fire_persistent:
                    print(f"   ↳ ✅ SUCCESS! Fire passed all filters!")
                    fire_count += 1
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
                    cv2.putText(frame, f"Fire {score:.2f}", (cx, cy - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                else:
                    print("   ↳ ❌ Dropped: Fire is not moving and not persistent yet.")

            # ── SMOKE ─────────────────────────────
            elif label == "Smoke" and score > 0.39:

                # Person ke andar hai to skip
                if any(px1 < cx < px2 and py1 < cy < py2
                       for px1, py1, px2, py2 in person_boxes):
                    continue

                crop = frame[y1:y2, x1:x2]

                # Similarity check
                history = self.smoke_crop_history[camera_id]
                if history and any(self._is_similar_frame(crop, prev) for prev in history):
                    print("[Smoke] Similar frame — skip")
                    continue
                history.append(crop)

                # Movement check
                if self._is_smoke_moving(camera_id, cx, cy):
                    smoke_count += 1
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (128, 128, 128), 2)
                    cv2.putText(frame, f"Smoke {score:.2f}", (cx, cy - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (128, 128, 128), 2)

        return {
            "fire":  fire_count,
            "smoke": smoke_count,
            "frame": frame          # annotated frame wapas milega
        }