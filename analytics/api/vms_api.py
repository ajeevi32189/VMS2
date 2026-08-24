from flask import Flask, request, jsonify , send_from_directory
import os
import threading
from flask_cors import CORS
import pickle
import pika
import logging
import datetime
import time
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)

# ─────────────────────────────────────────────────────────────────────────────
#  SECURITY HEADERS
#  Har response ke saath automatically security headers add hote hain.
# ─────────────────────────────────────────────────────────────────────────────

@app.after_request
def add_security_headers(response):
    # Browser ko MIME sniffing karne se rokta hai
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # Clickjacking attacks se bachata hai
    response.headers['X-Frame-Options'] = 'DENY'
    # Reflected XSS attacks ke liye browser-level protection
    response.headers['X-XSS-Protection'] = '1; mode=block'
    # HTTPS enforce karta hai (1 saal ke liye)
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    # Sirf same origin se resources load hone deta hai (API ke liye safe)
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    # Referrer information limit karta hai
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    # Unnecessary browser features/APIs disable karta hai
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    return response

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
#  CAMERA GROUP ASSIGNMENT
#  Camera registration order ke basis pe group assign hota hai (camera_id se nahi).
#  Slot 0-9  → Group 1  → camera_details_1 / all_frames_1
#  Slot 10-19 → Group 2  → camera_details_2 / all_frames_2  ...and so on
# ─────────────────────────────────────────────────────────────────────────────

CAMERAS_PER_GROUP = int(os.environ.get("CAMERAS_PER_GROUP", 10))

_group_lock        = threading.Lock()   # thread-safe access
camera_group_map   = {}                 # {camera_id: group_num}  — persistent across requests
registered_cameras = []                 # registration order list


def get_or_assign_group(camera_id: str) -> int:
    """
    Camera ka group return karo.
    - Pehle se registered hai  → same group (idempotent)
    - Naya camera              → next slot → group = slot // CAMERAS_PER_GROUP + 1
    """
    with _group_lock:
        if camera_id in camera_group_map:
            return camera_group_map[camera_id]

        slot  = len(registered_cameras)          # 0-indexed position
        group = slot // CAMERAS_PER_GROUP + 1    # 1-indexed group number

        camera_group_map[camera_id]   = group
        registered_cameras.append(camera_id)

        logging.info(
            f"[API] New camera '{camera_id}' -> slot={slot} -> group={group} "
            f"(queue: camera_details_{group})"
        )
        return group

def setup_rabbitmq_connection(queue_name, retry_delay=5):
    """
    Set up a RabbitMQ connection and declare the queue.
    """
    rabbitmq_host = os.environ.get("RABBITMQ_HOST", "localhost")  # Use env var or default to localhost
    while True:
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(
                host=rabbitmq_host,
                socket_timeout=5,          # 5 second timeout — no infinite hang
                connection_attempts=2,     # 2 attempts max before exception
                retry_delay=2,
            ))
            channel = connection.channel()
            channel.queue_declare(queue=queue_name, durable=True, arguments={"x-max-length": 150,"x-overflow": "drop-head"})
            print(f"Connected to RabbitMQ at {rabbitmq_host}")
            return connection, channel
        except pika.exceptions.AMQPConnectionError as e:
            print(f"RabbitMQ connection failed : {e}")
            time.sleep(retry_delay)


def send_log_to_rabbitmq(log_message):
    try:
        rabbitmq_host = os.environ.get("RABBITMQ_HOST", "localhost")
        connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host,heartbeat=600))
        channel = connection.channel()
        channel.queue_declare(queue='logs',durable= True)  # Declare the queue for logs
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



