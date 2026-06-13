"""Notification settings — per-user Telegram bot configuration."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx
import logging
import threading

from models.base import get_db
from deps_orm import get_current_user, apply_op_filter, op_id
from conn import get_conn
from config import DB_ENGINE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULTS = {
    "notify_payment_scope": "disconnected",  # "all" or "disconnected"
    "notify_service_scope": "all",
    "notify_enabled": "true",
    "cutoff_date": "12",  # Day of month after which unpaid connections are disconnected
}


# Track open context managers externally, keyed by id(conn). A raw
# sqlite3.Connection rejects arbitrary attributes (can't do conn._ctx = ...),
# so we can't stash the context manager on the connection. The conn stays
# referenced by the ctx held here, so its id() won't be reused while open.
_open_ctxs = {}
_open_ctxs_lock = threading.Lock()


def _get_conn():
    """Get a raw DB connection (release it with _close_conn(conn)).

    Works for both SQLite (raw sqlite3.Connection) and PostgreSQL (the conn.py
    wrapper)."""
    ctx = get_conn()
    conn = ctx.__enter__()
    with _open_ctxs_lock:
        _open_ctxs[id(conn)] = ctx
    return conn


def _close_conn(conn):
    """Close a connection opened with _get_conn()."""
    with _open_ctxs_lock:
        ctx = _open_ctxs.pop(id(conn), None)
    if ctx is not None:
        ctx.__exit__(None, None, None)
    else:
        # Fallback: close directly if we don't have the tracked context.
        try:
            conn.close()
        except Exception:
            pass


def get_settings(operator_id: int = None) -> dict:
    """Load all notification settings from DB for the given operator."""
    conn = _get_conn()
    try:
        if operator_id is not None:
            rows = conn.execute("SELECT key, value FROM notification_settings WHERE operator_id = ?", [operator_id]).fetchall()
        else:
            rows = conn.execute("SELECT key, value FROM notification_settings WHERE operator_id IS NULL").fetchall()
        settings = {r["key"]: r["value"] for r in rows}
        for k, v in DEFAULTS.items():
            if k not in settings:
                settings[k] = v
        return settings
    finally:
        _close_conn(conn)


def get_telegram_config(operator_id: int = None) -> dict:
    """Get stored Telegram bot token and chat IDs for the given operator."""
    conn = _get_conn()
    try:
        if operator_id is not None:
            rows = conn.execute(
                "SELECT key, value FROM notification_settings WHERE key IN ('telegram_bot_token','telegram_chat_ids') AND operator_id = ?",
                [operator_id]
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT key, value FROM notification_settings WHERE key IN ('telegram_bot_token','telegram_chat_ids') AND operator_id IS NULL"
            ).fetchall()
        settings = {r["key"]: r["value"] for r in rows}
        token = settings.get("telegram_bot_token", "")
        chat_ids = settings.get("telegram_chat_ids", "")
        return {
            "token": token,
            "chat_ids": [c.strip() for c in chat_ids.split(",") if c.strip()] if chat_ids else [],
            "has_token": bool(token),
            "has_chats": bool(chat_ids),
        }
    finally:
        _close_conn(conn)


def should_notify_payment(customer_status: str, operator_id: int = None) -> bool:
    """Check if we should send payment notification for this customer's status."""
    settings = get_settings(operator_id)
    if settings.get("notify_enabled") != "true":
        return False
    tg = get_telegram_config(operator_id)
    if not tg["has_token"] or not tg["has_chats"]:
        return False
    scope = settings.get("notify_payment_scope", "disconnected")
    if scope == "all":
        return True
    return customer_status.lower() in ("disconnected", "inactive", "surrendered")


def _resolve_oid(user, target_operator_id: int = None) -> int:
    """Resolve which operator_id to use. Master can target any operator; others use their own."""
    if user.get("role") == "master" and target_operator_id is not None:
        return target_operator_id
    return op_id(user)


def _require_admin(user):
    """Only admin/master may change notification/Telegram settings."""
    if user.get("role") not in ("admin", "master"):
        raise HTTPException(status_code=403, detail="Admin access required")


# ===== API ENDPOINTS =====

@router.get("/notifications")
def get_notification_settings(operator_id: int = None, user=Depends(get_current_user)):
    # Master can specify which operator to view
    _oid = _resolve_oid(user, operator_id)
    settings = get_settings(_oid)
    tg = get_telegram_config(_oid)
    return {
        "notify_payment_scope": settings.get("notify_payment_scope", "disconnected"),
        "notify_service_scope": settings.get("notify_service_scope", "all"),
        "notify_enabled": settings.get("notify_enabled", "true"),
        "cutoff_date": settings.get("cutoff_date", "12"),
        "telegram_linked": tg["has_token"],
        "telegram_bot_username": settings.get("telegram_bot_username", ""),
        "telegram_chat_count": len(tg["chat_ids"]),
    }


class NotifySettingUpdate(BaseModel):
    notify_payment_scope: Optional[str] = None
    notify_service_scope: Optional[str] = None
    notify_enabled: Optional[str] = None
    cutoff_date: Optional[str] = None
    operator_id: Optional[int] = None  # master only: target operator


