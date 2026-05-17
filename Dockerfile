FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend code
COPY backend/ .

# Remove placeholder static dir, copy legacy frontend as static
RUN rm -rf static
COPY frontend/ ./static/

# Also remove .bak files to keep image small
RUN rm -f static/*.bak

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