@app.route('/CameraDetails', methods=['POST'], strict_slashes=False)
def update_camera_details():
    try:
        data = request.get_json()

        cameras = data.get("cameras", [])
        if not cameras:
            log_info(f"No cameras provided!")
            return jsonify({"error": "No cameras provided!"}), 400

        for camera in cameras:
            required_fields = ["camera_id", "url", "camera_ip", ]

        if not all(field in camera for field in required_fields):
            log_error(f"Missing required fields in camera details for camera {camera.get('camera_id')}")
            return jsonify({"error": f"Missing required fields in camera details for camera {camera.get('camera_id')}!"}), 400
        camera_id = camera["camera_id"]
        camera_url = camera["url"]
        camera_ip = camera["camera_ip"]
        # objectlist = camera.get("objectlist", "[]").lower()
        objectlist_raw = camera.get("objectlist", [])
        if isinstance(objectlist_raw, list):
            objectlist = " ".join(objectlist_raw).lower()
        else:
            objectlist = str(objectlist_raw).lower()
        running = str(camera.get("running", "FALSE")).upper()
        user_id = camera.get("user_id", "")
        credit_id = camera["credit_id"]
        # ── Assign camera to a group (registration-order based) ──────────
        group      = get_or_assign_group(str(camera_id))
        queue_name = f'camera_details_{group}'
        print(f"[API] Camera {camera_id} -> group {group} -> queue: {queue_name}")
        print("This is camera data :", camera)

        connection, channel = setup_rabbitmq_connection(queue_name)
        if not channel.is_open:
            log_error("Receiver channel is closed. Attempting to reconnect.")
            connection, channel = setup_rabbitmq_connection(queue_name)

        frame_data = {
                "CameraId":camera_id,
                "CameraIp": camera_ip,
                "CameraUrl":camera_url,
                "ObjectList": objectlist,
                "Running":running,
                "UserId":user_id,
                "CreditId":credit_id 
            }
        serialized_frame = pickle.dumps(frame_data)
        #print("frame_data :", frame_data)

        # Send the frame to the queue
        # if running:
        try:
            channel.basic_publish(
                exchange="",
                routing_key=queue_name,
                body=serialized_frame,
                properties=pika.BasicProperties(delivery_mode=2))
            #print(f"Sent camera info{camera_id}")
            log_info(f"Sent camera info camera_id :{camera_id} and camera_ip :{camera_ip}")
        except Exception as e:
            print(f"Failed to publish message: {e}")
            log_exception(f"Failed to publish message: {e} and camera_ip :{camera_ip}")
        log_info("Cameras added/updated successfully!")
        return jsonify({"message": "Cameras added/updated successfully!"}), 201
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route('/UploadVideo', methods=['POST', 'OPTIONS'])
def upload_video():
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        return response, 200

    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    if file:
        filename = secure_filename(file.filename)
        camera_id = str(int(time.time() * 1000))
        unique_filename = f"{camera_id}_{filename}"
        filepath = os.path.join(UPLOAD_FOLDER, unique_filename)
        file.save(filepath)
        
        objectlist = request.form.get("objectlist", "[]").lower()
        user_id = request.form.get("user_id", "")
        credit_id = request.form.get("credit_id", "")
        
        queue_name = 'camera_details_1'
        connection, channel = setup_rabbitmq_connection(queue_name)
        if not channel.is_open:
            connection, channel = setup_rabbitmq_connection(queue_name)
            
        frame_data = {
            "CameraId": camera_id,
            "CameraIp": "uploaded_video",
            "CameraUrl": filepath,
            "ObjectList": objectlist,
            "Running": "TRUE",
            "UserId": user_id,
            "CreditId": credit_id
        }
        
        try:
            channel.basic_publish(
                exchange="",
                routing_key=queue_name,
                body=pickle.dumps(frame_data),
                properties=pika.BasicProperties(delivery_mode=2))
            log_info(f"Sent uploaded video info camera_id :{camera_id}")
            return jsonify({"message": "Video uploaded successfully!", "camera_id": camera_id}), 201
        except Exception as e:
            log_exception(f"Failed to publish message: {e}")
            return jsonify({"error": f"Failed to publish message: {e}"}), 500

# Use in image file save in Docker -------------------------------------------------------------------------------

@app.route('/app/<folder>/<camera_id>/<filename>')
def get_image(folder, camera_id, filename):
    camera_folder = os.path.join(os.getcwd(), folder, camera_id)
    print("Serving file from:", camera_folder)
    return send_from_directory(camera_folder, filename)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=7001)

