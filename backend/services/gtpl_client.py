"""
GTPL Saathi Client — session-aware curl automation
Provides: login, suspend, activate, renew, change_package
Session cached for 25 min — auto re-login when expired.
"""
import subprocess
import re
import base64
import io
import json
import logging
import os
import time
import threading
import urllib.parse
from typing import Optional

log = logging.getLogger(__name__)

COOKIE_JAR       = "/tmp/gtpl_cookies.txt"
CAPTCHA_PNG      = "/tmp/gtpl_captcha.png"
HIDDEN_FIELDS    = "/tmp/gtpl_hidden_fields.json"
SESSION_TS_FILE  = "/tmp/gtpl_session_ts.txt"
SESSION_TTL      = 25 * 60   # 25 min — safe under 30-min GTPL idle timeout

USER = "SPCHE5698"
PASS = "Indhu@1007"

# GTPL plan codes (Base packs only — what LCO can change)
GTPL_PLANS = {
    "TAMIL PRIME":                 "PRIME_CC",
    "TAMIL POWER":                 "POWER_CC",
    "TAMIL ROYAL HD":              "ROYALHD_CC",
    "TAMIL POWER PLUS":            "POWRPLS_CC",
    "TAMIL MALAYALAM POWER PLUS":  "TP_TMML_PP",
    "TAMIL TELUGU POWER PLUS":     "TP_TMTL_PP",
    "TAMIL KANNADA POWER PLUS":    "TP_TMTP_PP",
    "TAMIL HINDI POWER PLUS":      "TP_TMHN_PP",
    "TAMIL FTA":                   "FTA_CC",
}
GTPL_PLAN_CODES = list(GTPL_PLANS.values())

_lock = threading.Lock()


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

def _curl_get(url: str, referer: str = None) -> str:
    cmd = ["curl", "-s", "--max-time", "20",
           "-b", COOKIE_JAR, "-c", COOKIE_JAR,
           "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
           "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"]
    if referer:
        cmd += ["-H", f"Referer: {referer}"]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout


def _curl_post(url: str, data: dict, referer: str = None) -> tuple[str, str]:
    """Returns (headers, body)."""
    postdata = urllib.parse.urlencode(data)
    postfile = "/tmp/gtpl_post_payload.txt"
    with open(postfile, "w") as f:
        f.write(postdata)

    hdrs_file = "/tmp/gtpl_post_hdrs.txt"
    body_file = "/tmp/gtpl_post_body.html"

    cmd = ["curl", "-s", "--max-time", "20",
           "-b", COOKIE_JAR, "-c", COOKIE_JAR,
           "-H", "Content-Type: application/x-www-form-urlencoded",
           "-H", "Origin: https://gtplsaathi.com",
           "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
           "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"]
    if referer:
        cmd += ["-H", f"Referer: {referer}"]
    cmd += ["--data", f"@{postfile}", "-D", hdrs_file, "-o", body_file, url]

    subprocess.run(cmd, capture_output=True)
    hdrs = open(hdrs_file).read() if os.path.exists(hdrs_file) else ""
    body = open(body_file).read() if os.path.exists(body_file) else ""
    return hdrs, body


def _extract_field(name: str, html: str) -> str:
    for pattern in [
        rf'id="{name}"[^>]*value="([^"]*)"',
        rf'name="{name}"[^>]*value="([^"]*)"',
        rf'value="([^"]*)"\s+id="{name}"',
        rf'value="([^"]*)"\s+name="{name}"',
    ]:
        m = re.search(pattern, html)
        if m:
            return m.group(1)
    return ""


def _viewstate(html: str) -> dict:
    return {
        "__VIEWSTATE":          _extract_field("__VIEWSTATE", html),
        "__VIEWSTATEGENERATOR": _extract_field("__VIEWSTATEGENERATOR", html),
        "__VIEWSTATEENCRYPTED": "",
        "__EVENTVALIDATION":    _extract_field("__EVENTVALIDATION", html),
    }


def _session_alive() -> bool:
    """Quick check: does session cookie exist and is it recent?"""
    if not os.path.exists(COOKIE_JAR):
        return False
    if not os.path.exists(SESSION_TS_FILE):
        return False
    age = time.time() - float(open(SESSION_TS_FILE).read().strip())
    if age > SESSION_TTL:
        return False
    # Verify server-side — check home.aspx size
    try:
        html = _curl_get("https://gtplsaathi.com/home.aspx")
        return len(html) > 20000 and "SPCHE5698" in html
    except Exception:
        return False


