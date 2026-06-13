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


@router.get("/push/vapid-key")
def get_vapid_key():
    """Return the public VAPID key for the frontend."""
    return {"publicKey": VAPID_PUBLIC_KEY}


@router.post("/push/test")
def push_test(current_user=Depends(get_current_user)):
    """Send a test push notification to the current user."""
    send_push_to_user(
        current_user["id"],
        title="🔔 Test Notification",
        body=f"Push notifications are working! Hello {current_user['name']}.",
        tag="test"
    )
    return {"status": "sent"}


# ── Push Sending Utility ──

def send_push_to_user(user_id: int, title: str, body: str, tag: str = "", data: dict = None):
    """Send a push notification to all subscriptions of a user."""
    conn = get_conn()
    subs = conn.execute(
        "SELECT * FROM push_subscriptions WHERE user_id=?",
        (user_id,)
    ).fetchall()
    conn.close()

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


def send_push_to_roles(roles: list, title: str, body: str, tag: str = "", data: dict = None):
    """Send push notification to all users with given roles."""
    conn = get_conn()
    users = conn.execute(
        "SELECT id FROM users WHERE role IN ({}) AND status='Active'".format(
            ",".join(["?"] * len(roles))
        ),
        roles
    ).fetchall()
    conn.close()

    total = 0
    for user in users:
        total += send_push_to_user(user["id"], title, body, tag, data)
    return total


def _remove_subscription(sub_id: int):
    """Remove an expired push subscription."""
    conn = get_conn()
    conn.execute("DELETE FROM push_subscriptions WHERE id=?", (sub_id,))
    conn.commit()
    conn.close()


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
            FROM payments WHERE DATE(collected_at) = ?
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
                WHERE TO_CHAR(collected_at, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
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
    sent = send_push_to_roles(target_roles, title, body, tag="daily-summary")

    return {"sent": sent, "date": date_str, "collected": pay_total, "payments": pay_count}
