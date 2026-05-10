"""Telegram Service Bot — raw HTTP via requests. No extra deps."""
import requests
import logging
from datetime import datetime
from typing import Optional

from config import SR_BOT_TOKEN, SR_GROUP_ID, SR_ADMIN_IDS

log = logging.getLogger(__name__)
BASE = f"https://api.telegram.org/bot{SR_BOT_TOKEN}"

SLA_HOURS = {"urgent": 4, "high": 8, "medium": 24, "low": 48}
PRIORITY_EMOJI = {"urgent": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}

STATUS_EMOJI = {
    "open": "🆕", "acknowledged": "👀", "on_the_way": "🚀",
    "settled": "✅", "closed": "🔒", "cancelled": "❌",
}

STATUS_LABEL = {
    "open": "Open", "acknowledged": "Acknowledged",
    "on_the_way": "On the way", "settled": "Settled",
    "closed": "Closed", "cancelled": "Cancelled",
}

TYPE_LABEL = {
    "complaint": "📢 Complaint", "new_connection": "🔌 New Connection",
    "reconnection": "🔄 Reconnection", "plan_change": "📦 Plan Change",
    "stb_swap": "📺 STB Swap", "address_shift": "🏠 Address Shift",
    "disconnect": "✂️ Disconnect",
}


