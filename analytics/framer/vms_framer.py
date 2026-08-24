import pika
import time
import cv2
import pickle
import struct
from multiprocessing import Process, current_process
import logging
import datetime
import threading
import requests
import os
import numpy as np


# ================================================================
# FRAME INTERVAL SETTINGS
# ================================================================
# Live RTSP stream ke liye — bandwidth bachao, 30fps → 1 frame per 2 sec
LIVE_FRAME_INTERVAL = 9   # 30fps camera → 30/9 = ~3 frames/sec (original system ka interval)

# Uploaded file ke liye — accuracy chahiye, zyada frames bhejo
FILE_FRAME_INTERVAL = 3   # 30fps file → har 3rd frame → ~10fps effective

# Scene change sensitivity (0-255 scale, mean pixel diff)
# Agar consecutive frames ka avg diff > yeh value → naya scene → force send karo
SCENE_CHANGE_THRESHOLD = 15.0


# ================================================================
# RABBITMQ LOGGING
# ================================================================

def send_log_to_rabbitmq(log_message):
    try:
        rabbitmq_host = os.environ.get("RABBITMQ_HOST", "localhost")
        connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host, heartbeat=600))
        channel = connection.channel()
        channel.queue_declare(queue='logs', durable=True)
        channel.basic_publish(
            exchange='',
            routing_key='logs',
            body=pickle.dumps(log_message)
        )
        connection.close()
    except Exception as e:
        print(f"Failed to send log to RabbitMQ: {e}")

def log_info(message):
    logging.info(message)
    current_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    send_log_to_rabbitmq({
        "log_level": "INFO",
        "Event_Type": "Start threads for send frames",
        "Message": message,
        "datetime": current_time,
    })

def log_error(message):
    logging.info(message)
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    send_log_to_rabbitmq({
        "log_level": "ERROR",
        "Event_Type": "Start threads for send frames",
        "Message": message,
        "datetime": current_time,
    })

def log_exception(message):
    logging.error(message)
    current_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    send_log_to_rabbitmq({
        "log_level": "EXCEPTION",
        "Event_Type": "Start threads for send frames",
        "Message": message,
        "datetime": current_time,
    })

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


# ================================================================
# CAMERA PROCESS TRACKING
# ================================================================

camera_processes = {}
camera_urls      = {}
user_ids         = {}
credit_ids       = {}
object_lists     = {}
camera_ips       = {}
camera_status    = {}
camera_queues    = {}   # {camera_id: frames_queue_name} — restart pe sahi queue use karne ke liye


# ================================================================
# SCENE CHANGE DETECTOR (only used for uploaded files)
# ================================================================

class SceneChangeDetector:
    """
    Consecutive frames ka grayscale diff check karta hai.
    Agar diff > threshold → naya scene → framer force-send karega.
    """
    def __init__(self, threshold=SCENE_CHANGE_THRESHOLD):
        self.threshold  = threshold
        self.prev_gray  = None

    def is_scene_change(self, frame):
        """Return True agar yeh frame naye scene ka pehla frame hai."""
        gray = cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY)
        if self.prev_gray is None:
            self.prev_gray = gray
            return False                      # pehla frame — scene change nahi
        diff  = cv2.absdiff(gray, self.prev_gray).mean()
        self.prev_gray = gray
        return diff > self.threshold


# ================================================================
# RABBITMQ CONNECTION
# ================================================================

def setup_rabbitmq_connection(queue_name, rabbitmq_host, retry_delay=5):
    while True:
        try:
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(host=rabbitmq_host, heartbeat=600))
            channel = connection.channel()
            channel.queue_declare(
                queue=queue_name, durable=True,
                arguments={"x-max-length": 150, "x-overflow": "drop-head"})
            log_info(f"Connected to RabbitMQ at {rabbitmq_host}")
            return connection, channel
        except pika.exceptions.AMQPConnectionError as e:
            log_error(f"RabbitMQ connection failed : {e}")
            time.sleep(retry_delay)


# ================================================================
# CORE VIDEO PROCESSOR
# ================================================================

