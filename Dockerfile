FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend-react/package.json frontend-react/package-lock.json* ./
RUN npm install
COPY frontend-react/ .

# vite.config.ts outputs to ../backend/static which is /app/backend/static
RUN mkdir -p /app/backend/static
RUN npm run build

# ---- Runtime image ----
FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend code
COPY backend/ .

# Remove placeholder static dir if exists, copy React build output
RUN rm -rf static
COPY --from=frontend-build /app/backend/static ./static

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
