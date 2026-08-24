import cv2
import time
import os
import numpy as np
from collections import defaultdict

# ==========================================
# CONFIGURATION
# ==========================================
ALERT_DIR = "abandoned_alerts"
os.makedirs(ALERT_DIR, exist_ok=True)

# Include furniture classes so YOLO's NMS can use them to suppress false bags
TARGET_CLASSES        = [0, 24, 26, 28, 56, 57, 62, 63]  
YOLO_CONF             = 0.28           

# We only track these as abandoned
BAG_CLASSES           = {24: "backpack", 26: "handbag", 28: "suitcase"}
# We use these exclusively to cancel out false bag detections
FURNITURE_CLASSES     = {56: "chair", 57: "couch", 62: "tv", 63: "laptop"}

# ── TRACKING & TIMING ─────────────────────────────────────────────────────────
DIST_MATCH_THRESH     = 90            # px — max distance a centroid can drift between frames
PERSON_PROXIMITY_PX   = 800           # px — radius around bag to check for an owner
MAX_MISSING_SECS      = 8.0           # seconds — how long to remember a bag if YOLO blinks
PERSON_CACHE_SECS     = 2.0           # seconds — how long to remember a person if YOLO blinks

SUSPICIOUS_SECS       = 5.0
ABANDONED_SECS        = 20.0

# ==========================================
# HELPER FUNCTIONS
# ==========================================
def get_centroid(bbox):
    return ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)

def dist(a, b):
    return np.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2)

def bbox_area(bbox):
    return abs(bbox[2]-bbox[0]) * abs(bbox[3]-bbox[1])

def compute_iou(A, B):
    ix1, iy1 = max(A[0], B[0]), max(A[1], B[1])
    ix2, iy2 = min(A[2], B[2]), min(A[3], B[3])
    inter = max(0, ix2-ix1) * max(0, iy2-iy1)
    if inter == 0:
        return 0.0
    return inter / float(bbox_area(A) + bbox_area(B) - inter)

def centroid_inside_bbox(centroid, bbox):
    return bbox[0] <= centroid[0] <= bbox[2] and bbox[1] <= centroid[1] <= bbox[3]

def is_false_detection(bag_bbox, person_bboxes):
    """Filters out bags that are actually just parts of a person's body."""
    bag_cx, bag_cy = get_centroid(bag_bbox)
    for p in person_bboxes:
        if centroid_inside_bbox((bag_cx, bag_cy), p): return True
        if compute_iou(bag_bbox, p) > 0.25: return True
        if bag_bbox[0] >= p[0] and bag_bbox[1] >= p[1] and bag_bbox[2] <= p[2] and bag_bbox[3] <= p[3]:
            return True
    return False

def is_overlapping_furniture(bag_bbox, furniture_bboxes):
    """Filters out false bag detections that share space with known furniture/laptops."""
    for f in furniture_bboxes:
        # If the 'bag' box overlaps more than 40% with a chair/laptop, reject it
        if compute_iou(bag_bbox, f) > 0.40:
            return True
    return False

def is_person_nearby(bag_bbox, person_bboxes):
    """Checks if any person is within the owner proximity radius."""
    bag_c = get_centroid(bag_bbox)
    for p in person_bboxes:
        if dist(bag_c, get_centroid(p)) < PERSON_PROXIMITY_PX:
            return True
    return False


