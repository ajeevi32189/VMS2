import os
import cv2
import time
import datetime
import threading
import easyocr
from collections import OrderedDict
from difflib import SequenceMatcher

# ──────────────────────────────────────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────────────────────────────────────
ANPR_CONFIDENCE_THRESHOLD = 0.4
ANPR_OCR_LANGUAGES        = ["en"]
ANPR_OCR_MIN_CONFIDENCE   = 0.3
ANPR_DEDUP_COOLDOWN       = 30        # seconds before same plate allowed again
ANPR_DEDUP_SIMILARITY     = 0.85      # SequenceMatcher ratio threshold
ANPR_SAVE_PLATES          = True      # save plate crop + annotated frame to disk
ANPR_OUTPUT_DIR           = "anpr_detections"


# ──────────────────────────────────────────────────────────────────────────────
#  PLATE DEDUPLICATOR  — prevents same plate from being counted repeatedly
# ──────────────────────────────────────────────────────────────────────────────

class PlateDeduplicator:

    def __init__(self, cooldown_seconds=30, similarity_threshold=0.85):
        self.cooldown   = cooldown_seconds
        self.similarity = similarity_threshold
        self.recent     = OrderedDict()
        self.lock       = threading.Lock()

    def is_duplicate(self, plate_text):
        """Returns True if plate was seen recently (should be skipped)."""
        if not plate_text or len(plate_text) < 3:
            return True

        now = time.time()
        with self.lock:
            # Expire old entries
            expired = [k for k, v in self.recent.items()
                       if now - v > self.cooldown]
            for k in expired:
                del self.recent[k]

            # Check similarity against recent plates
            for existing in list(self.recent.keys()):
                ratio = SequenceMatcher(
                    None, plate_text.upper(), existing.upper()
                ).ratio()
                if ratio >= self.similarity:
                    return True

            # New unique plate
            self.recent[plate_text.upper()] = now
            return False


# ──────────────────────────────────────────────────────────────────────────────
#  ANPR DETECTOR
# ──────────────────────────────────────────────────────────────────────────────

class ANPRDetector:
    """
    ANPR Detection Pipeline — plate detection (YOLO) + OCR (EasyOCR).

    detect() returns:
        {
            "number_plate": int   (count of NEW unique plates in this frame),
            "frame":        ndarray  (annotated frame with bounding boxes)
        }
    """

    def __init__(self, model):
        self.model = model
        self.ocr   = easyocr.Reader(ANPR_OCR_LANGUAGES, gpu=True)
        self.dedup = PlateDeduplicator(
            cooldown_seconds=ANPR_DEDUP_COOLDOWN,
            similarity_threshold=ANPR_DEDUP_SIMILARITY,
        )

        # Create output directories once
        if ANPR_SAVE_PLATES:
            os.makedirs(os.path.join(ANPR_OUTPUT_DIR, "plates"), exist_ok=True)
            os.makedirs(os.path.join(ANPR_OUTPUT_DIR, "frames"), exist_ok=True)

    # ─────────────────────────────────────────────
    #  Pre-process plate crop for better OCR
    # ─────────────────────────────────────────────

    def _preprocess_plate(self, plate_img):
        if plate_img is None or plate_img.size == 0:
            return None
        gray = cv2.cvtColor(plate_img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        if h > 0:
            scale = 80 / h
            gray  = cv2.resize(gray, (int(w * scale), 80),
                                interpolation=cv2.INTER_CUBIC)
        gray = cv2.bilateralFilter(gray, 11, 17, 17)
        return gray

    # ─────────────────────────────────────────────
    #  Run EasyOCR on plate crop
    # ─────────────────────────────────────────────

    def _read_plate_text(self, plate_img):
        """Returns (plate_text: str, confidence: float)."""
        if plate_img is None or plate_img.size == 0:
            return "", 0.0
        preprocessed = self._preprocess_plate(plate_img)
        if preprocessed is None:
            return "", 0.0
        try:
            ocr_results = self.ocr.readtext(preprocessed)
            if not ocr_results:
                return "", 0.0

            texts, confs = [], []
            for (_, text, conf) in ocr_results:
                if conf >= ANPR_OCR_MIN_CONFIDENCE:
                    cleaned = ''.join(
                        c for c in text.strip().upper()
                        if c.isalnum() or c == ' '
                    )
                    if cleaned:
                        texts.append(cleaned)
                        confs.append(conf)

            if texts:
                return ' '.join(texts), sum(confs) / len(confs)
            return "", 0.0

        except Exception as e:
            print(f"[ANPR OCR Error] {e}")
            return "", 0.0

    # ─────────────────────────────────────────────
    #  Main detect method
    # ─────────────────────────────────────────────

    def detect(self, frame, camera_id, person_boxes=None):
        """
        Detect + read license plates in a single frame.

        Args:
            frame       : BGR numpy array
            camera_id   : str (unused but kept for API compatibility)
            person_boxes: unused (kept for API compatibility)

        Returns:
            {"number_plate": count_of_new_unique_plates, "frame": annotated_frame}
        """
        timestamp    = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
        new_plates   = []

        try:
            results = self.model(frame, conf=ANPR_CONFIDENCE_THRESHOLD,
                                 verbose=False)

            for result in results:
                if result.boxes is None or len(result.boxes) == 0:
                    continue

                boxes = result.boxes.xyxy.cpu().numpy()
                confs = result.boxes.conf.cpu().numpy()

                for box, conf in zip(boxes, confs):
                    x1, y1, x2, y2 = map(int, box)
                    x1, y1 = max(0, x1), max(0, y1)
                    x2     = min(frame.shape[1], x2)
                    y2     = min(frame.shape[0], y2)

                    if x2 <= x1 or y2 <= y1:
                        continue

                    plate_crop = frame[y1:y2, x1:x2]
                    if plate_crop.size == 0:
                        continue

                    plate_text, ocr_conf = self._read_plate_text(plate_crop)
                    if not plate_text:
                        continue

                    # Skip duplicates
                    if self.dedup.is_duplicate(plate_text):
                        continue

                    new_plates.append({
                        "text":      plate_text,
                        "det_conf":  float(conf),
                        "ocr_conf":  ocr_conf,
                        "bbox":      (x1, y1, x2, y2),
                        "crop":      plate_crop,
                    })

                    # ── Annotate frame ───────────────────────────────────────
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 255), 2)
                    cv2.putText(frame, plate_text, (x1, y1 - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

                    print(f"[ANPR] 🔎 New plate: {plate_text} "
                          f"(det={conf:.2f}, ocr={ocr_conf:.2f}) | camera: {camera_id}")

                    # ── Save to disk ─────────────────────────────────────────
                    if ANPR_SAVE_PLATES:
                        safe_text  = plate_text.replace(' ', '_')
                        plate_path = os.path.join(
                            ANPR_OUTPUT_DIR, "plates",
                            f"plate_{timestamp}_{safe_text}.jpg"
                        )
                        frame_path = os.path.join(
                            ANPR_OUTPUT_DIR, "frames",
                            f"frame_{timestamp}_{safe_text}.jpg"
                        )
                        cv2.imwrite(plate_path, plate_crop,
                                    [cv2.IMWRITE_JPEG_QUALITY, 95])
                        cv2.imwrite(frame_path, frame,
                                    [cv2.IMWRITE_JPEG_QUALITY, 85])

        except Exception as e:
            print(f"[ANPR Detection Error] {e}")

        return {
            "number_plate": len(new_plates),
            "frame":        frame,
        }
