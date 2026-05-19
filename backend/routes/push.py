     1|"""Web Push Notification endpoints and utilities."""
     2|from fastapi import APIRouter, Depends, HTTPException, Query
     3|from pydantic import BaseModel
     4|from typing import Optional, List
     5|import json
     6|
     7|from models.base import get_db
from conn import get_conn
     8|from deps_orm import get_current_user, require_role
     9|from config import VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY_PATH, VAPID_CLAIMS, DB_PATH
    10|
    11|router = APIRouter(prefix="/api", tags=["Push Notifications"])
    12|
    13|
    14|class PushSubscription(BaseModel):
    15|    endpoint: str
    16|    keys: dict  # {"p256dh": "...", "auth": "..."}
    17|
    18|
    19|# ── Subscribe / Unsubscribe ──
    20|
    21|@router.post("/push/subscribe")
    22|def push_subscribe(sub: PushSubscription, current_user=Depends(get_current_user)):
    23|    """Save a push subscription for the logged-in user."""
    24|    with get_conn() as conn:
    25|        # Upsert — one subscription per user+endpoint
    26|        existing = conn.execute(
    27|            "SELECT id FROM push_subscriptions WHERE user_id=? AND endpoint=?",
    28|            (current_user["id"], sub.endpoint)
    29|        ).fetchone()
    30|        if existing:
    31|            conn.execute(
    32|                "UPDATE push_subscriptions SET p256dh=?, auth=? WHERE id=?",
    33|                (sub.keys.get("p256dh", ""), sub.keys.get("auth", ""), existing["id"])
    34|            )
    35|        else:
    36|            conn.execute(
    37|                "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)",
    38|                (current_user["id"], sub.endpoint, sub.keys.get("p256dh", ""), sub.keys.get("auth", ""))
    39|            )
    40|        conn.commit()
    41|    return {"status": "subscribed"}
    42|
    43|
    44|@router.post("/push/unsubscribe")
    45|def push_unsubscribe(sub: PushSubscription, current_user=Depends(get_current_user)):
    46|    """Remove a push subscription."""
    47|    with get_conn() as conn:
    48|        conn.execute(
    49|            "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?",
    50|            (current_user["id"], sub.endpoint)
    51|        )
    52|        conn.commit()
    53|    return {"status": "unsubscribed"}
    54|
    55|
    56|@router.get("/push/vapid-key")
    57|def get_vapid_key():
    58|    """Return the public VAPID key for the frontend."""
    59|    return {"publicKey": VAPID_PUBLIC_KEY}
    60|
    61|
    62|@router.post("/push/test")
    63|def push_test(current_user=Depends(get_current_user)):
    64|    """Send a test push notification to the current user."""
    65|    send_push_to_user(
    66|        current_user["id"],
    67|        title="🔔 Test Notification",
    68|        body=f"Push notifications are working! Hello {current_user['name']}.",
    69|        tag="test"
    70|    )
    71|    return {"status": "sent"}
    72|
    73|
    74|# ── Push Sending Utility ──
    75|
    76|def send_push_to_user(user_id: int, title: str, body: str, tag: str = "", data: dict = None):
    77|    """Send a push notification to all subscriptions of a user."""
    78|        conn = sqlite3.connect(DB_PATH)
    79|    conn.row_factory = sqlite3.Row
    80|    subs = conn.execute(
    81|        "SELECT * FROM push_subscriptions WHERE user_id=?",
    82|        (user_id,)
    83|    ).fetchall()
    84|    conn.close()
    85|
    86|    if not subs:
    87|        return 0
    88|
    89|    from pywebpush import webpush, WebPushException
    90|    payload = json.dumps({
    91|        "title": title,
    92|        "body": body,
    93|        "tag": tag,
    94|        "data": data or {}
    95|    })
    96|
    97|    sent = 0
    98|    for sub in subs:
    99|        try:
   100|            webpush(
   101|                subscription={
   102|                    "endpoint": sub["endpoint"],
   103|                    "keys": {
   104|                        "p256dh": sub["p256dh"],
   105|                        "auth": sub["auth"]
   106|                    }
   107|                },
   108|                data=payload,
   109|                vapid_private_key=VAPID_PRIVATE_KEY_PATH,
   110|                vapid_claims=VAPID_CLAIMS
   111|            )
   112|            sent += 1
   113|        except WebPushException as e:
   114|            # If subscription is expired/invalid, remove it
   115|            if e.response and e.response.status_code in (404, 410):
   116|                _remove_subscription(sub["id"])
   117|            print(f"Push error for user {user_id}: {e}")
   118|        except Exception as e:
   119|            print(f"Push error for user {user_id}: {e}")
   120|
   121|    return sent
   122|
   123|
   124|def send_push_to_roles(roles: list, title: str, body: str, tag: str = "", data: dict = None):
   125|    """Send push notification to all users with given roles."""
   126|        conn = sqlite3.connect(DB_PATH)
   127|    conn.row_factory = sqlite3.Row
   128|    users = conn.execute(
   129|        "SELECT id FROM users WHERE role IN ({}) AND status='Active'".format(
   130|            ",".join(["?"] * len(roles))
   131|        ),
   132|        roles
   133|    ).fetchall()
   134|    conn.close()
   135|
   136|    total = 0
   137|    for user in users:
   138|        total += send_push_to_user(user["id"], title, body, tag, data)
   139|    return total
   140|
   141|
   142|def _remove_subscription(sub_id: int):
   143|    """Remove an expired push subscription."""
   144|        conn = sqlite3.connect(DB_PATH)
   145|    conn.execute("DELETE FROM push_subscriptions WHERE id=?", (sub_id,))
   146|    conn.commit()
   147|    conn.close()
   148|
   149|
   150|# ── Daily Summary Endpoint (called by cron) ──
   151|
   152|@router.get("/push/daily-summary")
   153|def send_daily_summary(
   154|    secret: str = Query(..., description="Secret key to authorize cron call"),
   155|    role: str = Query("admin,support", description="Comma-separated roles")
   156|):
   157|    """Send daily collection summary to specified roles. Called by cron/scheduler."""
   158|    from config import SECRET_KEY
   159|    if secret != SECRET_KEY:
   160|        raise HTTPException(status_code=403, detail="Invalid secret")
   161|
   162|    from datetime import datetime, timedelta
   163|    import calendar
   164|
   165|    yesterday = datetime.now() - timedelta(days=1)
   166|    date_str = yesterday.strftime("%Y-%m-%d")
   167|
   168|        conn = sqlite3.connect(DB_PATH)
   169|    conn.row_factory = sqlite3.Row
   170|
   171|    # Get yesterday's local payments
   172|    row = conn.execute("""
   173|        SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total
   174|        FROM payments WHERE DATE(collected_at) = ?
   175|    """, (date_str,)).fetchone()
   176|
   177|    # Get active customers count
   178|    active = conn.execute("""
   179|        SELECT COUNT(DISTINCT c.customer_id) as cnt
   180|        FROM customers c
   181|        JOIN connections con ON con.customer_id = c.customer_id
   182|        WHERE con.status = 'Active'
   183|    """).fetchone()
   184|
   185|    # Get unpaid count
   186|    unpaid = conn.execute("""
   187|        SELECT COUNT(DISTINCT c.customer_id) as cnt
   188|        FROM customers c
   189|        JOIN connections con ON con.customer_id = c.customer_id AND con.status = 'Active'
   190|        WHERE c.customer_id NOT IN (
   191|            SELECT DISTINCT customer_id FROM payments
   192|            WHERE strftime('%Y-%m', collected_at) = strftime('%Y-%m', 'now')
   193|        )
   194|    """).fetchone()
   195|
   196|    conn.close()
   197|
   198|    pay_count = row["cnt"] if row else 0
   199|    pay_total = row["total"] if row else 0
   200|    active_cnt = active["cnt"] if active else 0
   201|    unpaid_cnt = unpaid["cnt"] if unpaid else 0
   202|
   203|    title = "📊 Daily Summary"
   204|    body = (
   205|        f"📅 {yesterday.strftime('%d %b %Y')}\n"
   206|        f"💰 Collected: ₹{pay_total:,.0f} ({pay_count} payments)\n"
   207|        f"👥 Active: {active_cnt} | Unpaid: {unpaid_cnt}"
   208|    )
   209|
   210|    target_roles = [r.strip() for r in role.split(",")]
   211|    sent = send_push_to_roles(target_roles, title, body, tag="daily-summary")
   212|
   213|    return {"sent": sent, "date": date_str, "collected": pay_total, "payments": pay_count}
   214|