# ==========================================
# ABANDONED OBJECT DETECTOR CLASS
# ==========================================
class AbandonedObjectDetector:
    def __init__(self, model):
        self.model = model
        
        # Per-camera state dictionaries
        self.tracked_items = defaultdict(dict)
        self.item_id_counter = defaultdict(int)
        self.last_alert_state = defaultdict(dict)
        self.last_known_persons = defaultdict(list)
        self.last_persons_time = defaultdict(float)

    def process_track(self, bbox, cls_id, conf, current_time, person_bboxes, frame, camera_id):
        best_id, best_d = None, float('inf')
        cx, cy = get_centroid(bbox)
        
        for tid, item in self.tracked_items[camera_id].items():
            tc = get_centroid(item["bbox"])
            d = dist((cx,cy), tc)
            if d < DIST_MATCH_THRESH and d < best_d:
                best_d, best_id = d, tid


        if best_id is not None:
            tid = best_id
            old = self.tracked_items[camera_id][tid]
            first_seen = old["first_seen"]
            image_saved = old.get("image_saved", False)
        else:
            tid = self.item_id_counter[camera_id]
            self.item_id_counter[camera_id] += 1
            first_seen = current_time
            image_saved = False

        cls_name = BAG_CLASSES.get(cls_id, "bag")
        elapsed = current_time - first_seen
        has_owner = is_person_nearby(bbox, person_bboxes)

        if has_owner:
            new_state = "Normal"
            first_seen = current_time 
        elif elapsed >= ABANDONED_SECS:
            new_state = "Abandoned"
        elif elapsed >= SUSPICIOUS_SECS:
            new_state = "Suspicious"
        else:
            new_state = "Tracking"

        if new_state == "Abandoned" and not image_saved:
            self.save_alert_images(frame, bbox, tid, cls_name, camera_id)
            image_saved = True

        self.tracked_items[camera_id][tid] = {
            "bbox": bbox,
            "class_id": cls_id,
            "class_name": cls_name,
            "first_seen": first_seen,
            "last_seen": current_time,
            "state": new_state,
            "image_saved": image_saved,
            "conf": conf
        }
        return tid

    def save_alert_images(self, frame, bbox, item_id, class_name, camera_id):
        ts = time.strftime("%Y%m%d_%H%M%S")
        x1, y1, x2, y2 = map(int, bbox)
        H, W, _ = frame.shape
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(W, x2), min(H, y2)
        crop = frame[y1:y2, x1:x2]
        
        crop_f = f"{ALERT_DIR}/{camera_id}_ID{item_id}_{class_name}_{ts}_crop.jpg"
        full_f = f"{ALERT_DIR}/{camera_id}_ID{item_id}_{class_name}_{ts}_full.jpg"
        if crop.size > 0: cv2.imwrite(crop_f, crop)
        cv2.imwrite(full_f, frame)

    def detect(self, frame, camera_id, person_boxes=None):
        """
        Args:
            frame       : BGR numpy array
            camera_id   : str — used to keep per-camera state
            person_boxes: list of (x1,y1,x2,y2) 

        Returns:
            {"abandoned_object": count (>0 only when alert fires), "frame": annotated_frame}
        """
        if person_boxes is None:
            person_boxes = []

        current_time = time.time()
        
        # ─── 1. INFERENCE ─────────────────────────────────────────────────
        results = self.model(frame, classes=TARGET_CLASSES, conf=YOLO_CONF, iou=0.50, verbose=False)
        
        current_bags = []
        current_persons = []
        current_furniture = []

        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                bbox = box.xyxy[0].cpu().numpy().tolist()
                
                # Sort detections into categories
                if cls_id == 0:
                    current_persons.append(bbox)
                elif cls_id in FURNITURE_CLASSES:
                    current_furniture.append(bbox)
                elif cls_id in BAG_CLASSES:
                    current_bags.append({"bbox": bbox, "class_id": cls_id, "conf": conf})

        # Augment detected persons with any provided via argument
        for pb in person_boxes:
            current_persons.append(pb)

        # ─── 2. UPDATE CACHES ─────────────────────────────────────────────
        if current_persons:
            self.last_known_persons[camera_id] = current_persons
            self.last_persons_time[camera_id] = current_time
        
        if (current_time - self.last_persons_time[camera_id]) <= PERSON_CACHE_SECS:
            effective_persons = self.last_known_persons[camera_id]
        else:
            effective_persons = []

        # ─── 3. PROCESS TRACKS ────────────────────────────────────────────
        matched_this_frame = set()
        
        for bag in current_bags:
            # Drop bag if it's on a person's body
            if is_false_detection(bag["bbox"], effective_persons):
                continue
            
            # Drop bag if it's actually just a chair or a laptop (Spatial Filter)
            if is_overlapping_furniture(bag["bbox"], current_furniture):
                continue
            
            tid = self.process_track(bag["bbox"], bag["class_id"], bag["conf"], current_time, effective_persons, frame, camera_id)
            matched_this_frame.add(tid)

        # ─── 4. EXPIRE STALE TRACKS ───────────────────────────────────────
        expired = []
        for tid, item in self.tracked_items[camera_id].items():
            if tid in matched_this_frame:
                continue
            
            missing_for = current_time - item["last_seen"]
            if missing_for > MAX_MISSING_SECS:
                expired.append(tid)

        for eid in expired:
            del self.tracked_items[camera_id][eid]
            self.last_alert_state[camera_id].pop(eid, None)

        # ─── 5. VISUALISATION ─────────────────────────────────────────────
        abandoned_count = 0
        for tid, item in self.tracked_items[camera_id].items():
            x1, y1, x2, y2 = map(int, item["bbox"])
            state = item["state"]
            
            missing_for = current_time - item["last_seen"]
            is_ghost = missing_for > 0.5 

            if state == "Abandoned":
                color = (0, 0, 255)
                # Count as alert only if it's actively seen (not ghost)
                if not is_ghost:
                    abandoned_count += 1
            elif state == "Suspicious":
                color = (0, 200, 255)
            elif state == "Normal":
                color = (0, 180, 0)
            else:
                color = (100, 255, 100)

            if is_ghost: color = (color[0]//2, color[1]//2, color[2]//2)

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, f"#{tid} {state}", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        return {
            "abandoned_object": abandoned_count if abandoned_count > 0 else 0,
            "frame": frame
        }
