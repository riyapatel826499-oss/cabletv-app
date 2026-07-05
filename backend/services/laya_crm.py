"""
Laya CRM Client — session-aware HTTP client for crm.layanetwork.in
Provides: login, get_subscribers, get_statement, get_wallet
Session cached for 20 min (Laravel session lifetime).
"""
import re
import ssl
import time
import json
import urllib.request
import urllib.parse
import http.cookiejar
import logging
import os
import tempfile

log = logging.getLogger(__name__)

CRM_BASE = "https://crm.layanetwork.in"
USER = os.environ.get("LAYA_USER", "SSNA-302")
PASS = os.environ.get("LAYA_PASS", "admin123")

SESSION_FILE = os.path.join(tempfile.gettempdir(), "laya_session.json")
SESSION_TTL = 20 * 60  # 20 min

# SSL context (skip verification — Laya uses a self-signed cert)
_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE

_cookiejar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(_cookiejar),
    urllib.request.HTTPSHandler(context=_ctx),
)


def _request(url, data=None, headers=None, method=None):
    """Make an HTTP request with session cookies. Returns (status, body_text)."""
    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    if headers:
        hdrs.update(headers)

    if data is not None:
        if isinstance(data, dict):
            data = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method or "POST")
    else:
        req = urllib.request.Request(url, headers=hdrs, method=method or "GET")

    try:
        resp = _opener.open(req, timeout=20)
        return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)


def _extract_token(html: str) -> str:
    """Extract Laravel CSRF _token from HTML."""
    m = re.search(r'name="_token"\s+value="([^"]+)"', html)
    return m.group(1) if m else ""


# ─────────────────────────────────────────────
#  Login
# ─────────────────────────────────────────────

def _login() -> bool:
    """Login to Laya CRM. Returns True on success."""
    # Step 1: GET login page for CSRF token
    code, html = _request(f"{CRM_BASE}/login")
    if code != 200 or not html:
        log.warning(f"Laya login: could not fetch login page ({code})")
        return False

    token = _extract_token(html)
    if not token:
        log.warning("Laya login: no CSRF token found")
        return False

    # Step 2: POST credentials
    code, body = _request(f"{CRM_BASE}/login", data={
        "_token": token,
        "email": USER,
        "password": PASS,
        "remember": "on",
    }, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": f"{CRM_BASE}/login",
    })

    if code == 302 or (code == 200 and "dashboard" in body.lower()):
        _save_session()
        log.info("Laya CRM login SUCCESS")
        return True

    log.warning(f"Laya login failed: HTTP {code}")
    return False


def _save_session():
    """Save session timestamp."""
    with open(SESSION_FILE, "w") as f:
        json.dump({"ts": time.time()}, f)


def _session_alive() -> bool:
    """Check if session is still valid."""
    if not os.path.exists(SESSION_FILE):
        return False
    try:
        data = json.load(open(SESSION_FILE))
        age = time.time() - data.get("ts", 0)
        if age > SESSION_TTL:
            return False
    except Exception:
        return False

    # Quick verify
    code, body = _request(f"{CRM_BASE}/home")
    return code == 200 and len(body) > 5000


def ensure_session() -> bool:
    """Ensure a valid CRM session, re-login if needed."""
    if _session_alive():
        return True
    return _login()


# ─────────────────────────────────────────────
#  Subscribers
# ─────────────────────────────────────────────

def get_subscribers() -> list[dict]:
    """Fetch all subscribers from CRM. Returns list of subscriber dicts."""
    if not ensure_session():
        return []

    # Step 1: GET report page for fresh CSRF token
    code, html = _request(f"{CRM_BASE}/subscriber/subslistreport")
    if code != 200:
        log.warning(f"Laya: could not fetch report page ({code})")
        return []

    token = _extract_token(html)
    if not token:
        log.warning("Laya: no CSRF token in report page")
        return []

    # Step 2: POST to fetch all subscribers
    code, body = _request(
        f"{CRM_BASE}/subscriber/subslistreportfetch",
        data={
            "_token": token,
            "ser_expirydate": "",
            "register_fromdate": "",
            "register_todate": "",
            "active_fromdate": "",
            "active_todate": "",
            "renewal_fromdate": "",
            "renewal_todate": "",
            "expiry_fromdate": "",
            "expiry_todate": "",
            "search_user": "",
        },
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": f"{CRM_BASE}/subscriber/subslistreport",
            "X-Requested-With": "XMLHttpRequest",
        },
    )

    if code != 200:
        log.warning(f"Laya: subscriber fetch failed ({code})")
        return []

    try:
        result = json.loads(body)
        if result.get("status") == 1:
            return result.get("message", [])
    except json.JSONDecodeError:
        log.warning("Laya: subscriber response not JSON")

    return []


