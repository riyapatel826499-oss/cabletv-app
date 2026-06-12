"""Gunicorn configuration for the Wasool backend.

Runs FastAPI under Uvicorn workers for real concurrency + process supervision.
Worker count is controlled by WEB_CONCURRENCY (default 2). NOTE: the in-memory
cache (cache.py) and slowapi rate-limiter are per-worker today; moving them to a
shared store (Redis) is a Phase B prerequisite before scaling workers high.
"""
import os

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
worker_class = "uvicorn.workers.UvicornWorker"
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))  # GTPL/paypakka calls can be slow
graceful_timeout = 30
keepalive = 5
# Recycle workers periodically to bound memory growth.
max_requests = 2000
max_requests_jitter = 200
accesslog = "-"
errorlog = "-"