def _api(method: str, payload: dict) -> Optional[dict]:
    """Send a request to Telegram Bot API."""
    try:
        r = requests.post(f"{BASE}/{method}", json=payload, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.error(f"TG API error ({method}): {e}")
        return None


def _fmt_ist(ts: str) -> str:
    """Convert UTC timestamp to IST display string (HH:MM AM/PM, DD-Mon)."""
    if not ts:
        return ""
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        # Add 5h30m for IST
        from datetime import timedelta
        ist = dt + timedelta(hours=5, minutes=30)
        return ist.strftime("%I:%M %p")  # e.g. "02:30 PM"
    except Exception:
        return ""


def format_ticket_card(t: dict) -> str:
    """Format a service request into a Telegram HTML message."""
    pri = PRIORITY_EMOJI.get(t.get("priority", "medium"), "⚪")
    stat = STATUS_EMOJI.get(t.get("status", "open"), "❓")
    stat_label = STATUS_LABEL.get(t.get("status", "open"), t.get("status", "open"))
    ttype = TYPE_LABEL.get(t.get("type", "complaint"), t.get("type", ""))
    deadline = t.get("deadline", "")
    if deadline:
        try:
            dt = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            deadline = dt.strftime("%d-%b %I:%M %p")
        except Exception:
            pass

    name = t.get("customer_name", "N/A")
    cid = t.get("customer_id", "")
    phone = t.get("customer_phone", "")
    area = t.get("customer_area", "")
    desc = t.get("description", "")
    assigned = t.get("assigned_to_name", "")

    # Build timeline from timestamps
    timeline_lines = []
    created_ist = _fmt_ist(t.get("created_at"))
    if created_ist:
        timeline_lines.append(f"🆕 Created: {created_ist}")
    ack_ist = _fmt_ist(t.get("acknowledged_at"))
    if ack_ist:
        timeline_lines.append(f"👀 Ack: {ack_ist}")
    otw_ist = _fmt_ist(t.get("on_the_way_at"))
    if otw_ist:
        timeline_lines.append(f"🚀 OTW: {otw_ist}")
    settled_ist = _fmt_ist(t.get("resolved_at"))
    if settled_ist:
        timeline_lines.append(f"✅ Settled: {settled_ist}")

    S = "━━━━━━━━━━━━━━━━"
    lines = [
        f"<b>🎫 {t.get('ticket_no', '')}</b>  {pri} <b>{t.get('priority', 'medium').upper()}</b>",
        f"{ttype}",
        S,
        f"👤 <b>{name}</b>",
    ]
    if cid:
        lines.append(f"🆔 <code>{cid}</code>")
    if phone:
        lines.append(f"📱 <a href=\"tel:{phone}\">{phone}</a>")
    if area:
        lines.append(f"📍 {area}")
    lines.append(S)
    lines.append(f"📝 {desc}")
    lines.append(S)
    lines.append(f"{stat} <b>Status: {stat_label}</b>")
    # Show timeline if any stage beyond Created
    if timeline_lines:
        lines.append("─" * 16)
        for tl in timeline_lines:
            lines.append(tl)
    if assigned:
        lines.append(f"👷 {assigned}")
    if deadline and deadline != "N/A":
        lines.append(f"⏰ Deadline: {deadline}")

    return "\n".join(lines)


def _inline_buttons(ticket_no: str, status: str, is_admin: bool = False) -> dict:
    """Build inline keyboard — simple linear flow. Close restricted to admin."""
    buttons = []
    if status == "open":
        buttons.append([
            {"text": "👀 Acknowledge", "callback_data": f"ack:{ticket_no}"},
        ])
    elif status == "acknowledged":
        buttons.append([
            {"text": "🚀 On the way", "callback_data": f"onway:{ticket_no}"},
        ])
    elif status == "on_the_way":
        buttons.append([
            {"text": "✅ Settled", "callback_data": f"settled:{ticket_no}"},
        ])
    elif status == "settled":
        buttons.append([
            {"text": "🔒 Close", "callback_data": f"close:{ticket_no}"},
        ])
    # Always allow cancel for open statuses (admin only)
    if status in ("open", "acknowledged", "on_the_way") and is_admin:
        buttons.append([
            {"text": "❌ Cancel", "callback_data": f"cancel:{ticket_no}"},
        ])

    if buttons:
        return {"inline_keyboard": buttons}
    return {}


# Map callback action → new status
ACTION_STATUS = {
    "ack": "acknowledged",
    "onway": "on_the_way",
    "settled": "settled",
    "close": "closed",
    "cancel": "cancelled",
}

ACTION_ACK_MSG = {
    "ack": "👀 Acknowledged!",
    "onway": "🚀 On the way!",
    "settled": "✅ Settled!",
    "close": "🔒 Closed!",
    "cancel": "❌ Cancelled!",
}


def post_new_ticket(ticket_data: dict, is_admin: bool = False) -> Optional[int]:
    """Post a new ticket card to the TG group. Returns message_id."""
    if not SR_GROUP_ID:
        log.warning("SR_GROUP_ID not set, skipping TG post")
        return None

    text = format_ticket_card(ticket_data)
    keyboard = _inline_buttons(ticket_data["ticket_no"], ticket_data.get("status", "open"), is_admin=is_admin)
    payload = {
        "chat_id": SR_GROUP_ID,
        "text": text,
        "parse_mode": "HTML",
    }
    if keyboard.get("inline_keyboard"):
        payload["reply_markup"] = keyboard

    result = _api("sendMessage", payload)
    if result and result.get("ok"):
        return result["result"]["message_id"]
    return None


def update_ticket_message(ticket_no: str, ticket_data: dict, message_id: int = None, is_admin: bool = False) -> bool:
    """Edit the existing group message to show updated status."""
    if not SR_GROUP_ID:
        return False
    if not message_id:
        return False

    text = format_ticket_card(ticket_data)
    keyboard = _inline_buttons(ticket_no, ticket_data.get("status", "open"), is_admin=is_admin)
    payload = {
        "chat_id": SR_GROUP_ID,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML",
    }
    if keyboard.get("inline_keyboard"):
        payload["reply_markup"] = keyboard

    result = _api("editMessageText", payload)
    return result is not None and result.get("ok", False)


def answer_callback(callback_query_id: str, text: str = "") -> bool:
    """Acknowledge a callback query."""
    return _api("answerCallbackQuery", {
        "callback_query_id": callback_query_id,
        "text": text,
    }) is not None


def send_message(chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    """Send a plain message."""
    return _api("sendMessage", {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    }) is not None


# --- Location tracking ---
# In-memory tracker: {user_id: {"ticket_no": str, "stage": str, "prompt_msg_id": int}}
_pending_location: dict = {}


def request_agent_location(chat_id: str, ticket_no: str, stage: str, user_id: int) -> bool:
    """Send a one-tap location request prompt in the group. Auto-deleted after agent responds."""
    text = f"📍 Tap below to share your location for <b>{ticket_no}</b>"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "reply_markup": {
            "resize_keyboard": True,
            "one_time_keyboard": True,
            "keyboard": [[{"text": "📍 Share Location", "request_location": True}]],
        },
    }
    result = _api("sendMessage", payload)
    if result and result.get("ok"):
        msg_id = result["result"]["message_id"]
        _pending_location[user_id] = {
            "ticket_no": ticket_no,
            "stage": stage,
            "prompt_msg_id": msg_id,
            "chat_id": int(chat_id),
        }
        log.info(f"Location request sent for {ticket_no} stage={stage} user={user_id}")
        return True
    return False


def delete_message(chat_id, message_id: int) -> bool:
    """Delete a message from TG."""
    return _api("deleteMessage", {
        "chat_id": chat_id,
        "message_id": message_id,
    }) is not None


def set_webhook(webhook_url: str) -> bool:
    """Set the webhook URL for the bot."""
    result = _api("setWebhook", {"url": webhook_url})
    ok = result is not None and result.get("ok", False)
    if ok:
        log.info(f"Webhook set to {webhook_url}")
    else:
        log.error(f"Failed to set webhook: {result}")
    return ok


def process_webhook_update(update: dict) -> Optional[dict]:
    """Parse a TG webhook update. Returns parsed action or None."""
    if "callback_query" in update:
        cq = update["callback_query"]
        data = cq.get("data", "")
        msg = cq.get("message", {})
        parts = data.split(":")
        if len(parts) >= 2:
            action = parts[0]
            # noop is just a placeholder button, ignore
            if action == "noop":
                return None
            return {
                "type": "callback",
                "action": action,
                "ticket_no": parts[1],
                "from_user": cq.get("from", {}),
                "message_id": msg.get("message_id"),
                "chat_id": msg.get("chat", {}).get("id"),
                "callback_query_id": cq["id"],
            }

    if "message" in update:
        msg = update["message"]

        # Handle location sharing (from agent)
        if "location" in msg:
            return {
                "type": "location",
                "latitude": msg["location"]["latitude"],
                "longitude": msg["location"]["longitude"],
                "from_user": msg.get("from", {}),
                "chat_id": msg.get("chat", {}).get("id"),
                "message_id": msg.get("message_id"),
            }

        text = msg.get("text", "").strip()
        if not text.startswith("/"):
            return None
        parts = text.split()
        cmd = parts[0].lower().split("@")[0]  # Remove @botname
        args = parts[1:] if len(parts) > 1 else []
        return {
            "type": "command",
            "command": cmd,
            "args": args,
            "from_user": msg.get("from", {}),
            "chat_id": msg.get("chat", {}).get("id"),
            "message_id": msg.get("message_id"),
        }

    return None


def is_admin_user(from_user: dict) -> bool:
    """Check if the TG user is an admin."""
    uid = str(from_user.get("id", ""))
    return uid in SR_ADMIN_IDS


def send_daily_summary(conn) -> bool:
    """Send a daily summary of SR activity to the TG group."""
    if not SR_GROUP_ID:
        return False

    try:
        # Today's stats
        stats = conn.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
                SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as ack_count,
                SUM(CASE WHEN status = 'on_the_way' THEN 1 ELSE 0 END) as otw_count,
                SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END) as settled_count,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
            FROM service_requests 
            WHERE date(created_at) = date('now', '+5 hours', '+30 minutes')
        """).fetchone()

        # Agent-wise breakdown
        agents = conn.execute("""
            SELECT u.name, 
                COUNT(*) as total,
                SUM(CASE WHEN sr.status = 'settled' THEN 1 ELSE 0 END) as settled,
                SUM(CASE WHEN sr.status = 'closed' THEN 1 ELSE 0 END) as closed,
                SUM(CASE WHEN sr.status IN ('open','acknowledged','on_the_way') THEN 1 ELSE 0 END) as pending
            FROM service_requests sr
            LEFT JOIN users u ON u.id = sr.assigned_to
            WHERE date(sr.created_at) = date('now', '+5 hours', '+30 minutes')
            GROUP BY sr.assigned_to
        """).fetchall()

        # SRs created from Telegram (by agent) — potential fake check
        tg_created = conn.execute("""
            SELECT sr.ticket_no, c.name as customer_name, sr.status, sr.description
            FROM service_requests sr
            LEFT JOIN customers c ON c.customer_id = sr.customer_id
            WHERE sr.source = 'telegram' 
            AND date(sr.created_at) = date('now', '+5 hours', '+30 minutes')
            ORDER BY sr.created_at DESC
        """).fetchall()

        # Pending older than 24h
        overdue = conn.execute("""
            SELECT sr.ticket_no, c.name, sr.status, sr.created_at
            FROM service_requests sr
            LEFT JOIN customers c ON c.customer_id = sr.customer_id
            WHERE sr.status IN ('open','acknowledged','on_the_way')
            AND date(sr.created_at) < date('now', '+5 hours', '+30 minutes', '-1 day')
            ORDER BY sr.created_at
        """).fetchall()

        total = stats["total"] or 0
        if total == 0 and not overdue:
            # Nothing to report
            return False

        SEP = "━━━━━━━━━━━━━━━━"
        lines = [
            "<b>📊 Daily SR Summary</b>",
            f"📅 {datetime.utcnow().strftime('%d-%b-%Y')}",
            SEP,
        ]

        if total > 0:
            lines.append(f"🆕 New today: <b>{total}</b>")
            if stats["settled_count"]: lines.append(f"✅ Settled: {stats['settled_count']}")
            if stats["closed_count"]: lines.append(f"🔒 Closed: {stats['closed_count']}")
            if stats["open_count"]: lines.append(f"🔵 Open: {stats['open_count']}")
            if stats["ack_count"]: lines.append(f"👀 Ack: {stats['ack_count']}")
            if stats["otw_count"]: lines.append(f"🚀 OTW: {stats['otw_count']}")
            if stats["cancelled_count"]: lines.append(f"❌ Cancelled: {stats['cancelled_count']}")

            # Agent breakdown
            if agents:
                lines.append(SEP)
                lines.append("<b>👷 Agents</b>")
                for a in agents:
                    name = a["name"] or "Unassigned"
                    s = a["settled"] or 0
                    p = a["pending"] or 0
                    lines.append(f"  {name}: {a['total']}t ✅{s} ⏳{p}")

            # TG-created SRs
            if tg_created:
                lines.append(SEP)
                lines.append("<b>📱 On-field</b>")
                for t in tg_created[:10]:
                    cust = t["customer_name"] or "?"
                    # Short status label
                    st = t["status"].replace("on_the_way", "OTW").replace("acknowledged", "ACK")
                    lines.append(f"  {t['ticket_no']} {cust} ({st})")

        # Overdue
        if overdue:
            lines.append(SEP)
            lines.append("<b>⚠️ Overdue 24h+</b>")
            for o in overdue[:10]:
                st = o["status"].replace("on_the_way", "OTW").replace("acknowledged", "ACK")
                lines.append(f"  {o['ticket_no']} {o['name']} ({st})")

        lines.append(SEP)
        pending_total = conn.execute(
            "SELECT COUNT(*) as c FROM service_requests WHERE status IN ('open','acknowledged','on_the_way')"
        ).fetchone()["c"]
        lines.append(f"📋 Pending: <b>{pending_total}</b>")

        return send_message(SR_GROUP_ID, "\n".join(lines))

    except Exception as e:
        log.error(f"Daily summary error: {e}")
        return False
