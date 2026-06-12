FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend code
COPY backend/ .

# Copy legacy frontend files (the working SPA)
COPY backend/legacy-frontend/ ./legacy-frontend/

# Remove .bak files to keep image small
RUN rm -f legacy-frontend/*.bak

EXPOSE 8000

CMD gunicorn main:app -c gunicorn_conf.py