def process_video(camera_url, camera_id, camera_ip, objectlist,
                  user_id, credit_id, rabbitmq_host, queue_name,
                  frame_interval, retry_limit=50):
    """
    Video stream padhta hai aur frames RabbitMQ mein bhejta hai.

    KEY CHANGES vs old code:
    ─────────────────────────────────────────────────────────────
    1. is_file detect hota hai → FILE_FRAME_INTERVAL use hota hai
       (live ke liye LIVE_FRAME_INTERVAL / passed frame_interval)

    2. Uploaded file ke liye SceneChangeDetector active hota hai:
       - Scene change frame → interval ignore karke FORCE SEND
       - Ensures naye scene ka pehla frame kabhi skip nahi hoga

    3. Live stream ke liye scene change logic OFF hai —
       bandwidth waste na ho

    4. Baaki sab (EOF signal, retry, heartbeat) same hai
    ─────────────────────────────────────────────────────────────
    """

    # ── FILE ya LIVE decide karo ──────────────────────────────
    is_file = (
        isinstance(camera_url, str) and (
            camera_url.lower().endswith(('.mp4', '.avi', '.mkv', '.mov'))
            or os.path.isfile(camera_url)
        )
    )

    # File ke liye override karo → zyada frames = better detection
    effective_interval = FILE_FRAME_INTERVAL if is_file else frame_interval

    logging.info(
        f"[Framer] camera={camera_id} | "
        f"type={'FILE' if is_file else 'LIVE'} | "
        f"interval={effective_interval}"
    )

    # int convert try (webcam index ke liye)
    try:
        camera_url = int(camera_url)
    except Exception:
        pass

    # Scene change detector sirf file ke liye
    scene_detector = SceneChangeDetector() if is_file else None

    retry_count = 0

    while True:
        cap = cv2.VideoCapture(camera_url)

        if not cap.isOpened():
            log_error(f"Error: Could not open video stream from {camera_url}")
            if is_file:
                break
            retry_count += 1
            time.sleep(5)
            continue

        log_info(f"Processing video stream from {camera_id} | interval={effective_interval}")
        connection, channel = setup_rabbitmq_connection(queue_name, rabbitmq_host)

        frame_count     = 0
        last_frame_time = time.time()

        try:
            while cap.isOpened():
                ret, frame = cap.read()

                # ── EOF / stream error ────────────────────────
                if not ret:
                    if is_file:
                        log_info(f"EOF reached for file {camera_id}")
                        _send_eof(channel, queue_name,
                                  camera_id, camera_ip, objectlist,
                                  user_id, credit_id)
                        break

                    if time.time() - last_frame_time > 5:
                        log_error(
                            f"No frame for 5s from {camera_id}, restarting...")
                        break
                    continue

                last_frame_time = time.time()
                frame_count    += 1

                # ── Scene change check (FILE ONLY) ────────────
                # Naye scene ka pehla frame → interval ignore karke bhejo
                force_send = False
                if is_file and scene_detector is not None:
                    if scene_detector.is_scene_change(frame):
                        force_send = True
                        frame_count = 0   # interval counter reset
                        logging.info(
                            f"[Framer] Scene change detected at frame "
                            f"{frame_count} — force sending")

                # ── Normal interval check ─────────────────────
                if not force_send:
                    if frame_count % effective_interval != 0:
                        continue
                    frame_count = 0

                # ── Frame compress aur bhejo ──────────────────
                current_datetime = datetime.datetime.now().strftime(
                    '%Y-%m-%d %H:%M:%S')

                _, buffer = cv2.imencode(
                    '.jpg', frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), 70])

                frame_data = {
                    "camera_id":  camera_id,
                    "camera_ip":  camera_ip,
                    "object_list": objectlist,
                    "datetime":   current_datetime,
                    "frame":      buffer.tobytes(),
                    "user_id":    user_id,
                    "credit_id":  credit_id,
                }

                channel.basic_publish(
                    exchange="",
                    routing_key=queue_name,
                    body=pickle.dumps(frame_data),
                    properties=pika.BasicProperties(delivery_mode=2))

                logging.debug(
                    f"[Framer] Sent frame from camera {camera_id} "
                    f"({'scene-change' if force_send else 'interval'})")

        except Exception as e:
            log_exception(f"An error occurred in camera {camera_id}: {e}")

        finally:
            cap.release()
            try:
                connection.close()
            except Exception:
                pass
            log_info(
                f"Camera {camera_id}: Processing complete. "
                f"RabbitMQ connection closed.")

            if is_file:
                break

            retry_count += 1
            if retry_count >= retry_limit:
                log_error(
                    f"Failed after {retry_count} retries for {camera_id}.")
                break