# ─────────────────────────────────────────────
#  Login
# ─────────────────────────────────────────────

def _login(max_attempts: int = 3) -> bool:
    """Login to GTPL Saathi using ddddocr for CAPTCHA solving."""
    for attempt in range(1, max_attempts + 1):
        log.info(f"GTPL login attempt {attempt}/{max_attempts}")

        # Clear old cookies
        for f in [COOKIE_JAR, SESSION_TS_FILE]:
            if os.path.exists(f):
                os.remove(f)

        # GET login page
        html = _curl_get("https://gtplsaathi.com/Login.aspx")
        if len(html) < 5000:
            log.warning(f"Login page too small: {len(html)}B")
            time.sleep(2)
            continue

        # Extract CAPTCHA
        b64_match = re.search(r'data:image/gif;base64,([^"\']+)', html)
        if not b64_match:
            log.warning("No CAPTCHA found in login page")
            time.sleep(2)
            continue

        img_bytes = base64.b64decode(b64_match.group(1).strip())
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(img_bytes))
            img.save(CAPTCHA_PNG, "PNG")
        except Exception:
            with open("/tmp/gtpl_cap.gif", "wb") as f:
                f.write(img_bytes)
            subprocess.run(["convert", "/tmp/gtpl_cap.gif", CAPTCHA_PNG], capture_output=True)

        # Solve with ddddocr
        try:
            import ddddocr
            ocr = ddddocr.DdddOcr(show_ad=False)
            with open(CAPTCHA_PNG, "rb") as f:
                captcha = ocr.classification(f.read()).strip()
        except Exception as e:
            log.error(f"ddddocr failed: {e}")
            time.sleep(2)
            continue

        if not captcha:
            log.warning("ddddocr returned empty CAPTCHA")
            time.sleep(2)
            continue

        log.info(f"CAPTCHA solved: {captcha}")

        # Extract ViewState
        vs = _viewstate(html)
        if not vs["__VIEWSTATE"]:
            log.warning("No VIEWSTATE found")
            time.sleep(2)
            continue

        # POST login
        payload = {**vs,
                   "txtuser": USER, "txtpassword": PASS,
                   "txtSecurityCode": captcha, "hdnImage": "",
                   "chkRememberMe": "on", "btn_login": "Log in"}

        hdrs, body = _curl_post("https://gtplsaathi.com/Login.aspx", payload,
                                referer="https://gtplsaathi.com/Login.aspx")

        if "302" in hdrs and "IntroPageGuj" in hdrs:
            log.info("GTPL login SUCCESS")
            with open(SESSION_TS_FILE, "w") as f:
                f.write(str(time.time()))
            return True
        elif len(body) == 0:
            log.warning("Login: empty response — WAF block or ViewState expired")
        elif "Invalid Security Code" in body:
            log.warning(f"Login: wrong CAPTCHA ({captcha})")
        else:
            err = re.search(r'LBL_ERR[^>]*>([^<]+)', body)
            log.warning(f"Login failed: {err.group(1) if err else body[:80]}")

        time.sleep(2)

    log.error("GTPL login: all attempts failed")
    return False


def ensure_session() -> bool:
    """Thread-safe: ensure a valid GTPL session exists. Re-login if needed."""
    with _lock:
        if _session_alive():
            return True
        return _login()


# ─────────────────────────────────────────────
#  Suspend / Activate
# ─────────────────────────────────────────────

