"""Structured JSON logging with request-ID correlation.

configure_logging() routes the root logger to stdout as JSON. The current
request id (set by the request-id middleware in main.py) is attached to every
log line so logs can be traced per request. Never log secrets here.
"""
import os
import sys
import json
import logging
import contextvars

# Holds the current request id; defaults to "-" outside a request context.
request_id_var: "contextvars.ContextVar[str]" = contextvars.ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    """Install the JSON formatter on the root logger (idempotent)."""
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Keep uvicorn/gunicorn access noise at a sane level.
    logging.getLogger("uvicorn.access").setLevel(os.getenv("ACCESS_LOG_LEVEL", "WARNING").upper())