def _send_eof(channel, queue_name, camera_id, camera_ip,
              objectlist, user_id, credit_id):
    """EOF marker bhejta hai — detector ko pata chale video khatam hua."""
    current_datetime = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    eof_data = {
        "camera_id":   camera_id,
        "camera_ip":   camera_ip,
        "object_list": objectlist,
        "datetime":    current_datetime,
        "frame":       None,
        "user_id":     user_id,
        "credit_id":   credit_id,
        "eof":         True,
    }
    channel.basic_publish(
        exchange="",
        routing_key=queue_name,
        body=pickle.dumps(eof_data),
        properties=pika.BasicProperties(delivery_mode=2))
    logging.info(f"[Framer] EOF sent for {camera_id}")


# ================================================================
# PROCESS MANAGEMENT
# ================================================================

def start_camera_process(camera_url, camera_id, camera_ip, objectlist,
                         user_id, credit_id, rabbitmq_host,
                         queue_name="all_frames_1",
                         frame_interval=LIVE_FRAME_INTERVAL):
    """
    Har camera ke liye alag process start karta hai.
    frame_interval sirf LIVE stream ke liye use hoga;
    file ke liye FILE_FRAME_INTERVAL override kar deta hai process_video.
    """
    process = Process(
        target=process_video,
        args=(camera_url, camera_id, camera_ip, objectlist,
              user_id, credit_id, rabbitmq_host, queue_name, frame_interval))
    process.start()

    camera_processes[camera_id] = process
    camera_urls[camera_id]      = camera_url
    user_ids[camera_id]         = user_id
    credit_ids[camera_id]       = credit_id
    camera_ips[camera_id]       = camera_ip
    object_lists[camera_id]     = objectlist
    camera_queues[camera_id]    = queue_name   # ← restart ke waqt sahi queue yaad rahe

    log_info(
        f"Started process for camera {camera_id} "
        f"(PID: {process.pid}) | frames queue: {queue_name}")
    return process


def stop_camera_process(camera_id):
    process = camera_processes.get(camera_id)
    if process and process.is_alive():
        log_info(f"Stopping process for camera {camera_id}")
        process.terminate()
        process.join()
        log_info(f"Camera {camera_id}: Process stopped.")
        del camera_processes[camera_id]
    else:
        log_error(f"No active process found for camera {camera_id}")


# ================================================================
# MONITOR THREAD
# ================================================================

def monitor_camera_processes(rabbitmq_host="rabbitmq"):
    while True:
        for camera_id, process in list(camera_processes.items()):

            # Status False → stop karo
            if not camera_status.get(camera_id, False):
                if process.is_alive():
                    log_info(
                        f"Stopping camera {camera_id} — status set to False.")
                    stop_camera_process(camera_id)
                continue

            # Process mar gaya aur status True → restart karo
            if not process.is_alive():
                log_info(
                    f"Process for camera {camera_id} stopped unexpectedly. "
                    f"Restarting...")

                if camera_id in camera_urls:
                    camera_url = camera_urls[camera_id]
                    is_file = (
                        isinstance(camera_url, str) and (
                            camera_url.lower().endswith(
                                ('.mp4', '.avi', '.mkv', '.mov'))
                            or os.path.isfile(camera_url)
                        )
                    )
                    if is_file:
                        log_info(
                            f"Camera {camera_id} is a local file. "
                            f"Will not restart.")
                        camera_status[camera_id] = False
                        continue

                    # Restart: camera_queues se sahi frames queue lo
                    frames_queue = camera_queues.get(camera_id, "all_frames_1")
                    start_camera_process(
                        camera_url, camera_id,
                        camera_ips[camera_id],
                        object_lists[camera_id],
                        user_ids.get(camera_id),
                        credit_ids.get(camera_id),
                        rabbitmq_host,
                        queue_name=frames_queue)
                else:
                    log_error(
                        f"No URL found for camera {camera_id}, "
                        f"unable to restart.")

        time.sleep(25)


# ================================================================
# QUEUE CONSUMER
# ================================================================

