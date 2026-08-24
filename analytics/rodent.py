import cv2
import time
from collections import defaultdict, deque
from skimage.metrics import structural_similarity as ssim


class RodentDetector:

    def __init__(self, model):
        self.model = model

        # Crop history — similar frames skip karne ke liye
        self.rodent_crop_history = defaultdict(lambda: deque(maxlen=5))

        # Movement tracking dict
        # Key: f"{camera_id}_{int(x/60)}_{int(y/60)}"
        self.rodent_tracking = {}

    # ──────────────────────────────────────────
    #  SSIM similarity check
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
    #  Rodent movement tracker
    # ──────────────────────────────────────────

    def _is_rodent_moving(self, camera_id, x, y,
                           movement_threshold=30,
                           required_duration=2):
        current_time = time.time()
        key = f"{camera_id}_{int(x/60)}_{int(y/60)}"

        if key not in self.rodent_tracking:
            self.rodent_tracking[key] = {
                "last_pos":   (x, y),
                "move_start": None
            }
            return False

        last_pos = self.rodent_tracking[key]["last_pos"]
        distance = ((x - last_pos[0])**2 + (y - last_pos[1])**2) ** 0.5
        self.rodent_tracking[key]["last_pos"] = (x, y)

        if distance > movement_threshold:
            if self.rodent_tracking[key]["move_start"] is None:
                self.rodent_tracking[key]["move_start"] = current_time
            elif current_time - self.rodent_tracking[key]["move_start"] >= required_duration:
                return True
        else:
            self.rodent_tracking[key]["move_start"] = None

        return False

    # ──────────────────────────────────────────
    #  Main detect method
    # ──────────────────────────────────────────

    def detect(self, frame, camera_id=None, person_boxes=None, conf=0.5):
        """
        Args:
            frame        : BGR numpy array
            camera_id    : unique camera identifier (tracking ke liye zaroori)
            person_boxes : list of (x1, y1, x2, y2) — in boxes ke andar rodent ho toh skip
            conf         : confidence threshold (default 0.5)

        Returns:
            dict: {
                "rodent": <int count>,
                "frame" : <annotated frame>
            }
        """
        if person_boxes is None:
            person_boxes = []

        rodent_count = 0

        # YOLO — sirf rodent/rat/cat classes (14, 15, 64)
        results = self.model(frame, verbose=False, classes=[14, 15, 64])[0]

        for det in results.boxes.data.tolist():
            rdx1, rdy1, rdx2, rdy2, rdscore, rdid = det
            rdx1, rdy1, rdx2, rdy2 = map(int, [rdx1, rdy1, rdx2, rdy2])
            rdlabel = results.names[int(rdid)]
            cxr, cyr = int((rdx1 + rdx2) / 2), int((rdy1 + rdy2) / 2)

            print(f"[Rodent] Score: {rdscore:.2f}, Label: {rdlabel}")

            if rdscore < conf:
                continue

            # ── Person overlap check ──────────────────
            if any(px1 < cxr < px2 and py1 < cyr < py2
                   for px1, py1, px2, py2 in person_boxes):
                print(f"[Rodent] Skipping — inside person box")
                continue

            # ── Similarity check ──────────────────────
            crop = frame[rdy1:rdy2, rdx1:rdx2]
            history = self.rodent_crop_history[camera_id]
            if history and any(self._is_similar_frame(crop, prev) for prev in history):
                print(f"[Rodent] Similar frame — skip")
                continue
            history.append(crop)

            # ── Movement check ────────────────────────
            if self._is_rodent_moving(camera_id, cxr, cyr):
                rodent_count += 1
                cv2.rectangle(frame, (rdx1, rdy1), (rdx2, rdy2), (0, 2, 250), 2)
                cv2.putText(
                    frame,
                    f"Rodent {rdscore:.2f}",
                    (cxr, cyr - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 2, 250), 2
                )

        return {
            "rodent": rodent_count,
            "frame":  frame
        }