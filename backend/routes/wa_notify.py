"""WhatsApp payment confirmation via Baileys bridge (port 3000)."""
import logging, re, json, urllib.request
from typing import Optional

logger = logging.getLogger(__name__)
WA_BRIDGE_URL = "http://localhost:3000/send"
WA_BRIDGE_HEALTH = "http://localhost:3000/health"

def _normalize_phone(phone):
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("910"):
        digits = digits[2:]
    elif digits.startswith("0"):
        digits = digits[1:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) != 10:
        return None
    return "91" + digits + "@s.whatsapp.net"

def _wa_bridge_available():
    try:
        r = urllib.request.urlopen(WA_BRIDGE_HEALTH, timeout=3)
        return json.loads(r.read()).get("status") == "connected"
    except Exception:
        return False

def send_payment_receipt(customer_name, phone, amount, month_year,
                         plan_name=None, payment_mode=None, collector_name=None,
                         expiry_date=None,
                         business_name="Sree Selvanaayakki Amman Cables & Internet Services"):
    jid = _normalize_phone(phone)
    if not jid or not _wa_bridge_available():
        return False
    month_display = month_year or ""
    try:
        parts = month_year.split("-")
        from datetime import datetime
        month_display = datetime(int(parts[1]), int(parts[0]), 1).strftime("%B %Y")
    except Exception:
        pass
    expiry_display = ""
    if expiry_date:
        try:
            parts = expiry_date.split("-")
            expiry_display = parts[2] + "-" + parts[1] + "-" + parts[0]
        except Exception:
            expiry_display = expiry_date
    lines = ["\u2705 *Payment Received*", "", "\U0001f464 " + customer_name,
             "\U0001f4b0 Amount: *\u20b9" + f"{amount:,.0f}" + "*",
             "\U0001f4c5 Month: " + month_display]
    if plan_name:
        lines.append("\U0001f4fa Plan: " + plan_name)
    if payment_mode:
        icons = {"Cash":"\U0001f4b5","GPay":"\U0001f4f1","PhonePe":"\U0001f4f1","UPI":"\U0001f4f1","Bank":"\U0001f3e6"}
        lines.append(icons.get(payment_mode,"\U0001f4b3") + " Mode: " + payment_mode)
    if collector_name:
        lines.append("\U0001f9d1 Collected by: " + collector_name)
    if expiry_display:
        lines.append("\U0001f4c6 Valid till: " + expiry_display)
    lines.extend(["", "\u2014 *" + business_name + "*"])
    try:
        payload = json.dumps({"chatId": jid, "message": "\n".join(lines)}).encode()
        req = urllib.request.Request(WA_BRIDGE_URL, data=payload, headers={"Content-Type":"application/json"}, method="POST")
        return json.loads(urllib.request.urlopen(req, timeout=10).read()).get("success", False)
    except Exception as e:
        logger.warning("WA receipt error for %s: %s", jid, e)
        return False