def fetch_camera_data_from_queue(queue_name, rabbitmq_host="localhost", frames_queue="all_frames_1"):
    """
    RabbitMQ se camera details padhta hai aur processes manage karta hai.
    queue_name   : camera_details_{group}  — is queue se camera config aata hai
    frames_queue : all_frames_{group}      — is queue mein frames publish honge
    """

    def callback(ch, method, properties, body):
        try:
            camera_data    = pickle.loads(body)
            camera_id      = camera_data.get("CameraId")
            camera_ip      = camera_data.get("CameraIp")
            running_status = str(camera_data.get("Running", "FALSE")).upper()
            objectlist     = camera_data.get("ObjectList")
            camera_url     = camera_data.get("CameraUrl")
            user_id        = camera_data.get("UserId", "")
            credit_id      = camera_data.get("CreditId", "")

            if running_status == "TRUE":
                camera_status[camera_id] = True

                process_alive = (
                    camera_id in camera_processes
                    and camera_processes[camera_id].is_alive()
                )

                if not process_alive:
                    # Fresh start — process not running yet
                    log_info(f"Starting camera process for {camera_id} | frames → {frames_queue}.")
                    start_camera_process(
                        camera_url, camera_id, camera_ip, objectlist,
                        user_id, credit_id, rabbitmq_host,
                        queue_name=frames_queue)   # ← frames_queue pass karo

                else:
                    # Process is already alive — check if objectlist changed
                    old_objectlist = object_lists.get(camera_id, "")
                    if old_objectlist != objectlist:
                        log_info(
                            f"[Framer] Analytics changed for camera {camera_id}: "
                            f"'{old_objectlist}' → '{objectlist}'. "
                            f"Restarting process with new objectlist."
                        )
                        # Stop the old process (uses the stored URL/IP)
                        stop_camera_process(camera_id)
                        # Start fresh with the updated objectlist (same frames_queue)
                        start_camera_process(
                            camera_url, camera_id, camera_ip, objectlist,
                            user_id, credit_id, rabbitmq_host,
                            queue_name=frames_queue)   # ← frames_queue pass karo
                    else:
                        log_info(
                            f"[Framer] Camera {camera_id} already running "
                            f"with same objectlist — no restart needed."
                        )

            else:
                camera_status[camera_id] = False
                if (camera_id in camera_processes
                        and camera_processes[camera_id].is_alive()):
                    log_info(f"Stopping camera process for {camera_id}.")
                    stop_camera_process(camera_id)

            ch.basic_ack(delivery_tag=method.delivery_tag)
            log_info(f"ACK sent for camera_id {camera_id}")

        except Exception as e:
            ch.basic_reject(delivery_tag=method.delivery_tag, requeue=False)
            log_exception(f"Failed to process message: {e}")

    while True:
        try:
            connection, channel = setup_rabbitmq_connection(
                queue_name, rabbitmq_host)
            channel.basic_qos(prefetch_count=5)
            channel.basic_consume(
                queue=queue_name,
                on_message_callback=callback,
                auto_ack=False)
            logging.info(
                f"[Framer] ✅ Waiting for camera data from {queue_name}...")
            channel.start_consuming()

        except pika.exceptions.AMQPConnectionError as e:
            logging.error(f"[Framer] RabbitMQ error: {e} — retrying in 10s")
            time.sleep(10)
        except Exception as e:
            logging.error(f"[Framer] Error: {e} — retrying in 10s")
            time.sleep(10)
        finally:
            try:
                connection.close()
            except Exception:
                pass


# ================================================================
# ENTRY
# ================================================================

if __name__ == "__main__":
    # FRAMER_GROUP env var se determine karo — docker-compose mein set karo
    group        = int(os.environ.get("FRAMER_GROUP", 1))
    input_queue  = f"camera_details_{group}"   # camera config yahan se aata hai (API publish karta hai)
    output_queue = f"all_frames_{group}"        # frames yahan publish honge (consumer yahan se padhega)

    logging.info(
        f"[Framer] Starting | group={group} | "
        f"input={input_queue} | output={output_queue}"
    )

    monitor_thread = threading.Thread(
        target=monitor_camera_processes, daemon=True)
    monitor_thread.start()

    fetch_camera_data_from_queue(
        queue_name   = input_queue,
        frames_queue = output_queue,
    )