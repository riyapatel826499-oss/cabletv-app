# ── Stage 1: build the React (Vite) frontend ──────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /build/frontend-react
# Install deps first (cached unless lockfile changes)
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
# vite outDir is '../backend/static' → emits to /build/backend/static
RUN npm run build

# ── Stage 2: Python backend ───────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend code
COPY backend/ .

# Copy legacy frontend files (the working vanilla-JS SPA, served at the root)
COPY backend/legacy-frontend/ ./legacy-frontend/
RUN rm -f legacy-frontend/*.bak

# React build output → /app/static (served under /app)
COPY --from=frontend /build/backend/static ./static

EXPOSE 8000

CMD gunicorn main:app -c gunicorn_conf.py
