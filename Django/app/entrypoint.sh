#!/bin/sh

echo "Waiting for MySQL..."

# Wait until DB is ready
until nc -z $DB_HOST $DB_PORT; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database is up!"

echo "Creating database tables..."
python create_tables.py

echo "Starting server..."
exec python manage.py runserver 0.0.0.0:7006