def _suspend_or_activate(stb_no: str, action: str) -> dict:
    """
    action: 'SUSPEND' or 'ACTIVE'
    Returns: {"success": bool, "message": str}
    """
    if not ensure_session():
        return {"success": False, "message": "GTPL login failed"}

    url = "https://gtplsaathi.com/Suspend.aspx"
    reason = "Payment Due" if action == "SUSPEND" else "Payment Received"

    try:
        # Step 1: GET fresh page
        html = _curl_get(url)
        vs = _viewstate(html)
        if not vs["__VIEWSTATE"]:
            return {"success": False, "message": "Could not load Suspend.aspx"}

        # Step 2: Search STB
        payload = {**vs,
                   "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                   "ctl00$ContentPlaceHolder1$txtAccount": "",
                   "ctl00$ContentPlaceHolder1$btn_visible": "Search"}
        _, body = _curl_post(url, payload, referer=url)
        if not body or len(body) < 1000:
            return {"success": False, "message": "STB search returned empty response"}

        # Extract account number
        acct_match = re.search(
            r'name="ctl00\$ContentPlaceHolder1\$txtAccount"[^>]*value="([^"]*)"', body)
        txtAccount = acct_match.group(1) if acct_match else ""
        if not txtAccount:
            return {"success": False, "message": f"STB {stb_no} not found on GTPL portal"}

        vs2 = _viewstate(body)

        # Step 3: PostBack — set action dropdown
        payload2 = {**vs2,
                    "__EVENTTARGET": "ctl00$ContentPlaceHolder1$com_complain",
                    "__EVENTARGUMENT": "",
                    "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                    "ctl00$ContentPlaceHolder1$txtAccount": txtAccount,
                    "ctl00$ContentPlaceHolder1$com_complain": action,
                    "ctl00$ContentPlaceHolder1$com_reason": reason,
                    "ctl00$ContentPlaceHolder1$txt_notes": ""}
        _, body3 = _curl_post(url, payload2, referer=url)
        vs3 = _viewstate(body3) if body3 else vs2

        # Step 4: Submit
        payload3 = {**vs3,
                    "__EVENTTARGET": "",
                    "__EVENTARGUMENT": "",
                    "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                    "ctl00$ContentPlaceHolder1$txtAccount": txtAccount,
                    "ctl00$ContentPlaceHolder1$com_complain": action,
                    "ctl00$ContentPlaceHolder1$com_reason": reason,
                    "ctl00$ContentPlaceHolder1$txt_notes": "",
                    "ctl00$ContentPlaceHolder1$btn_ORDER": "Submit"}
        _, body4 = _curl_post(url, payload3, referer=url)

        if body4 and "successfully" in body4.lower():
            verb = "Suspended" if action == "SUSPEND" else "Activated"
            return {"success": True, "message": f"STB {stb_no} {verb} on GTPL successfully"}
        else:
            snippet = body4[:200] if body4 else "empty response"
            return {"success": False, "message": f"GTPL action failed: {snippet}"}

    except Exception as e:
        log.exception("GTPL suspend/activate error")
        return {"success": False, "message": str(e)}


def suspend_stb(stb_no: str) -> dict:
    return _suspend_or_activate(stb_no, "SUSPEND")


def activate_stb(stb_no: str) -> dict:
    return _suspend_or_activate(stb_no, "ACTIVE")


# ─────────────────────────────────────────────
#  Renew
# ─────────────────────────────────────────────

def renew_stb(stb_no: str, months: int = 1) -> dict:
    """
    Renew STB subscription on GTPL.
    months: 1, 2, 3, 6, 12
    """
    validity_map = {1: "D30", 2: "D60", 3: "D90", 6: "D180", 12: "D360"}
    if months not in validity_map:
        return {"success": False, "message": f"Invalid months: {months}. Use 1/2/3/6/12"}

    if not ensure_session():
        return {"success": False, "message": "GTPL login failed"}

    url = "https://gtplsaathi.com/Renew.aspx"
    validity = validity_map[months]

    try:
        # Step 1: GET fresh page
        html = _curl_get(url)
        vs = _viewstate(html)
        if not vs["__VIEWSTATE"]:
            return {"success": False, "message": "Could not load Renew.aspx"}

        # Step 2: Search STB
        payload = {**vs,
                   "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                   "ctl00$ContentPlaceHolder1$txtAccount": "",
                   "ctl00$ContentPlaceHolder1$btn_visible": "Search"}
        _, body = _curl_post(url, payload, referer=url)
        if not body or len(body) < 1000:
            return {"success": False, "message": "STB search returned empty"}

        # Check if STB was found
        if "Object moved" in body or len(body) < 5000:
            return {"success": False, "message": f"STB {stb_no} not found"}

        # Extract account and contract info
        acct_match = re.search(
            r'name="ctl00\$ContentPlaceHolder1\$txtAccount"[^>]*value="([^"]*)"', body)
        txtAccount = acct_match.group(1) if acct_match else ""

        # Extract current plan radio value
        radio_match = re.search(
            r'name="ctl00\$ContentPlaceHolder1\$rptDC\$ctl00\$report_validity"[^>]*value="([^"]*)"',
            body)
        # Extract price shown
        price_match = re.search(r'id="rptDC_lbl_price_0"[^>]*>([^<]+)', body)
        price = price_match.group(1).strip() if price_match else "?"

        # Extract package name
        pkg_match = re.search(r'(?:TAMIL\s+\w+(?:\s+\w+)?)', body)
        pkg_name = pkg_match.group(0) if pkg_match else "Unknown"

        vs2 = _viewstate(body)

        # Step 3: Submit renewal
        payload2 = {**vs2,
                    "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                    "ctl00$ContentPlaceHolder1$txtAccount": txtAccount,
                    f"ctl00$ContentPlaceHolder1$rptDC$ctl00$report_validity": validity,
                    "ctl00$ContentPlaceHolder1$btn_Reconnect": "Renew"}
        _, body2 = _curl_post(url, payload2, referer=url)

        if body2 and "successfully" in body2.lower():
            return {"success": True,
                    "message": f"STB {stb_no} renewed for {months} month(s). "
                               f"Package: {pkg_name}, MRP: ₹{price}/mo"}
        else:
            snippet = body2[:200] if body2 else "empty"
            return {"success": False, "message": f"Renewal failed: {snippet}"}

    except Exception as e:
        log.exception("GTPL renew error")
        return {"success": False, "message": str(e)}


