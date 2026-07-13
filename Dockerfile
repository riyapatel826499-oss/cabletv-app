# ── Stage 1: build the React (Vite) frontend ──────────────────────────────
# Changed FROM to force Railway to re-read this Dockerfile
FROM node:22-slim AS frontend-build
WORKDIR /build/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build

# ── Stage 2: Python backend ───────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

COPY backend/legacy-frontend/ ./legacy-frontend/
RUN rm -f legacy-frontend/*.bak

COPY --from=frontend-build /build/backend/static ./static

EXPOSE 8000

CMD ["gunicorn", "main:app", "-c", "gunicorn_conf.py"]
