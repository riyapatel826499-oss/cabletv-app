"""Send Telegram payment notifications — reads bot config from DB."""
import httpx
import logging

from routes.settings import get_telegram_config

logger = logging.getLogger(__name__)


def send_telegram(token: str, chat_id: str, text: str) -> bool:
    """Send a message via Telegram Bot API to one chat."""
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        if r.status_code == 200:
            logger.info(f"TG notification sent to {chat_id}")
            return True
        else:
            logger.error(f"TG send failed to {chat_id}: {r.status_code} {r.text[:200]}")
            return False
    except Exception as e:
        logger.error(f"TG send error: {e}")
        return False


def notify_payment(customer_name: str, customer_id: str, amount: float,
                   mode: str = "", source: str = "Local",
                   collector: str = "", area: str = "",
                   operator_id: int = None) -> bool:
    """Send a formatted payment notification to all linked Telegram users."""
    tg = get_telegram_config(operator_id)
    if not tg["token"] or not tg["chat_ids"]:
        logger.info("No Telegram config — skipping notification")
        return False

    src_icon = "🏠" if source == "Local" else "📱"
    if mode == "Cash":
        mode_icon = "💵"
    elif mode in ("GPay", "PhonePe", "UPI", "Online", "Card"):
        mode_icon = "💳"
    else:
        mode_icon = "💰"

    lines = [
        f"{src_icon} <b>Payment Received</b>",
        f"",
        f"<b>{customer_name}</b> ({customer_id})",
        f"{mode_icon} ₹{amount:,.0f} • {mode or 'N/A'}",
    ]
    if area:
        lines.append(f"📍 {area}")
    if collector:
        lines.append(f"👤 {collector}")
    lines.append(f"📡 {source}")

    text = "\n".join(lines)
    results = [send_telegram(tg["token"], cid, text) for cid in tg["chat_ids"]]
    return any(results)
