FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY main.py .

# Env variables (optional default, override from compose)
ENV GO2RTC_URL=http://go2rtc:1984
ENV GO2RTC_PUBLIC_URL=http://14.195.152.244:1984
ENV DJANGO_API_URL=http://14.195.152.244:8006/api/camera_status/

# Run FastAPI
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
