import pika
import os
import pickle  # To deserialize and serialize frames
import time
import cv2
import requests
import logging
import datetime
import threading
import numpy as np
from dotenv import load_dotenv
load_dotenv()


save_frame = 'media'
os.makedirs(save_frame, exist_ok=True)


# BaseUrl = 'https://vmspyapi.ajeevi.in'


def send_log_to_rabbitmq(log_message):
    try:
        rabbitmq_host = os.environ.get("RABBITMQ_HOST", "localhost")
        connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host,heartbeat=600))
        channel = connection.channel()
        channel.queue_declare(queue='logs',durable=True)  # Declare the queue for logs
        # Serialize the log message as JSON and send it to RabbitMQ
        channel.basic_publish(
            exchange='',
            routing_key='logs',
            body=pickle.dumps(log_message)
        )
        connection.close()
    except Exception as e:
        print(f"Failed to send log to RabbitMQ: {e}")

# Wrapper functions for logging and sending logs to RabbitMQ
def log_info(message):
    logging.info(message)
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    message_data = {
        "log_level" : "INFO",
        "Event_Type":"Send Camera Details in Queue",
        "Message":message,
        "datetime" : current_time,

    }
    send_log_to_rabbitmq(message_data)

def log_error(message):
    logging.info(message)
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    message_data = {
        "log_level" : "ERROR",
        "Event_Type":"Send Camera Details in Queue",
        "Message":message,
        "datetime" : current_time,

    }
    send_log_to_rabbitmq(message_data)    

def log_exception(message):
    logging.error(message)
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    message_data = {
        "log_level" : "EXCEPTION",
        "Event_Type":"Send Camera Details in Queue",
        "Message":message,
        "datetime" : current_time,

    }
    send_log_to_rabbitmq(message_data)

# Global check_list and a timer dictionary
check_list = set()
clear_timer = {}

def clear_check_list_entry(object_count):
    time.sleep(300)  # Wait for 5 minutes
    check_list.discard(object_count)
    clear_timer.pop(object_count, None)


def push_detection_data_to_base_url(camera_ip, camera_id, object_count, object_detect, framePath, alert_type, user_id):
    # api_url = 'https://vmspyapi.ajeevi.in/api/CameraAlert/'
    #api_url_push = 'http://14.195.152.244:7006/api/CameraAlert/'
    # api_url_push = os.getenv("API_URL")
    # api_url_push = f"{api_url_push}/api/CameraAlert/"
    base_url = os.getenv("API_URL")
    if not base_url:
        raise Exception("❌ API_URL not set in .env")
    api_url_push = base_url.rstrip("/") + "/api/CameraAlert/"

    object_detect_str = " ".join(object_detect) if isinstance(object_detect, list) else str(object_detect)
    print("This is DB URL :", api_url_push)
    if object_count :
        # Add to check list
        #check_list.add(object_count)

        # Start timer to clear after 5 minutes if not already running
        # if object_count not in clear_timer:
        #     t = threading.Thread(target=clear_check_list_entry, args=(object_count,))
        #     t.daemon = True
        #     t.start()
        #     clear_timer[object_count] = t

        payload = {
            "cameraId": int(camera_id) if camera_id is not None else None,
            "framePath": framePath,
            "objectName": object_detect_str,
            "objectCount": object_count,
            "alertStatus": alert_type,
            "userid": user_id
        }

        headers = {"accept": "*/*", "Content-Type": "application/json"}
        print("Last data received:", payload)

        try:
            response = requests.post(api_url_push, json=payload, headers=headers)
            response.raise_for_status()
            print("Successfull send :", response.text)
        except requests.RequestException as e:
            print(f"Error pushing data to API: {e}")
            if e.response:
                print(f"Response Content: {e.response.text}")

def post_data(credit_id, camera_id, event_id=4):
    credit_base = os.getenv("CREDIT_URL")
    if not credit_base:
        print("⚠️ CREDIT_URL not set — skipping credit deduction")
        return None
    api_url_credit = credit_base.rstrip("/") + "/transaction_update"

    payload = {
        "event_credit_id": credit_id,
        "device_id":       camera_id,
        "event_type_id":   event_id
    }
    print(payload)
    try:
        response = requests.post(api_url_credit, json=payload)
        response.raise_for_status()
        print("Data posted successfully:", response.json())
        log_info("Data posted successfully")
        return response
    except requests.exceptions.RequestException as e:
        print("An error occurred:", e)
        log_error(f"An error occurred {e}")
        return None

