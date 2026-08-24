import os
import pika
import pickle
import cv2
import time
import logging
import threading
import numpy as np
from ultralytics import YOLO
import torch

print("\n" + "="*50)
if torch.cuda.is_available():
    print(f"🚀 SYSTEM STARTING WITH GPU: {torch.cuda.get_device_name(0)}")
else:
    print("⚠️ SYSTEM STARTING WITH CPU ONLY! (No GPU detected)")
print("="*50 + "\n")

from Detection.fire      import FireDetector
from Detection.crowd     import CrowdDetector
from Detection.rodent    import RodentDetector
from Detection.anpr      import ANPRDetector
from Detection.garbage   import GarbageDetector
from Detection.truck_sweeper import TruckSweeperDetector
from Detection.intrusion import IntrusionDetector
from Detection.abandoned_object import AbandonedObjectDetector
from Detection.face_Analysis import FaceAnalysisDetector
from Detection.tamper import ConsumerTamperDetector
# To add a new model: from Detection.<name> import <Name>Detector

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── Watchdog Thread — Kills process if GPU freezes ──────────────────────────
# Har frame process hone ke baad yeh file touch hoti hai.
# Agar 60 sec se update nahi hui → Watchdog Python process ko kill karega → Docker automatically restart karega
HEARTBEAT_FILE = "/tmp/consumer_heartbeat"


