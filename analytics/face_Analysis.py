import os
import time
import pickle
import cv2
import numpy as np
import logging
from insightface.app import FaceAnalysis

logger = logging.getLogger(__name__)

# ==========================================
# CONFIGURATION
# ==========================================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMPLOYEE_DB_DIR    = os.path.join(BASE_DIR, "employee_db")
EMBEDDINGS_CACHE   = os.path.join(BASE_DIR, "embeddings.pkl")

INSIGHTFACE_MODEL  = "buffalo_l"
DET_SIZE           = (640, 640)
DET_THRESH         = 0.50
SIMILARITY_THRESHOLD = 0.45
SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

COLOR_KNOWN   = (0, 220, 100)
COLOR_UNKNOWN = (0, 80, 255)
BOX_THICKNESS = 2
FONT          = cv2.FONT_HERSHEY_SIMPLEX

class FaceAnalysisDetector:
    def __init__(self):
        logger.info(f"  ↓ Loading InsightFace '{INSIGHTFACE_MODEL}' ...")

        # Detect available providers to avoid CUDA library error spam
        try:
            import onnxruntime as ort
            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
                logger.info("  ℹ GPU (CUDA) detected — using CUDAExecutionProvider")
            else:
                providers = ["CPUExecutionProvider"]
                logger.info("  ℹ No GPU detected — using CPUExecutionProvider")
        except Exception:
            providers = ["CPUExecutionProvider"]

        self.app = FaceAnalysis(
            name=INSIGHTFACE_MODEL,
            root=BASE_DIR,  # Models will be saved/loaded from BASE_DIR/models/
            providers=providers,
        )
        # ctx_id=0 → GPU if available, ctx_id=-1 → force CPU
        ctx = 0 if "CUDAExecutionProvider" in providers else -1
        self.app.prepare(ctx_id=ctx, det_size=DET_SIZE, det_thresh=DET_THRESH)
        logger.info("  ✓ buffalo_l ready (SCRFD detector + ArcFace R100)")
        
        # Ensure database directory exists
        os.makedirs(EMPLOYEE_DB_DIR, exist_ok=True)
        self.database = self.build_database()

    def get_faces(self, image_bgr):
        if image_bgr is None or image_bgr.size == 0:
            return []
        return self.app.get(image_bgr)

    def identify(self, embedding, database, threshold=SIMILARITY_THRESHOLD):
        if embedding is None or not database:
            return "Unknown", 0.0

        best_name  = "Unknown"
        best_score = 0.0

        for name, db_emb in database:
            score = float(np.dot(embedding, db_emb))
            if score > best_score:
                best_score = score
                best_name  = name

        if best_score < threshold:
            return "Unknown", best_score
        return best_name, best_score

    def encode_person(self, img, name):
        faces = self.get_faces(img)
        if not faces:
            logger.warning(f"    ✗ {name:<20s}  — no face detected!")
            return None
        best_face = max(faces, key=lambda f: f.det_score)
        logger.info(f"    ✓ {name:<20s}  (det_score: {best_face.det_score:.2f})")
        return best_face.normed_embedding

    def cache_is_valid(self, db_dir, cache_path):
        if not os.path.exists(cache_path):
            return False
        cache_mtime = os.path.getmtime(cache_path)
        for fname in os.listdir(db_dir):
            fpath = os.path.join(db_dir, fname)
            if os.path.isfile(fpath) and os.path.getmtime(fpath) > cache_mtime:
                return False
        return True

    def build_database(self):
        db_dir     = EMPLOYEE_DB_DIR
        cache_path = EMBEDDINGS_CACHE

        if self.cache_is_valid(db_dir, cache_path):
            logger.info("  ✓ Loading cached face embeddings ...")
            try:
                with open(cache_path, "rb") as f:
                    db = pickle.load(f)
                logger.info(f"  ✓ Loaded {len(db)} face(s) from cache")
                return db
            except Exception as e:
                logger.error(f"Failed to load cache: {e}. Rebuilding...")

        logger.info(f"  → Scanning face database: {db_dir}")
        database = []
        image_files = sorted([
            f for f in os.listdir(db_dir)
            if os.path.splitext(f)[1].lower() in SUPPORTED_EXTS
        ])

        if not image_files:
            logger.warning(f"  [WARNING] No face images found in {db_dir}")
            return database

        for filename in image_files:
            filepath = os.path.join(db_dir, filename)
            name     = os.path.splitext(filename)[0].replace("_", " ")
            img = cv2.imread(filepath)
            if img is None:
                continue
            embedding = self.encode_person(img, name)
            if embedding is not None:
                database.append((name, embedding))

        if database:
            with open(cache_path, "wb") as f:
                pickle.dump(database, f)
            logger.info(f"  ✓ Face database saved → {cache_path}")
        return database

    def detect(self, frame, camera_id, person_boxes=None):
        faces = self.get_faces(frame)
        recognized_details = []
        
        for face in faces:
            bbox      = face.bbox.astype(int)
            embedding = face.normed_embedding
            det_conf  = float(face.det_score)

            name, score = self.identify(embedding, self.database, SIMILARITY_THRESHOLD)
            
            is_known = name != "Unknown"
            color    = COLOR_KNOWN if is_known else COLOR_UNKNOWN
            label    = f"{name} ({score:.0%})" if is_known else "Unknown"
            
            x1, y1, x2, y2 = bbox
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, BOX_THICKNESS)
            
            (tw, th), _ = cv2.getTextSize(label, FONT, 0.65, 2)
            label_y = max(y1, th + 10)
            cv2.rectangle(frame, (x1, label_y - th - 8), (x1 + tw + 8, label_y + 4), color, -1)
            cv2.putText(frame, label, (x1 + 4, label_y - 2), FONT, 0.65, (255, 255, 255), 2)
            
            if is_known:
                bar_h = y2 - y1
                fill  = int(bar_h * min(score, 1.0))
                bar_x = x2 + 4
                cv2.rectangle(frame, (bar_x, y1),          (bar_x + 8, y2),          (80, 80, 80), -1)
                cv2.rectangle(frame, (bar_x, y2 - fill),   (bar_x + 8, y2),          color,        -1)
            
            recognized_details.append({
                "name": name,
                "confidence": score,
                "bbox": [int(b) for b in bbox]
            })

        return {
            "face_analysis": recognized_details,
            "frame": frame
        }