def setup_rabbitmq_connection(queue_name, retry_delay=5):
    """
    Set up a RabbitMQ connection and declare the queue.
    """
    rabbitmq_host = os.environ.get("RABBITMQ_HOST", "localhost")
    while True:
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(
                host=rabbitmq_host, heartbeat=600, blocked_connection_timeout=300
            ))
            channel = connection.channel()
            channel.queue_declare(queue=queue_name, durable=True, arguments={"x-max-length": 150, "x-overflow": "drop-head"})
            logging.info(f"[Writer] ✅ Connected to RabbitMQ at {rabbitmq_host}")
            return connection, channel
        except Exception as e:
            logging.error(f"[Writer] RabbitMQ connection failed: {e} — retrying in {retry_delay}s")
            time.sleep(retry_delay)

predic = {}
last_object_detected = None
def write_analytics(ch, method, properties, body):

    global last_object_detected

    try:
        analytics_data = pickle.loads(body)

        camera_id = analytics_data["CameraId"]
        camera_ip = analytics_data["CameraIp"]
        datetime_str = analytics_data["Datetime"]

        # 🔥 Uploaded video fix: dynamic camera_id doesn't exist in Django DB,
        # so use a fixed placeholder ID (0) for uploaded video alerts
        if camera_ip == "uploaded_video":
            camera_id = None
            print(f"📹 Uploaded video detected — sending camera_id=null to Django API")
        frame_bytes = analytics_data["Image"]   # 🔥 bytes aa raha hai
        object_detected = analytics_data["Object"]
        user_id = analytics_data.get("UserId", "")
        credit_id = analytics_data.get("CreditId", "")
        detection_type = analytics_data.get("DetectionType", "unknown")

        print("Detected Object :", object_detected)

        # ── Check for EOF ─────────────────────────────────────────────────
        if object_detected and object_detected.get("eof") is True:
            print(f"✅ EOF received for camera {camera_id}. Video processing complete.")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        # 🔥 datetime fix
        datetime_str = datetime_str.replace(":", "_").replace(" ", "_")

        frame_dir = os.path.join(save_frame, str(camera_ip))
        os.makedirs(frame_dir, exist_ok=True)

        full_frame_path = os.path.join(os.getcwd(), frame_dir, f'{datetime_str}_{detection_type}.jpg')

        # =========================
        # 🔥 FIX: DECODE IMAGE
        # =========================
        frame = None
        if frame_bytes is not None:
            try:
                if isinstance(frame_bytes, np.ndarray):
                    frame = frame_bytes
                elif isinstance(frame_bytes, (bytes, bytearray)):
                    nparr = np.frombuffer(frame_bytes, np.uint8)
                    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                else:
                    print(f"Unknown frame type: {type(frame_bytes)}")
            except Exception as e:
                print("Decode error:", e)
        if frame is None:
            print("Frame decode failed")
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
            return

        # =========================
        # 🔥 SAVE IMAGE
        # =========================
        object_count = 0
        for v in object_detected.values():
            if isinstance(v, list):
                object_count += len(v)
            else:
                try:
                    object_count += int(v)
                except (ValueError, TypeError):
                    object_count += 1

        if object_detected:
            try:
                cv2.imwrite(full_frame_path, frame)

                print("📸 Saved:", full_frame_path)

                push_detection_data_to_base_url(
                    camera_ip,
                    camera_id,
                    object_count,
                    object_detected,
                    full_frame_path,
                    'B',
                    user_id
                )

                log_info("Image saved")

                # ✅ ACK
                ch.basic_ack(delivery_tag=method.delivery_tag)

            except Exception as e:
                print("❌ Save error:", e)
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

        else:
            # 🔥 no detection → ack kar do (waste nahi)
            ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        print("❌ Error processing:", e)
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

def main(queue_name="video_analytics"):
    while True:
        try:
            receiver_connection, receiver_channel = setup_rabbitmq_connection(queue_name)
            receiver_channel.basic_qos(prefetch_count=5)
            receiver_channel.basic_consume(
                queue=queue_name,
                on_message_callback=lambda ch, method, properties, body: write_analytics(
                    ch, method, properties, body
                ),
                auto_ack=False
            )
            logging.info("[Writer] ✅ Waiting for analytics messages...")
            receiver_channel.start_consuming()
        except pika.exceptions.AMQPConnectionError as e:
            logging.error(f"[Writer] RabbitMQ connection error: {e} — retrying in 10s")
            time.sleep(10)
        except Exception as e:
            logging.error(f"[Writer] Fatal error: {e} — retrying in 10s")
            time.sleep(10)
        finally:
            try:
                receiver_connection.close()
            except Exception:
                pass

if __name__ == "__main__":
    # WRITER_QUEUE env var se queue name set hota hai
    # Sab consumer groups ka detection output ek hi 'video_analytics' queue mein aata hai
    queue_name = os.environ.get("WRITER_QUEUE", "video_analytics")
    main(queue_name=queue_name)
