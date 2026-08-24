import pika
import pickle
import time
import os

RABBITMQ_HOST = os.environ.get("RABBITMQ_HOST", "localhost")
QUEUE_NAME = "logs"
RETRY_DELAY = 5


def setup_rabbitmq_connection(queue_name, retry_delay: int = RETRY_DELAY):

    while True:
        try:
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(host=RABBITMQ_HOST, heartbeat=600)
            )
            channel = connection.channel()

            channel.queue_declare(queue=queue_name, durable=True)

            print(f"✅ Connected to RabbitMQ at {RABBITMQ_HOST}")
            return connection, channel

        except pika.exceptions.AMQPConnectionError as e:
            print(f"❌ RabbitMQ connection failed: {e}")
            print(f"🔁 Retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)


def callback(ch, method, properties, body):

    try:
        data = pickle.loads(body)

        # 🔥 Clean logging
        print("📥 LOG RECEIVED:")
        print(f"Level: {data.get('log_level')}")
        print(f"Event: {data.get('Event_Type')}")
        print(f"Message: {data.get('Message')}")
        print(f"Time: {data.get('datetime')}")
        print("-" * 50)

        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        print(f"⚠️ Error processing message: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def main():
    while True:
        try:
            connection, channel = setup_rabbitmq_connection(QUEUE_NAME)
            channel.basic_qos(prefetch_count=5)
            channel.basic_consume(
                queue=QUEUE_NAME,
                on_message_callback=callback,
                auto_ack=False
            )
            print("🚀 Log Consumer waiting for messages...")
            channel.start_consuming()
        except KeyboardInterrupt:
            print("\n🛑 Consumer stopped by user")
            break
        except pika.exceptions.AMQPConnectionError as e:
            print(f"❌ RabbitMQ error: {e} — retrying in 10s")
            time.sleep(10)
        except Exception as e:
            print(f"❌ Fatal error: {e} — retrying in 10s")
            time.sleep(10)
        finally:
            try:
                connection.close()
            except Exception:
                pass
    print("🔌 RabbitMQ connection closed")


if __name__ == "__main__":
    main()