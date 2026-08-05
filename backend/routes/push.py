"""Web Push Notification endpoints and utilities."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import json

from deps import get_current_user, require_role
from conn import get_conn
from config import VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY_PATH, VAPID_CLAIMS

router = APIRouter(prefix="/api", tags=["Push Notifications"])


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict  # {"p256dh": "...", "auth": "..."}


# ── Subscribe / Unsubscribe ──

@router.post("/push/subscribe")
def push_subscribe(sub: PushSubscription, current_user=Depends(get_current_user)):
    """Save a push subscription for the logged-in user."""
    with get_conn() as conn:
        # Upsert — one subscription per user+endpoint
        existing = conn.execute(
            "SELECT id FROM push_subscriptions WHERE user_id=? AND endpoint=?",
            (current_user["id"], sub.endpoint)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE push_subscriptions SET p256dh=?, auth=? WHERE id=?",
                (sub.keys.get("p256dh", ""), sub.keys.get("auth", ""), existing["id"])
            )
        else:
            conn.execute(
                "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)",
                (current_user["id"], sub.endpoint, sub.keys.get("p256dh", ""), sub.keys.get("auth", ""))
            )
        conn.commit()
    return {"status": "subscribed"}


@router.post("/push/unsubscribe")
def push_unsubscribe(sub: PushSubscription, current_user=Depends(get_current_user)):
    """Remove a push subscription."""
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?",
            (current_user["id"], sub.endpoint)
        )
        conn.commit()
    return {"status": "unsubscribed"}


# ── FCM (native app) device tokens ─────────────────────────────────

class FcmRegisterBody(BaseModel):
    token: str
    platform: str = "android"


@router.post("/push/fcm-register")
def fcm_register(body: FcmRegisterBody, current_user=Depends(get_current_user)):
    """Register the native app's FCM device token for this user."""
    token = (body.token or "").strip()
    if len(token) < 50:  # FCM tokens are long
        raise HTTPException(status_code=400, detail="Invalid FCM token")
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM fcm_tokens WHERE token=?", (token,)
        ).fetchone()
        if existing:
            # Re-point to this user (token may have moved devices)
            conn.execute(
                "UPDATE fcm_tokens SET user_id=?, platform=? WHERE id=?",
                (current_user["id"], body.platform, existing["id"])
            )
        else:
            conn.execute(
                "INSERT INTO fcm_tokens (user_id, operator_id, token, platform) VALUES (?,?,?,?)",
                (current_user["id"], current_user.get("operator_id", 1), token, body.platform)
            )
        conn.commit()
    return {"status": "registered"}


@router.post("/push/fcm-unregister")
def fcm_unregister(body: FcmRegisterBody, current_user=Depends(get_current_user)):
    """Remove a device token (e.g. on logout)."""
    token = (body.token or "").strip()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM fcm_tokens WHERE token=? AND user_id=?",
            (token, current_user["id"])
        )
        conn.commit()
    return {"status": "unregistered"}


@router.get("/push/vapid-key")
def get_vapid_key():
    """Return the public VAPID key for the frontend."""
    return {"publicKey": VAPID_PUBLIC_KEY}


from routes.fcm import send_fcm_to_user

@router.post("/push/test")
def push_test(current_user=Depends(get_current_user)):
    """Send a test push notification to the current user (web push + FCM native)."""
    sent_fcm = 0
    try:
        import asyncio
        from routes.fcm import send_fcm_to_user
        sent_fcm = asyncio.run(send_fcm_to_user(
            current_user["id"], "🔔 Test Notification",
            f"FCM push working! Hello {current_user['name']}.",
            {"_force": True}, "test", "default"))
    except Exception as e:
        print(f"[push] fcm test error: {e}")
    sent_web = send_push_to_user(
        current_user["id"],
        title="🔔 Test Notification",
        body=f"Push notifications are working! Hello {current_user['name']}.",
        tag="test",
        data={"_force": True},
        notif_type="test",
    )
    return {"status": "sent", "web": sent_web, "fcm": sent_fcm}


@router.get("/push/fcm-status")
def fcm_status(current_user=Depends(get_current_user)):
    """Report whether FCM is configured on this deployment (with detail)."""
    import os
    from routes.fcm import fcm_enabled
    sa_inline = os.getenv("FCM_SERVICE_ACCOUNT", "")
    sa_path = os.getenv("FCM_SERVICE_ACCOUNT_JSON", "")
    detail = "missing"
    if sa_inline:
        detail = "FCM_SERVICE_ACCOUNT set"
        try:
            json.loads(sa_inline)
            detail += " (valid JSON)"
        except Exception:
            detail += " (INVALID JSON — check value)"
    elif sa_path:
        detail = f"FCM_SERVICE_ACCOUNT_JSON set (path: {sa_path})"
        if os.path.exists(sa_path):
            detail += " (file exists)"
        else:
            detail += " (FILE NOT FOUND on container)"
    return {"fcm_enabled": fcm_enabled(), "detail": detail}


