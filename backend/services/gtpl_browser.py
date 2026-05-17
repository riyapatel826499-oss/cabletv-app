"""
GTPL Saathi Portal — Browser-based login & operations
Uses ddddocr for CAPTCHA, Hermes browser tool for ASP.NET WebForms.
Session persisted via browser cookies (30 min TTL).

Installation:
  pip install ddddocr pillow
"""
import sys, os, re, base64, io, time, json, subprocess, urllib.parse

# ── Config ──
GTPL_USER = "SPCHE5698"
GTPL_PASS = "Chaitanya@0506"
GTPL_BASE = "https://gtplsaathi.com"
COOKIE_JAR = "/tmp/gtpl_cookies.txt"
SESSION_TS = "/tmp/gtpl_session_ts.txt"
SESSION_TTL = 25 * 60  # 25 min

# ── Login via curl (for API/backend use) ──
def curl_login():
    """Login using curl + ddddocr. Returns True if success."""
    import ddddocr
    
    for attempt in range(3):
        # Clear old session
        for f in [COOKIE_JAR, SESSION_TS]:
            if os.path.exists(f): os.remove(f)
        
        # GET login page
        r = subprocess.run(["curl", "-s", "--max-time", "20",
                           "-c", COOKIE_JAR, "-b", COOKIE_JAR,
                           "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                           f"{GTPL_BASE}/Login.aspx"], capture_output=True, text=True)
        html = r.stdout
        if len(html) < 5000:
            time.sleep(2); continue
        
        # Extract CAPTCHA
        b64m = re.search(r'data:image/gif;base64,([^"\']+)', html)
        if not b64m:
            time.sleep(2); continue
        
        # Solve CAPTCHA
        img_bytes = base64.b64decode(b64m.group(1).strip())
        ocr = ddddocr.DdddOcr(show_ad=False)
        captcha = ocr.classification(img_bytes).strip()
        if not captcha:
            time.sleep(2); continue
        
        # Extract ViewState
        def extract_field(name, html):
            for pat in [rf'id="{name}"[^>]*value="([^"]*)"', rf'name="{name}"[^>]*value="([^"]*)"',
                       rf'value="([^"]*)"\s+id="{name}"', rf'value="([^"]*)"\s+name="{name}"']:
                m = re.search(pat, html)
                if m: return m.group(1)
            return ""
        
        vs = {"__VIEWSTATE": extract_field("__VIEWSTATE", html),
              "__VIEWSTATEGENERATOR": extract_field("__VIEWSTATEGENERATOR", html),
              "__VIEWSTATEENCRYPTED": "",
              "__EVENTVALIDATION": extract_field("__EVENTVALIDATION", html)}
        
        if not vs["__VIEWSTATE"]:
            time.sleep(2); continue
        
        # POST login
        payload = urllib.parse.urlencode({**vs,
            "txtuser": GTPL_USER, "txtpassword": GTPL_PASS,
            "txtSecurityCode": captcha, "hdnImage": "",
            "chkRememberMe": "on", "btn_login": "Log in"})
        
        with open("/tmp/gtpl_post.txt", "w") as f: f.write(payload)
        
        r2 = subprocess.run(["curl", "-s", "--max-time", "20",
                            "-b", COOKIE_JAR, "-c", COOKIE_JAR,
                            "-H", "Content-Type: application/x-www-form-urlencoded",
                            "-H", "Origin: https://gtplsaathi.com",
                            "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                            "-H", f"Referer: {GTPL_BASE}/Login.aspx",
                            "-D", "/tmp/gtpl_login_hdrs.txt",
                            "-o", "/tmp/gtpl_login_body.html",
                            "--data", "@/tmp/gtpl_post.txt",
                            f"{GTPL_BASE}/Login.aspx"], capture_output=True, text=True)
        
        hdrs = open("/tmp/gtpl_login_hdrs.txt").read() if os.path.exists("/tmp/gtpl_login_hdrs.txt") else ""
        
        if "302" in hdrs and "IntroPageGuj" in hdrs:
            with open(SESSION_TS, "w") as f: f.write(str(time.time()))
            return True
        
        body = open("/tmp/gtpl_login_body.html").read() if os.path.exists("/tmp/gtpl_login_body.html") else ""
        if "Invalid Security Code" in body:
            print(f"  Wrong CAPTCHA: {captcha}")
        time.sleep(2)
    
    return False


def session_alive():
    """Check if curl session is still valid."""
    if not os.path.exists(COOKIE_JAR) or not os.path.exists(SESSION_TS):
        return False
    age = time.time() - float(open(SESSION_TS).read().strip())
    if age > SESSION_TTL:
        return False
    # Quick server check
    r = subprocess.run(["curl", "-s", "--max-time", "10",
                       "-b", COOKIE_JAR, "-c", COOKIE_JAR,
                       f"{GTPL_BASE}/home.aspx"], capture_output=True, text=True)
    return len(r.stdout) > 20000 and GTPL_USER in r.stdout


# ── Browser-based operations (recommended for Suspend/Active) ──
# These MUST be run via Hermes browser tool, NOT curl,
# because ASP.NET WebForms uses disabled dropdowns + UpdatePanels
# that only work with real JavaScript execution.

"""
BROWSER LOGIN STEPS (use Hermes browser tools):

1. Navigate to https://gtplsaathi.com/Login.aspx
2. Solve CAPTCHA:
   - Extract base64 from page: document.querySelector('img[src^="data:image"]')?.src
   - Decode and solve with ddddocr (run via terminal)
   - Type result into #txtSecurityCode
3. Fill username (#txtuser) and password (#txtpassword)
4. Click "Log in" button
5. Verify login succeeded (check for sidebar/menu)

BROWSER SUSPEND/ACTIVE STEPS:

1. Navigate to https://gtplsaathi.com/Suspend.aspx
2. Type STB number into #ContentPlaceHolder1_txtserial
3. Click Search button (#ContentPlaceHolder1_btn_visible)
4. Wait for page to load customer details
5. Select reason from com_reason dropdown
6. Wait for postback (action dropdown gets enabled)
7. Select ACTIVE or SUSPEND from com_complain dropdown
8. Click Submit button (#ContentPlaceHolder1_btn_ORDER)
9. Check for success message

IMPORTANT: The com_complain dropdown starts DISABLED.
In a real browser, selecting a REASON first triggers a postback
that ENABLES the com_complain dropdown. Then you can change the action.
This is why curl-based operations fail — ASP.NET ignores disabled field values.
"""