def touch_heartbeat():
    """Update heartbeat file timestamp — signals that consumer is alive."""
    try:
        with open(HEARTBEAT_FILE, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass  # heartbeat fail hone pe crash nahi karna

def heartbeat_watchdog():
    """Runs in background and checks if heartbeat is older than 60s."""
    while True:
        time.sleep(10)
        try:
            if os.path.exists(HEARTBEAT_FILE):
                with open(HEARTBEAT_FILE, "r") as f:
                    last_update = float(f.read().strip())
                if time.time() - last_update > 30:
                    logger.error("🚨 WATCHDOG: Consumer hung for >60s! Killing process to trigger Docker restart...")
                    os._exit(1) # Forcefully kill the entire process
        except Exception as e:
            logger.error(f"Watchdog error: {e}")


# ─────────────────────────────────────────────────────────────────────────────
#  PATHS & ENVIRONMENT
# ─────────────────────────────────────────────────────────────────────────────

ANALYTICS_DIR = os.path.dirname(os.path.abspath(__file__))   # analytics_engine/
MODEL_DIR     = os.path.join(ANALYTICS_DIR, "models")         # analytics_engine/models/  (.pt files here)

# ROI API base URL — used by IntrusionDetector to fetch zone definitions
# Set via env var in dockerfile / docker-compose
ROI_API_URL = os.environ.get("ROI_API_URL", "http://api:8000")


# ─────────────────────────────────────────────────────────────────────────────
#  ROUTING — maps API object_list keyword → internal model key
#
#  HOW TO ADD A NEW MODEL (3 steps in this one file):
#    Step 1 → Add your .pt file to analytics_engine/models/
#    Step 2 → Create analytics_engine/Detection/<name>.py
#             (detect() must return {"label": count, "frame": annotated_frame})
#    Step 3 → Import the class above, add to OBJECT_TO_MODEL, load_models(), MODEL_DISPATCH
# ─────────────────────────────────────────────────────────────────────────────

OBJECT_TO_MODEL = {
    "fire":          "fire_smoke",
    "smoke":         "fire_smoke",    # "fire" and "smoke" both map to the same model
    "rodent":        "rodent",
    "crowd":         "crowd",
    "anpr":          "anpr",          # license plate detection
    "garbage":       "garbage",       # garbage / litter detection
    "truck_sweeper": "truck_sweeper",
    "intrusion":     "intrusion",     # ROI-based intrusion detection (priority zones)
    "abandoned_object": "abandoned_object", # Abandoned object detection
    "face_analysis": "face_analysis", # Face Analysis using InsightFace
    "tamper":        "tamper",        # Tamper detection
    # "vehicle":     "vehicle",       # ← example: uncomment after adding model
}


def route_frame(object_list):
    """
    Returns list of unique model keys to run, based solely on object_list.

    Args:
        object_list: list[str] or comma-separated str (from API payload)

    Returns:
        list[str]: e.g. ["fire_smoke", "rodent"]. Empty list = nothing to run.
    """
    if not object_list:
        return []

    if isinstance(object_list, str):
        # Remove brackets and quotes that might be left over from JSON/Python string representations
        cleaned = object_list.replace("[", "").replace("]", "").replace("'", "").replace('"', "")
        # Replace commas with spaces, then split by whitespace to support both formats
        items = [o.strip().lower() for o in cleaned.replace(",", " ").split()]
    elif isinstance(object_list, list):
        items = [str(o).strip().lower() for o in object_list]
    else:
        return []

    seen          = set()
    models_to_run = []

    for item in items:
        model_key = OBJECT_TO_MODEL.get(item)
        if model_key and model_key not in seen:
            models_to_run.append(model_key)
            seen.add(model_key)
        elif not model_key:
            pass  # Suppress warning to avoid console spam for every frame

    return models_to_run


# ─────────────────────────────────────────────────────────────────────────────
#  MODEL LOADING — runs once at startup
# ─────────────────────────────────────────────────────────────────────────────

def load_models():
    """
    Load all YOLO models and wrap them in detector classes.
    Keys MUST match OBJECT_TO_MODEL values and MODEL_DISPATCH keys.

    To add a new model:
      1. Add your .pt file to analytics_engine/models/
      2. Create analytics_engine/Detection/<name>.py
      3. Import detector class at the top of this file
      4. Load:  new_model      = YOLO(os.path.join(MODEL_DIR, "your.pt"))
      5. Add:   models["key"] = YourDetector(new_model)
      6. Add entry in OBJECT_TO_MODEL and MODEL_DISPATCH below
    """
    models = {}

    fire_model   = YOLO(os.path.join(MODEL_DIR, "nikhil_firesmokeother_best.pt"))
    crowd_model  = YOLO(os.path.join(MODEL_DIR, "yolov8m.pt"))
    rodent_model = YOLO(os.path.join(MODEL_DIR, "yolo12n.pt"))
    person_model = YOLO(os.path.join(MODEL_DIR, "yolo12n.pt"))

    models["fire_smoke"] = FireDetector(fire_model)
    models["crowd"]      = CrowdDetector(crowd_model)
    models["rodent"]     = RodentDetector(rodent_model)
    models["person"]     = person_model                # raw YOLO — exclusion boxes only

    # ANPR — load only if model file exists (optional model)
    anpr_pt = os.path.join(MODEL_DIR, "license_plate_detector.pt")
    if os.path.exists(anpr_pt):
        anpr_model     = YOLO(anpr_pt)
        models["anpr"] = ANPRDetector(anpr_model)
        logger.info("[Loader] ✅ ANPR model loaded")
    else:
        logger.warning(f"[Loader] ⚠ ANPR model not found at {anpr_pt} — ANPR disabled")

    # Garbage — load only if model file exists (optional model)
    garbage_pt = os.path.join(MODEL_DIR, "garbage.pt")
    if os.path.exists(garbage_pt):
        garbage_model     = YOLO(garbage_pt)
        models["garbage"] = GarbageDetector(garbage_model)
        logger.info("[Loader] ✅ Garbage model loaded")
    else:
        logger.warning(f"[Loader] ⚠ Garbage model not found at {garbage_pt} — Garbage disabled")

    # Truck Sweeper — load only if model file exists (optional model)
    truck_sweeper_pt = os.path.join(MODEL_DIR, "garbage.pt")
    if os.path.exists(truck_sweeper_pt):
        truck_sweeper_model = YOLO(truck_sweeper_pt)
        models["truck_sweeper"] = TruckSweeperDetector(truck_sweeper_model)
        logger.info("[Loader] ✅ Truck Sweeper model loaded")
    else:
        logger.warning(f"[Loader] ⚠ Truck Sweeper model not found at {truck_sweeper_pt} — Truck Sweeper disabled")

    # Intrusion — uses yolov8m.pt (person detection) + ROI zones from API
    # Reuses the crowd_model weight file (yolov8m) — no separate .pt needed
    intrusion_pt = os.path.join(MODEL_DIR, "yolov8m.pt")
    if os.path.exists(intrusion_pt):
        intrusion_model        = YOLO(intrusion_pt)
        models["intrusion"]    = IntrusionDetector(intrusion_model)
        logger.info("[Loader] ✅ Intrusion model loaded (ROI zones via ROI_API_URL=%s)", ROI_API_URL)
    else:
        logger.warning(f"[Loader] ⚠ Intrusion model not found at {intrusion_pt} — Intrusion disabled")

    # Abandoned Object — load only if model file exists
    abandoned_pt = os.path.join(MODEL_DIR, "yolov8l.pt")
    if os.path.exists(abandoned_pt):
        abandoned_model = YOLO(abandoned_pt)
        models["abandoned_object"] = AbandonedObjectDetector(abandoned_model)
        logger.info("[Loader] ✅ Abandoned Object model loaded")
    else:
        logger.warning(f"[Loader] ⚠ Abandoned Object model not found at {abandoned_pt} — Abandoned Object disabled")

    # Face Analysis - InsightFace model (downloads automatically if not present)
    try:
        models["face_analysis"] = FaceAnalysisDetector()
        logger.info("[Loader] ✅ Face Analysis model loaded (InsightFace buffalo_l)")
    except Exception as e:
        logger.warning(f"[Loader] ⚠ Face Analysis model failed to load: {e}")

    # Tamper Detection
    try:
        models["tamper"] = ConsumerTamperDetector()
        logger.info("[Loader] ✅ Tamper model loaded")
    except Exception as e:
        logger.warning(f"[Loader] ⚠ Tamper model failed to load: {e}")

    return models


# ── Load once at startup ──────────────────────────────────────────────────────
models = load_models()


# ─────────────────────────────────────────────────────────────────────────────
#  MODEL_DISPATCH — single place to wire model keys → detectors + output labels
#
#  Format:
#    "model_key": (detector_instance, boxes_type, [(result_key, output_label), ...])
#
#  boxes_type:
#    "fire_boxes"   — persons + animals (fire exclusion zone)
#    "person_boxes" — persons only
#
#  To add a new model: add ONE row here (after steps above)
#    "key": (models["key"], "person_boxes", [("result_label", "Output Label")]),
# ─────────────────────────────────────────────────────────────────────────────

MODEL_DISPATCH = {
    "fire_smoke": (models["fire_smoke"], "fire_boxes",   [("fire",         "Fire"),
                                                           ("smoke",        "Smoke")]),
    "rodent":     (models["rodent"],     "person_boxes", [("rodent",       "Rodent")]),
    "crowd":      (models["crowd"],      "person_boxes", [("crowd",        "Crowd")]),
    # Optional models — added only if loaded successfully
    **({"anpr":    (models["anpr"],    "person_boxes", [("number_plate", "NumberPlate")])}
       if "anpr"    in models else {}),
    **({"garbage": (models["garbage"], "person_boxes", [("garbage",      "Garbage")])}
       if "garbage" in models else {}),
    **({"truck_sweeper": (models["truck_sweeper"], "person_boxes", [("truck_sweeper", "TruckSweeper")])}
       if "truck_sweeper" in models else {}),
    # Intrusion: ROI-based priority zone detection (only active when object_list contains "intrusion")
    # Result keys match the dynamic labels produced by IntrusionDetector: "HIGH Intrusion" etc.
    **({"intrusion": (models["intrusion"], "person_boxes", [
           ("HIGH Intrusion",   "HIGH Intrusion"),
           ("MEDIUM Intrusion", "MEDIUM Intrusion"),
           ("LOW Intrusion",    "LOW Intrusion"),
       ])}
       if "intrusion" in models else {}),
    **({"abandoned_object": (models["abandoned_object"], "person_boxes", [("abandoned_object", "AbandonedObject")])}
       if "abandoned_object" in models else {}),
    **({"face_analysis": (models["face_analysis"], "person_boxes", [("face_analysis", "FaceAnalysis")])}
       if "face_analysis" in models else {}),
    **({"tamper": (models["tamper"], "person_boxes", [("tamper", "Tamper")])}
       if "tamper" in models else {}),
    # "vehicle": (models["vehicle"], "person_boxes", [("vehicle", "Vehicle")]),
}


# ─────────────────────────────────────────────────────────────────────────────
#  RABBITMQ HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def setup_rabbitmq_connection(queue_name, rabbitmq_host, retry_delay=5):
    while True:
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(
                host=rabbitmq_host, heartbeat=600, blocked_connection_timeout=300,
            ))
            channel = connection.channel()
            channel.queue_declare(queue=queue_name, durable=True,
                                  arguments={"x-max-length": 150, "x-overflow": "drop-head"})
            return connection, channel
        except pika.exceptions.AMQPConnectionError as e:
            logger.error(f"[Consumer] RabbitMQ connection failed: {e} — retrying in {retry_delay}s")
            time.sleep(retry_delay)