@router.put("/notifications")
def update_notification_settings(data: NotifySettingUpdate, user=Depends(get_current_user)):
    _require_admin(user)
    _oid = _resolve_oid(user, data.operator_id)
    conn = _get_conn()
    try:
        updates = data.model_dump(exclude_none=True)
        updates.pop("operator_id", None)  # don't save as a setting
        for k, v in updates.items():
            conn.execute(
                "INSERT INTO notification_settings (key, value, operator_id) VALUES (?, ?, ?) "
                "ON CONFLICT(key, operator_id) DO UPDATE SET value = ?",
                (k, v, _oid, v),
            )
        conn.commit()
        return {"ok": True, "updated": list(updates.keys())}
    finally:
        _close_conn(conn)


class TelegramTokenInput(BaseModel):
    bot_token: str
    chat_ids: Optional[str] = None  # comma-separated, optional manual override
    operator_id: Optional[int] = None  # master only: target operator


@router.post("/telegram/verify")
def verify_telegram_token(data: TelegramTokenInput, user=Depends(get_current_user)):
    """Verify bot token, auto-detect chat IDs from pending messages."""
    _require_admin(user)
    _oid = _resolve_oid(user, data.operator_id)
    token = data.bot_token.strip()
    if not token:
        raise HTTPException(400, "Bot token is required")

    # 1. Verify token is valid
    try:
        r = httpx.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
        if r.status_code != 200 or not r.json().get("ok"):
            raise HTTPException(400, "Invalid bot token — check and try again")
        bot_info = r.json()["result"]
        bot_username = bot_info.get("username", "")
    except httpx.ConnectError:
        raise HTTPException(500, "Cannot reach Telegram — check internet")

    # 2. Try to get chat IDs from getUpdates
    chat_ids = []
    # Manual override takes priority
    if data.chat_ids:
        chat_ids = [c.strip() for c in data.chat_ids.split(",") if c.strip()]
    else:
        try:
            r = httpx.get(
                f"https://api.telegram.org/bot{token}/getUpdates?limit=20&allowed_updates=[\"message\"]",
                timeout=10,
            )
            if r.status_code == 200 and r.json().get("ok"):
                for update in r.json().get("result", []):
                    msg = update.get("message", {})
                    chat_id = str(msg.get("chat", {}).get("id", ""))
                    if chat_id and chat_id not in chat_ids:
                        chat_ids.append(chat_id)
        except Exception as e:
            logger.warning(f"getUpdates failed: {e}")

    # 3. Save to DB
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO notification_settings (key, value, operator_id) VALUES (?, ?, ?) "
            "ON CONFLICT(key, operator_id) DO UPDATE SET value = ?",
            ("telegram_bot_token", token, _oid, token),
        )
        conn.execute(
            "INSERT INTO notification_settings (key, value, operator_id) VALUES (?, ?, ?) "
            "ON CONFLICT(key, operator_id) DO UPDATE SET value = ?",
            ("telegram_chat_ids", ",".join(chat_ids), _oid, ",".join(chat_ids)),
        )
        conn.execute(
            "INSERT INTO notification_settings (key, value, operator_id) VALUES (?, ?, ?) "
            "ON CONFLICT(key, operator_id) DO UPDATE SET value = ?",
            ("telegram_bot_username", bot_username, _oid, bot_username),
        )
        conn.commit()
    finally:
        _close_conn(conn)

    return {
        "ok": True,
        "bot_username": bot_username,
        "chat_ids": chat_ids,
        "chat_count": len(chat_ids),
        "message": f"✅ Bot @{bot_username} linked! {len(chat_ids)} user(s) detected." if chat_ids
                   else f"✅ Bot @{bot_username} token saved. Ask users to send /start to the bot, then click 'Detect Users' again.",
    }


@router.post("/telegram/detect-chats")
def detect_telegram_chats(operator_id: int = None, user=Depends(get_current_user)):
    """Re-detect chat IDs from pending messages (after users send /start)."""
    _require_admin(user)
    _oid = _resolve_oid(user, operator_id)
    tg = get_telegram_config(_oid)
    if not tg["token"]:
        raise HTTPException(400, "No bot token configured yet")

    chat_ids = list(tg["chat_ids"])  # keep existing
    try:
        r = httpx.get(
            f"https://api.telegram.org/bot{tg['token']}/getUpdates?limit=50&allowed_updates=[\"message\"]",
            timeout=10,
        )
        if r.status_code == 200 and r.json().get("ok"):
            for update in r.json().get("result", []):
                msg = update.get("message", {})
                chat_id = str(msg.get("chat", {}).get("id", ""))
                if chat_id and chat_id not in chat_ids:
                    chat_ids.append(chat_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to detect: {e}")

    # Save updated chat IDs
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO notification_settings (key, value, operator_id) VALUES (?, ?, ?) "
            "ON CONFLICT(key, operator_id) DO UPDATE SET value = ?",
            ("telegram_chat_ids", ",".join(chat_ids), _oid, ",".join(chat_ids)),
        )
        conn.commit()
    finally:
        _close_conn(conn)

    return {
        "ok": True,
        "chat_ids": chat_ids,
        "chat_count": len(chat_ids),
        "message": f"✅ {len(chat_ids)} user(s) linked to bot.",
    }


@router.delete("/telegram")
def unlink_telegram(operator_id: int = None, user=Depends(get_current_user)):
    """Remove Telegram bot configuration."""
    _require_admin(user)
    _oid = _resolve_oid(user, operator_id)
    conn = _get_conn()
    try:
        for key in ("telegram_bot_token", "telegram_chat_ids", "telegram_bot_username"):
            conn.execute("DELETE FROM notification_settings WHERE key = ? AND operator_id = ?", (key, _oid))
        conn.commit()
        return {"ok": True, "message": "Telegram bot unlinked."}
    finally:
        _close_conn(conn)
