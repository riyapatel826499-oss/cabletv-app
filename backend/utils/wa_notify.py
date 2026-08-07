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

def _render_template(template, **vars):
    if not template:
        return ""
    text = template
    for k, v in vars.items():
        text = text.replace("{" + k + "}", str(v or ""))
    return text


# Tamil month names + day abbreviations for receipts
_TAMIL_MONTHS = {
    1: "ஜனவரி", 2: "பிப்ரவரி", 3: "மார்ச்", 4: "ஏப்ரல்",
    5: "மே", 6: "ஜூன்", 7: "ஜூலை", 8: "ஆகஸ்ட்",
    9: "செப்டம்பர்", 10: "அக்டோபர்", 11: "நவம்பர்", 12: "டிசம்பர்",
}
_TAMIL_MODE = {
    "Cash": "ரொக்கம்",
    "GPay": "ஜிபே",
    "PhonePe": "போன்பே",
    "UPI": "யூபிஐ",
    "Bank": "வங்கி",
    "Other": "மற்றவை",
}


def _tamil_month(date_obj):
    return _TAMIL_MONTHS.get(date_obj.month, "")


def _format_ta_date(date_obj):
    """DD MMM YYYY in Tamil (e.g. 06 ஆகஸ்ட் 2026)."""
    return f"{date_obj.day:02d} {_tamil_month(date_obj)} {date_obj.year}"


def _mode_ta(mode):
    if not mode:
        return ""
    return _TAMIL_MODE.get(mode, mode)


def send_payment_receipt(customer_name, phone, amount, month_year,
                         plan_name=None, payment_mode=None, collector_name=None,
                         expiry_date=None, upi_id="selvanayakiammancables-3@okhdfcbank",
                         care_phone="7708551139",
                         business_name="Sree Selvanaayakki Amman Cables & Internet Services",
                         customer_id=None,
                         template=None,
                         template_ta=None):
    jid = _normalize_phone(phone)
    if not jid or not _wa_bridge_available():
        return False
    month_display = month_year or ""
    month_display_ta = month_year or ""
    try:
        parts = month_year.split("-")
        from datetime import datetime
        m_obj = datetime(int(parts[1]), int(parts[0]), 1)
        month_display = m_obj.strftime("%B %Y")
        month_display_ta = _format_ta_date(m_obj)  # e.g. 01 ஆகஸ்ட் 2026 — strip day
        month_display_ta = " ".join(month_display_ta.split()[1:])  # ஆகஸ்ட் 2026
    except Exception:
        pass
    expiry_display = ""
    expiry_display_ta = ""
    if expiry_date:
        try:
            from datetime import datetime as _dt
            e_dt = _dt.strptime(expiry_date, "%Y-%m-%d")
            expiry_display = e_dt.strftime("%d-%m-%Y")
            expiry_display_ta = _format_ta_date(e_dt)
        except Exception:
            expiry_display = expiry_date
    from datetime import date as _date
    date_display = ""
    date_display_ta = ""
    try:
        today = _date.today()
        date_display = today.strftime("%d %b %Y")
        date_display_ta = _format_ta_date(today)
    except Exception:
        pass

    vars_all = {
        "business": business_name,
        "customer": customer_name,
        "customer_id": customer_id or "",
        "amount": f"{amount:,.0f}",
        "month": month_display,
        "mode": payment_mode or "",
        "date": date_display,
        "valid_till": expiry_display,
        "upi": upi_id,
        "phone": care_phone or "",
        "plan": plan_name or "",
        "collector": collector_name or "",
        # Tamil-only placeholders
        "month_ta": month_display_ta,
        "mode_ta": _mode_ta(payment_mode),
        "date_ta": date_display_ta,
        "valid_till_ta": expiry_display_ta,
    }

    if template:
        message = _render_template(template, **vars_all)
        # Append Tamil block when a Tamil template is configured
        if template_ta and template_ta.strip():
            ta_msg = _render_template(template_ta, **vars_all)
            message = message + "\n\n" + ta_msg
    else:
        # Fallback: original emoji format
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
        message = "\n".join(lines)
    try:
        payload = json.dumps({"chatId": jid, "message": message}).encode()
        req = urllib.request.Request(WA_BRIDGE_URL, data=payload, headers={"Content-Type":"application/json"}, method="POST")
        return json.loads(urllib.request.urlopen(req, timeout=10).read()).get("success", False)
    except Exception as e:
        logger.warning("WA receipt error for %s: %s", jid, e)
        return False


def send_wa_message(phone, message):
    """Send an arbitrary WhatsApp message to the customer via the Baileys bridge.

    Returns True only if the bridge is connected and the message was accepted.
    Safe no-op (returns False) if phone invalid or bridge down.
    """
    jid = _normalize_phone(phone)
    if not jid or not _wa_bridge_available():
        return False
    try:
        payload = json.dumps({"chatId": jid, "message": message}).encode()
        req = urllib.request.Request(
            WA_BRIDGE_URL, data=payload,
            headers={"Content-Type": "application/json"}, method="POST")
        return json.loads(urllib.request.urlopen(req, timeout=10).read()).get("success", False)
    except Exception as e:
        logger.warning("WA message error for %s: %s", jid, e)
        return False