def publish_detection(channel, queue_name, rabbitmq_host,
                      camera_id, camera_ip, frame_datetime,
                      frame_bytes, detected_object, user_id, credit_id, detection_type):
    image_info = {
        "Event_Type": "Analytics",
        "CameraId":   camera_id,
        "CameraIp":   camera_ip,
        "Datetime":   frame_datetime,
        "Image":      frame_bytes,        # always JPEG bytes
        "Object":     detected_object,
        "UserId":     user_id,
        "CreditId":   credit_id,
        "DetectionType": detection_type,
    }
    try:
        channel.basic_publish(
            exchange="",
            routing_key=queue_name,
            body=pickle.dumps(image_info),
            properties=pika.BasicProperties(delivery_mode=2)
        )
        logger.info(f"[Consumer] ✅ Published | Camera: {camera_id} | {detected_object}")
    except Exception as e:
        logger.error(f"[Consumer] Publish failed: {e} — reconnecting")
        _, channel = setup_rabbitmq_connection(queue_name, rabbitmq_host)
    return channel


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN FRAME PROCESSOR
# ─────────────────────────────────────────────────────────────────────────────

def process_frame(ch, method, properties, body,
                  processed_channel, processed_queue_name, rabbitmq_host):

    if not processed_channel.is_open:
        _, processed_channel = setup_rabbitmq_connection(processed_queue_name, rabbitmq_host)

    try:
        frame_data     = pickle.loads(body)
        camera_id      = frame_data["camera_id"]
        camera_ip      = frame_data["camera_ip"]
        object_list    = frame_data["object_list"]
        frame_datetime = frame_data["datetime"]
        # Use .get() to avoid KeyError if new fields are missing
        user_id        = frame_data.get("user_id", "")
        credit_id      = frame_data.get("credit_id", "")

        # ── Check for EOF ─────────────────────────────────────────────────
        if frame_data.get("eof") is True:
            logger.info(f"[Consumer] EOF received for {camera_id}. Forwarding EOF signal to processed queue.")
            processed_channel = publish_detection(
                processed_channel, processed_queue_name, rabbitmq_host,
                camera_id, camera_ip, frame_datetime,
                None, {"eof": True}, user_id, credit_id
            )
            return processed_channel

        # ── Step 1: Decode frame ──────────────────────────────────────────
        raw_frame = frame_data.get("frame")
        if isinstance(raw_frame, (bytes, bytearray)):
            np_arr = np.frombuffer(raw_frame, dtype=np.uint8)
            frame  = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        elif isinstance(raw_frame, np.ndarray):
            frame = raw_frame
        else:
            logger.warning(f"[Consumer] Unknown frame type: {type(raw_frame)} — skipping")
            return processed_channel

        if frame is None or frame.size == 0:
            logger.warning(f"[Consumer] Empty/corrupt frame from {camera_id} — skipping")
            return processed_channel

        # Resizing to 640x480 EXACTLY matches the old monolithic code, 
        # which boosted YOLO confidence and calibrated the 18px threshold.
        frame = cv2.resize(frame, (640, 480))

        # ── Step 2: Route — which models to run based on object_list only ─
        models_to_run = route_frame(object_list)
        if not models_to_run:
            logger.debug(f"[Consumer] {camera_id} — no models matched {object_list}")
            return processed_channel

        logger.info(f"[Consumer] {camera_id} | {object_list} → {models_to_run}")

        # ── Step 3: Person / fire exclusion boxes ─────────────────────────
        person_boxes = []
        fire_boxes   = []
        try:
            person_result = models["person"](frame, verbose=False, classes=[0, 15, 16, 17, 19])[0]
            for px1, py1, px2, py2, pscore, pid in person_result.boxes.data.tolist():
                px1, py1, px2, py2 = map(int, [px1, py1, px2, py2])
                label = person_result.names[int(pid)]
                fire_boxes.append((px1, py1, px2, py2))   # all classes → fire exclusion
                if label == "person":
                    person_boxes.append((px1, py1, px2, py2))
        except Exception as e:
            logger.warning(f"[Consumer] Person model failed: {e} — continuing without boxes")

        # ── Step 4: Har model ke liye ek fresh copy — sirf utni copies jitne
        #           models object_list mein hain (len(models_to_run) copies total)

        for model_key in models_to_run:
            if model_key not in MODEL_DISPATCH:
                logger.warning(f"[Consumer] '{model_key}' not in MODEL_DISPATCH — skipping")
                continue

            detector, boxes_type, result_keys = MODEL_DISPATCH[model_key]
            boxes = fire_boxes if boxes_type == "fire_boxes" else person_boxes

            try:
                model_input = frame.copy()          # ← fresh copy per model, direct from original
                result      = detector.detect(model_input, camera_id, person_boxes=boxes)
                model_frame = result.get("frame", model_input)  # annotated frame from this model

                model_detections = {}
                for raw_key, out_label in result_keys:
                    val = result.get(raw_key)
                    if val:   # [] aur 0 skip — sirf actual detection publish hogi
                        model_detections[out_label] = val

                # ── Step 5: publish per-model alert (only if something detected)
                if model_detections:
                    try:
                        _, buffer   = cv2.imencode('.jpg', model_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                        frame_bytes = buffer.tobytes()
                    except Exception as e:
                        logger.error(f"[Consumer] Frame encode failed for '{model_key}': {e}")
                        frame_bytes = raw_frame

                    processed_channel = publish_detection(
                        processed_channel, processed_queue_name, rabbitmq_host,
                        camera_id, camera_ip, frame_datetime,
                        frame_bytes, model_detections, user_id, credit_id,
                        detection_type=model_key
                    )

            except Exception as e:
                logger.error(f"[Consumer] Error running model '{model_key}': {e}")

    except Exception as e:
        logger.error(f"[Consumer] Unhandled error: {e}")

    return processed_channel


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main(
    queue_name="all_frames_1",
    processed_queue_name="video_analytics",
    rabbitmq_host=os.environ.get("RABBITMQ_HOST", "localhost")
):
    # Start the watchdog thread to monitor GPU freezes
    watchdog_thread = threading.Thread(target=heartbeat_watchdog, daemon=True)
    watchdog_thread.start()
    logger.info("[Consumer] 👀 Watchdog thread started.")

    while True:
        try:
            receiver_connection,  receiver_channel  = setup_rabbitmq_connection(queue_name,           rabbitmq_host)
            processed_connection, processed_channel = setup_rabbitmq_connection(processed_queue_name, rabbitmq_host)

            receiver_channel.basic_qos(prefetch_count=1)   # fair dispatch across replicas
            channel_ref = [processed_channel]

            def callback(ch, method, properties, body):
                try:
                    channel_ref[0] = process_frame(
                        ch, method, properties, body,
                        channel_ref[0], processed_queue_name, rabbitmq_host
                    )
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                    touch_heartbeat()   # ← frame processed successfully, heartbeat update
                except Exception as e:
                    logger.error(f"[Consumer] Callback error: {e}")
                    try:
                        ch.basic_reject(delivery_tag=method.delivery_tag, requeue=True)
                    except Exception:
                        pass

            receiver_channel.basic_consume(
                queue=queue_name,
                on_message_callback=callback,
                auto_ack=False
            )

            logger.info("[Consumer] ✅ Waiting for frames...")
            touch_heartbeat()   # ← startup pe bhi heartbeat set karo
            receiver_channel.start_consuming()

        except pika.exceptions.AMQPConnectionError as e:
            logger.error(f"[Consumer] RabbitMQ error: {e} — retrying in 10s")
            time.sleep(10)

        except Exception as e:
            logger.error(f"[Consumer] Fatal error: {e} — retrying in 10s")
            time.sleep(10)


if __name__ == "__main__":
    # CONSUMER_GROUP env var se queue decide hota hai — docker-compose mein set karo
    group = int(os.environ.get("CONSUMER_GROUP", 1))

    logging.info(
        f"[Consumer] Starting | group={group} | "
        f"input=all_frames_{group} | output=video_analytics"
    )

    main(
        queue_name           = f"all_frames_{group}",   # is group ki frames yahan se aayengi
        processed_queue_name = "video_analytics",        # single output queue — sab groups ka output yahan
    )