# ── Push Sending Utility ──

# Notification types (push + sound aware). Each maps to a per-user pref key
# (user.notif_prefs). Missing key = enabled.
NOTIF_TYPES = {
    "payment": "Payment Received",
    "reconnection": "Reconnection Payment",
    "daily_summary": "Daily Summary",
    "wallet_alert": "GTPL Wallet Low",
    "swap": "STB Swap",
    "test": "Test Notification",
}


def get_user_notif_prefs(user_id: int) -> dict:
    """Return a user's notification prefs dict (missing key = enabled)."""
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT notif_prefs FROM users WHERE id=?", (user_id,)
            ).fetchone()
        raw = (row[0] if row else None) or "{}"
        prefs = json.loads(raw) if isinstance(raw, str) else {}
        if not isinstance(prefs, dict):
            prefs = {}
    except Exception:
        prefs = {}
    return prefs


def notif_enabled(user_id: int, notif_type: str) -> bool:
    """Whether a user has this notification type enabled (default True)."""
    # Only gate on known types; unknown/empty → always deliver
    if notif_type not in NOTIF_TYPES:
        return True
    prefs = get_user_notif_prefs(user_id)
    return prefs.get(notif_type, True)


def notify_fcm(user_id: int, title: str, body: str, data: dict = None, notif_type: str = ""):
    """Fire-and-forget FCM native push for a user (respects their prefs)."""
    try:
        from routes.fcm import send_fcm_to_user
        import asyncio
        # system-tray sound: bundled res/raw resource per type (APK side).
        sound = "default"
        if notif_type == "payment":
            sound = "payment"
        elif notif_type == "reconnection":
            sound = "reconnection"
        asyncio.create_task(
            send_fcm_to_user(user_id, title, body, data or {}, notif_type, sound)
        )
    except Exception:
        pass


def send_push_to_user(user_id: int, title: str, body: str, tag: str = "", data: dict = None, notif_type: str = ""):
    """Send a push notification to all subscriptions of a user (web push + FCM native).

    Respects the user's notification prefs for `notif_type`. Pass `_force=True`
    in data to bypass prefs (used by the manual test endpoint).
    """
    # Respect per-user notification prefs (unless forced by test endpoint)
    if not (data or {}).get("_force") and not notif_enabled(user_id, notif_type):
        return 0

    with get_conn() as conn:
        subs = conn.execute(
            "SELECT * FROM push_subscriptions WHERE user_id=?",
            (user_id,)
        ).fetchall()

    # FCM native devices (fire-and-forget; fcm.py no-ops if not configured)
    notify_fcm(user_id, title, body, data, notif_type)

    if not subs:
        return 0

    from pywebpush import webpush, WebPushException
    payload = json.dumps({
        "title": title,
        "body": body,
        "tag": tag,
        "data": data or {}
    })

    sent = 0
    for sub in subs:
        try:
            webpush(
                subscription={
                    "endpoint": sub["endpoint"],
                    "keys": {
                        "p256dh": sub["p256dh"],
                        "auth": sub["auth"]
                    }
                },
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY_PATH,
                vapid_claims=VAPID_CLAIMS
            )
            sent += 1
        except WebPushException as e:
            # If subscription is expired/invalid, remove it
            if e.response and e.response.status_code in (404, 410):
                _remove_subscription(sub["id"])
            print(f"Push error for user {user_id}: {e}")
        except Exception as e:
            print(f"Push error for user {user_id}: {e}")

    return sent


def send_push_to_roles(roles: list, title: str, body: str, tag: str = "", data: dict = None, notif_type: str = ""):
    """Send push notification to all users with given roles (per-user prefs respected)."""
    with get_conn() as conn:
        users = conn.execute(
            "SELECT id FROM users WHERE role IN ({}) AND status=?".format(
                ",".join(["?"] * len(roles))
            ),
            roles + ["Active"]
        ).fetchall()

    total = 0
    for user in users:
        total += send_push_to_user(user["id"], title, body, tag, data, notif_type)
    return total


