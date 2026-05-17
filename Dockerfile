FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend code
COPY backend/ .

# Copy React frontend build (already inside backend/static/ from COPY above)

EXPOSE 8000

# Railway sets PORT env var — use shell form to resolve it
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