# ─────────────────────────────────────────────
#  Statement (Deposit Payment)
# ─────────────────────────────────────────────

def parse_statement_html(html_content: str) -> list[dict]:
    """Parse the depositPayment XLS (actually HTML table) into transactions.

    Returns list of dicts with keys:
        type: 'recharge' | 'online_payment' | 'wallet_topup'
        date: DD-MM-YYYY
        customer_name: str
        total_amount: float (plan price incl GST)
        deposit_share: float (Prabhu's revenue)
        admin_share: float (Laya's cost)
        debit: float
        credit: float
        balance: float
    """
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html_content, re.S)
    transactions = []

    for row in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
        cells = [c.replace("&nbsp;", "").replace("&#160;", "") for c in cells]

        if len(cells) < 6 or not cells[0].strip().isdigit():
            continue

        date = cells[1]
        desc = cells[2]
        credit = float(cells[3].replace(",", "")) if cells[3] else 0
        debit = float(cells[4].replace(",", "")) if cells[4] else 0
        balance = float(cells[5].replace(",", "")) if cells[5] else 0

        # Categorize
        txn = {
            "sno": int(cells[0]),
            "date": date,
            "description": desc,
            "credit": credit,
            "debit": debit,
            "balance": balance,
            "customer_name": "",
            "total_amount": 0,
            "deposit_share": 0,
            "admin_share": 0,
        }

        if credit > 0 and "deposit online" in desc.lower():
            txn["type"] = "wallet_topup"
        elif credit > 0 and "online banking" in desc.lower():
            txn["type"] = "online_payment"
            m = re.search(r"Subscriber Payment,\s*([^,]+)", desc)
            if m:
                txn["customer_name"] = m.group(1).strip()
        elif debit > 0:
            txn["type"] = "recharge"
            # Extract customer name
            m = re.match(r"L[NP]+-[A-Z0-9]+/[^,]+,\s*([^,<]+)", desc)
            if m:
                txn["customer_name"] = m.group(1).strip()
            # Extract amounts
            m_total = re.search(r"Total Amt:([\d.]+)", desc)
            m_deposit = re.search(r"Deposit Share:([\d.]+)", desc)
            m_admin = re.search(r"Admin Share:([\d.]+)", desc)
            m_taxable = re.search(r"Taxable Amt:([\d.]+)", desc)
            txn["total_amount"] = float(m_total.group(1)) if m_total else 0
            txn["deposit_share"] = float(m_deposit.group(1)) if m_deposit else 0
            txn["admin_share"] = float(m_admin.group(1)) if m_admin else 0
            txn["taxable_amount"] = float(m_taxable.group(1)) if m_taxable else 0
        else:
            continue

        transactions.append(txn)

    return transactions


def parse_statement_file(filepath: str) -> list[dict]:
    """Parse a downloaded depositPayment .xls file."""
    with open(filepath, "r", errors="replace") as f:
        return parse_statement_html(f.read())


# ─────────────────────────────────────────────
#  Wallet
# ─────────────────────────────────────────────

def get_wallet_balance() -> dict:
    """Get current deposit wallet balance from CRM dashboard."""
    if not ensure_session():
        return {"balance": None, "error": "Login failed"}

    code, html = _request(f"{CRM_BASE}/home")
    if code != 200:
        return {"balance": None, "error": f"HTTP {code}"}

    # Parse wallet balance from dashboard
    # Format: "Deposit Wallet:  <span>1,630.09</span>"
    m = re.search(r"Deposit Wallet.*?([0-9,]+\.?\d*)", html, re.S)
    balance = float(m.group(1).replace(",", "")) if m else None

    # Also try subscriber wallet
    m2 = re.search(r"Subscriber Wallet.*?([0-9,]+\.?\d*)", html, re.S)
    sub_balance = float(m2.group(1).replace(",", "")) if m2 else None

    return {
        "deposit_wallet": balance,
        "subscriber_wallet": sub_balance,
    }