def _remove_subscription(sub_id: int):
    """Remove an expired push subscription."""
    with get_conn() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE id=?", (sub_id,))
        conn.commit()


# ── Notification Preferences (admin-managed per-user settings) ──

class NotifPrefsUpdate(BaseModel):
    prefs: dict  # {"payment": true, "reconnection": false, ...}


@router.get("/push/notif-types")
def get_notif_types(current_user=Depends(get_current_user)):
    """List available notification types + their labels (for the admin UI)."""
    return {"types": NOTIF_TYPES}


@router.get("/push/prefs")
def list_notif_prefs(current_user=Depends(get_current_user)):
    """List all staff users + their notification prefs. Admin only."""
    if current_user["role"] not in ("admin", "master"):
        raise HTTPException(status_code=403, detail="Only Admin can manage notification settings")
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, name, role, notif_prefs FROM users ORDER BY role, name"
        ).fetchall()
    users = []
    for r in rows:
        raw = r["notif_prefs"] or "{}"
        try:
            prefs = json.loads(raw) if isinstance(raw, str) else {}
        except Exception:
            prefs = {}
        if not isinstance(prefs, dict):
            prefs = {}
        users.append({
            "id": r["id"],
            "username": r["username"],
            "name": r["name"],
            "role": r["role"],
            "prefs": prefs,
        })
    return {"users": users, "types": NOTIF_TYPES}


@router.put("/push/prefs/{user_id}")
def update_notif_prefs(
    user_id: int,
    body: NotifPrefsUpdate,
    current_user=Depends(get_current_user),
):
    """Set a user's notification prefs. Admin only."""
    if current_user["role"] not in ("admin", "master"):
        raise HTTPException(status_code=403, detail="Only Admin can manage notification settings")
    # Validate: only known types, bool values
    clean = {}
    for k, v in (body.prefs or {}).items():
        if k in NOTIF_TYPES:
            clean[k] = bool(v)
    with get_conn() as conn:
        exists = conn.execute(
            "SELECT id FROM users WHERE id=?", (user_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute(
            "UPDATE users SET notif_prefs=? WHERE id=?",
            (json.dumps(clean), user_id),
        )
        conn.commit()
    return {"status": "updated", "user_id": user_id, "prefs": clean}


# ── Daily Summary Endpoint (called by cron) ──

@router.get("/push/daily-summary")
def send_daily_summary(
    secret: str = Query(..., description="Secret key to authorize cron call"),
    role: str = Query("admin,support", description="Comma-separated roles")
):
    """Send daily collection summary to specified roles. Called by cron/scheduler."""
    from config import SECRET_KEY
    if secret != SECRET_KEY:
        raise HTTPException(status_code=403, detail="Invalid secret")

    from datetime import datetime, timedelta
    import calendar

    yesterday = datetime.now() - timedelta(days=1)
    date_str = yesterday.strftime("%Y-%m-%d")

    with get_conn() as conn:
        # Get yesterday's local payments
        row = conn.execute("""
            SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total
            FROM payments WHERE DATE(collected_at::timestamp) = ?
        """, (date_str,)).fetchone()

        # Get active customers count
        active = conn.execute("""
            SELECT COUNT(DISTINCT c.customer_id) as cnt
            FROM customers c
            JOIN connections con ON con.customer_id = c.customer_id
            WHERE con.status = 'Active'
        """).fetchone()

        # Get unpaid count (this month)
        unpaid = conn.execute("""
            SELECT COUNT(DISTINCT c.customer_id) as cnt
            FROM customers c
            JOIN connections con ON con.customer_id = c.customer_id AND con.status = 'Active'
            WHERE c.customer_id NOT IN (
                SELECT DISTINCT customer_id FROM payments
                WHERE SUBSTRING(collected_at, 1, 7) = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
            )
        """).fetchone()

    pay_count = row["cnt"] if row else 0
    pay_total = row["total"] if row else 0
    active_cnt = active["cnt"] if active else 0
    unpaid_cnt = unpaid["cnt"] if unpaid else 0

    title = "📊 Daily Summary"
    body = (
        f"📅 {yesterday.strftime('%d %b %Y')}\n"
        f"💰 Collected: ₹{pay_total:,.0f} ({pay_count} payments)\n"
        f"👥 Active: {active_cnt} | Unpaid: {unpaid_cnt}"
    )

    target_roles = [r.strip() for r in role.split(",")]
    sent = send_push_to_roles(target_roles, title, body, tag="daily-summary", notif_type="daily_summary")

    return {"sent": sent, "date": date_str, "collected": pay_total, "payments": pay_count}