# ─────────────────────────────────────────────
#  Package Change
# ─────────────────────────────────────────────

def change_package(stb_no: str, target_plan_code: str) -> dict:
    """
    Change STB package on GTPL.
    target_plan_code: e.g. 'PRIME_CC', 'POWER_CC', 'ROYALHD_CC'
    """
    if target_plan_code not in GTPL_PLAN_CODES:
        return {"success": False,
                "message": f"Unknown plan code: {target_plan_code}. "
                           f"Valid: {', '.join(GTPL_PLAN_CODES)}"}

    if not ensure_session():
        return {"success": False, "message": "GTPL login failed"}

    url = "https://gtplsaathi.com/ChangeOrder.aspx"

    try:
        # Step 1: GET fresh page
        html = _curl_get(url)
        vs = _viewstate(html)
        if not vs["__VIEWSTATE"]:
            return {"success": False, "message": "Could not load ChangeOrder.aspx"}

        # Step 2: Search STB
        payload = {**vs,
                   "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                   "ctl00$ContentPlaceHolder1$txtAccount": "",
                   "ctl00$ContentPlaceHolder1$btn_visible": "Search"}
        _, body = _curl_post(url, payload, referer=url)
        if not body or len(body) < 5000:
            return {"success": False, "message": f"STB {stb_no} not found"}

        # Extract account and current package
        acct_match = re.search(
            r'name="ctl00\$ContentPlaceHolder1\$txtAccount"[^>]*value="([^"]*)"', body)
        txtAccount = acct_match.group(1) if acct_match else ""

        rptDC_match = re.search(
            r'name="ctl00\$ContentPlaceHolder1\$rptDC"[^>]*value="([^"]*)"', body)
        current_pkg = rptDC_match.group(1) if rptDC_match else ""

        if not txtAccount:
            return {"success": False, "message": f"STB {stb_no} not found on portal"}

        if current_pkg == target_plan_code:
            return {"success": False,
                    "message": f"STB {stb_no} is already on {target_plan_code}"}

        vs2 = _viewstate(body)

        # Step 3: Select package type (PostBack)
        payload2 = {**vs2,
                    "__EVENTTARGET": "ctl00$ContentPlaceHolder1$drop_package_type",
                    "__EVENTARGUMENT": "",
                    "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                    "ctl00$ContentPlaceHolder1$txtAccount": txtAccount,
                    "ctl00$ContentPlaceHolder1$rptDC": current_pkg,
                    "ctl00$ContentPlaceHolder1$drop_package_type": "GTPL PACKAGE"}
        _, body3 = _curl_post(url, payload2, referer=url)
        vs3 = _viewstate(body3) if body3 and len(body3) > 1000 else vs2

        # Step 4: Select target package (PostBack)
        payload3 = {**vs3,
                    "__EVENTTARGET": "ctl00$ContentPlaceHolder1$rptDCNew",
                    "__EVENTARGUMENT": "",
                    "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                    "ctl00$ContentPlaceHolder1$txtAccount": txtAccount,
                    "ctl00$ContentPlaceHolder1$rptDC": current_pkg,
                    "ctl00$ContentPlaceHolder1$drop_package_type": "GTPL PACKAGE",
                    "ctl00$ContentPlaceHolder1$rptDCNew": target_plan_code}
        _, body4 = _curl_post(url, payload3, referer=url)
        vs4 = _viewstate(body4) if body4 and len(body4) > 1000 else vs3

        # Step 5: Submit Change Order
        payload4 = {**vs4,
                    "__EVENTTARGET": "",
                    "__EVENTARGUMENT": "",
                    "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                    "ctl00$ContentPlaceHolder1$txtAccount": txtAccount,
                    "ctl00$ContentPlaceHolder1$rptDC": current_pkg,
                    "ctl00$ContentPlaceHolder1$drop_package_type": "GTPL PACKAGE",
                    "ctl00$ContentPlaceHolder1$rptDCNew": target_plan_code,
                    "ctl00$ContentPlaceHolder1$btn_ORDER": "Change Order"}
        _, body5 = _curl_post(url, payload4, referer=url)

        # Verify — search STB again and check package
        time.sleep(1)
        html6 = _curl_get(url)
        vs6 = _viewstate(html6)
        payload5 = {**vs6,
                    "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                    "ctl00$ContentPlaceHolder1$txtAccount": "",
                    "ctl00$ContentPlaceHolder1$btn_visible": "Search"}
        _, verify_body = _curl_post(url, payload5, referer=url)

        # Check if new package is active
        if target_plan_code in (verify_body or ""):
            pkg_name = next((k for k, v in GTPL_PLANS.items() if v == target_plan_code),
                            target_plan_code)
            return {"success": True,
                    "message": f"STB {stb_no} package changed to {pkg_name} successfully"}
        else:
            # Check wallet deduction as alternate success indicator
            if body5 and len(body5) < 5000:  # Redirected away = likely success
                pkg_name = next((k for k, v in GTPL_PLANS.items() if v == target_plan_code),
                                target_plan_code)
                return {"success": True,
                        "message": f"STB {stb_no} package change submitted for {pkg_name} "
                                   f"(verify on GTPL portal)"}
            return {"success": False,
                    "message": f"Package change may have failed — verify on GTPL portal"}

    except Exception as e:
        log.exception("GTPL package change error")
        return {"success": False, "message": str(e)}


