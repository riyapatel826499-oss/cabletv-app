# Wasool production image — monorepo root context required
# Cache bust: 2026-07-13-v3 (do not remove)
FROM node:22-slim AS frontend-build
WORKDIR /build/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build

FROM python:3.11-slim
LABEL force.rebuild="2026-07-13-v3"
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY backend/legacy-frontend/ ./legacy-frontend/
RUN rm -f legacy-frontend/*.bak
COPY --from=frontend-build /build/backend/static ./static
ENV FORCE_REBUILD=2026-07-13-v3
EXPOSE 8000
CMD ["gunicorn", "main:app", "-c", "gunicorn_conf.py"]