# ─────────────────────────────────────────────
#  Status Check
# ─────────────────────────────────────────────

def get_stb_status(stb_no: str) -> dict:
    """Get current GTPL status for an STB."""
    if not ensure_session():
        return {"success": False, "message": "GTPL login failed"}

    url = "https://gtplsaathi.com/Suspend.aspx"
    try:
        html = _curl_get(url)
        vs = _viewstate(html)
        if not vs["__VIEWSTATE"]:
            return {"success": False, "message": "Could not load Suspend.aspx"}

        payload = {**vs,
                   "ctl00$ContentPlaceHolder1$txtserial": stb_no,
                   "ctl00$ContentPlaceHolder1$txtAccount": "",
                   "ctl00$ContentPlaceHolder1$btn_visible": "Search"}
        _, body = _curl_post(url, payload, referer=url)

        if not body or len(body) < 5000:
            return {"success": False, "message": f"STB {stb_no} not found"}

        # Parse status from dropdown disabled value
        status = "UNKNOWN"
        if 'value="ACTIVE"' in body and 'selected' in body[body.find('value="ACTIVE"'):body.find('value="ACTIVE"')+100]:
            status = "ACTIVE"
        elif 'value="SUSPEND"' in body and 'selected' in body[body.find('value="SUSPEND"'):body.find('value="SUSPEND"')+100]:
            status = "SUSPENDED"
        elif 'INACTIVE' in body.upper()[:10000]:
            status = "INACTIVE"
        elif 'value="ACTIVE"' in body:
            # com_complain dropdown: check which is selected
            com_match = re.search(r'com_complain[^>]*>(.*?)</select>', body, re.DOTALL)
            if com_match:
                sel = com_match.group(1)
                if 'selected' in sel:
                    val_m = re.search(r'value="([^"]+)"[^>]*selected', sel)
                    if val_m:
                        status = val_m.group(1)

        # Extract name
        name_match = re.search(r'Subscriber\s*Name[^:]*:\s*([^\n<]+)', body)
        name = name_match.group(1).strip() if name_match else ""

        return {"success": True, "stb_no": stb_no, "gtpl_status": status, "name": name}

    except Exception as e:
        log.exception("GTPL status check error")
        return {"success": False, "message": str(e)}
