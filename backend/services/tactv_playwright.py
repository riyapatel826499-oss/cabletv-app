"""
TACTV (Ezybill) Playwright client — automated login with CAPTCHA OCR.
Similar to gtpl_playwright.py but for TACTV SMS portal.
"""
import asyncio
import os
import subprocess
import tempfile
import time
import logging
from pathlib import Path
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

logger = logging.getLogger(__name__)

TACTV_URL = "https://sms.tactv.in/index.php/"
TACTV_USER = os.environ.get("TACTV_USER", "LCO52068")
TACTV_PASS = os.environ.get("TACTV_PASS", "LCO52068")


class TACTVClient:
    """Playwright client for TACTV SMS portal."""

    def __init__(self):
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._logged_in = False

    async def _ensure_browser(self):
        """Launch browser if not running."""
        if self._page and not self._page.is_closed():
            try:
                # Quick health check
                await self._page.evaluate("1+1")
                return
            except Exception:
                pass  # Page is dead, recreate

        if self._playwright is None:
            self._playwright = await async_playwright().start()

        if self._browser is None or not self._browser.is_connected():
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
                      "--single-process", "--no-zygote"]
            )

        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        self._page = await self._context.new_page()
        self._logged_in = False
        logger.info("TACTV browser created")

    async def _solve_captcha(self) -> str:
        """Screenshot CAPTCHA from page, run tesseract OCR, return text."""
        # Wait for captcha image
        captcha_img = await self._page.query_selector('img[src*="/captcha/"]')
        if not captcha_img:
            raise RuntimeError("CAPTCHA image not found on page")

        # Save screenshot of captcha element
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            temp_path = f.name

        await captcha_img.screenshot(path=temp_path)

        # Try OCR with multiple PSM modes
        best_result = ""
        for psm in [7, 8, 13, 6]:
            try:
                result = subprocess.run(
                    ["tesseract", temp_path, "-",
                     f"--psm", str(psm),
                     "-c", "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"],
                    capture_output=True, text=True, timeout=5
                )
                text = result.stdout.strip()
                if text and len(text) >= 4:
                    if not best_result or len(text) > len(best_result):
                        best_result = text
                    logger.info(f"CAPTCHA OCR PSM {psm}: '{text}'")
            except Exception as e:
                logger.warning(f"Tesseract PSM {psm} failed: {e}")

        os.unlink(temp_path)

        if not best_result:
            # Fallback: empty string (will fail validation, trigger retry)
            logger.warning("CAPTCHA OCR returned empty")
            return ""
        return best_result

    async def login(self, max_retries: int = 5) -> bool:
        """Login to TACTV portal. Returns True on success."""
        await self._ensure_browser()

        for attempt in range(1, max_retries + 1):
            logger.info(f"TACTV login attempt {attempt}/{max_retries}")

            # Navigate to login page
            await self._page.goto(TACTV_URL, wait_until="networkidle", timeout=30000)
            await self._page.wait_for_timeout(1000)

            # Check if we're already logged in (session still valid, redirected to dashboard)
            search_stb = await self._page.query_selector("#search_stb")
            if search_stb and not await self._page.query_selector("#uname"):
                self._logged_in = True
                logger.info("TACTV already logged in (session valid)")
                return True

            # Fill credentials
            try:
                await self._page.fill("#uname", TACTV_USER, timeout=10000)
            except Exception:
                logger.warning("Could not find #uname — page may have loading issues")
                continue
            await self._page.fill("#password", TACTV_PASS)

            # Solve CAPTCHA
            captcha_text = await self._solve_captcha()
            if not captcha_text:
                logger.warning("Empty CAPTCHA, refreshing...")
                # Click refresh captcha
                refresh = await self._page.query_selector('#changeCaptcha, img[src*="refresh"]')
                if refresh:
                    await refresh.click()
                    await self._page.wait_for_timeout(500)
                continue

            await self._page.fill("#txtCaptcha", captcha_text)

            # Click login
            await self._page.click("#proceed")
            await self._page.wait_for_timeout(3000)

            # Check if we logged in (URL change or dashboard elements)
            current_url = self._page.url
            page_title = await self._page.title()

            # Look for error alert or dashboard indicators
            content = await self._page.content()
            if "does not match" in content or "captcha" in content.lower():
                # CAPTCHA failed — the page shows alert and refreshes captcha
                logger.warning(f"CAPTCHA wrong (tried '{captcha_text}')")
                # Refresh captcha for next attempt
                continue

            if "dashboard" in content.lower() or "logout" in content.lower() or \
               "welcome" in content.lower() or "control panel" in page_title.lower():
                self._logged_in = True
                logger.info(f"TACTV login SUCCESS on attempt {attempt}")
                return True

            # Check if we're still on login page
            if "login" in current_url.lower() or "ezybill" in page_title.lower():
                logger.warning(f"Still on login page after attempt {attempt}")
                continue

            # Assume success if URL changed significantly
            if current_url != TACTV_URL:
                self._logged_in = True
                logger.info(f"TACTV login likely SUCCESS (URL: {current_url})")
                return True

        logger.error(f"TACTV login FAILED after {max_retries} attempts")
        return False

    # ─── Session management ─────────────────────────────────────────────

    async def _is_on_login_page(self) -> bool:
        """Check if the current page is the login page (session expired)."""
        try:
            # Login page has these elements that dashboard doesn't
            login_el = await self._page.query_selector("#proceed, #txtCaptcha, #uname")
            return login_el is not None
        except Exception:
            return True

    async def _ensure_logged_in(self) -> bool:
        """Ensure we have a valid logged-in session. Re-login if expired.

        This is the key method that fixes session-expiry bugs: it checks
        whether the current page looks like the login page and, if so,
        performs a fresh login before returning.
        """
        if self._logged_in and self._page and not self._page.is_closed():
            try:
                await self._page.evaluate("1+1")  # quick liveness check
            except Exception:
                self._logged_in = False

        if not self._logged_in:
            logger.info("Session not logged in, attempting login")
            return await self.login(max_retries=5)

        return True

    async def _goto_with_session_check(self, url: str, timeout: int = 30000) -> bool:
        """Navigate to a URL, detecting session expiry and re-logging in.

        Returns True if page is ready, False if login also failed.
        """
        await self._page.goto(url, wait_until="networkidle", timeout=timeout)
        await self._page.wait_for_timeout(500)

        # Detect login-page redirect (session expired)
        if await self._is_on_login_page():
            logger.warning(f"Session expired navigating to {url}, re-logging in")
            self._logged_in = False
            if await self.login(max_retries=3):
                await self._page.goto(url, wait_until="networkidle", timeout=timeout)
                await self._page.wait_for_timeout(500)
                return True
            return False
        return True

    async def _search_stb_on_dashboard(self, stb_no: str) -> dict | None:
        """Search for STB on dashboard and return parsed row data.

        Dashboard search results table columns:
          0: Select  1: STB Status  2: Serial Number  3: VC Number
          4: Activated Date  5: Server  6: Stock Location
          7: Customer ID (17523395(C17523395))  8: Bill Type  9: Name
          10: Group  11: Address  12: Mobile  13: STB Type  14: STB Model

        Returns dict with status, serial, customer_id, name, etc. or None.
        """
        if not await self._goto_with_session_check(
            "https://sms.tactv.in/index.php/welcome/index"
        ):
            return None

        await self._page.wait_for_timeout(1500)

        # Verify #search_stb exists (it won't if session is expired)
        search_input = await self._page.query_selector("#search_stb")
        if not search_input:
            logger.error("#search_stb not found on dashboard — session may be expired")
            # Force re-login
            self._logged_in = False
            if await self.login(max_retries=3):
                await self._page.goto(
                    "https://sms.tactv.in/index.php/welcome/index",
                    wait_until="networkidle", timeout=30000
                )
                await self._page.wait_for_timeout(1500)
                search_input = await self._page.query_selector("#search_stb")
                if not search_input:
                    return None
            else:
                return None

        await self._page.fill("#search_stb", stb_no)
        await self._page.click("#SearchSTB")
        await self._page.wait_for_timeout(4000)

        # Extract data from the results table.
        # Match on Serial Number cell (index 2). Status is index 1, name is index 9.
        search_info = await self._page.evaluate(f"""() => {{
            let tables = document.querySelectorAll('table');
            for (let tbl of tables) {{
                let rows = tbl.querySelectorAll('tr');
                for (let row of rows) {{
                    let cells = row.querySelectorAll('td');
                    if (cells.length >= 10) {{
                        let cellTexts = Array.from(cells).map(c => c.textContent.trim());
                        // Match on Serial Number (index 2)
                        if (cellTexts[2] === '{stb_no}') {{
                            let cid = null;
                            let m = cellTexts[7] ? cellTexts[7].match(/^(\\d+)\\(/) : null;
                            if (m) cid = m[1];
                            return {{
                                status: cellTexts[1] || 'unknown',
                                serial: cellTexts[2],
                                vc_number: cellTexts[3],
                                activated_date: cellTexts[4],
                                customer_id: cid,
                                customer_id_raw: cellTexts[7],
                                name: cellTexts[9] || '',
                                bill_type: cellTexts[8] || '',
                                mobile: cellTexts[12] || '',
                                stb_type: cellTexts[13] || '',
                                stb_model: cellTexts[14] || '',
                            }};
                        }}
                    }}
                }}
            }}
            return null;
        }}""")

        return search_info

    async def get_stb_status(self, stb_no: str) -> dict:
        """Get STB status from TACTV portal via dashboard search."""
        await self._ensure_logged_in()

        try:
            search_info = await self._search_stb_on_dashboard(stb_no)

            if search_info is None:
                return {
                    "stb": stb_no,
                    "tactv_status": "not found",
                    "name": "",
                    "customer_id": None,
                }

            return {
                "stb": stb_no,
                "tactv_status": search_info.get("status", "unknown"),
                "name": search_info.get("name", ""),
                "customer_id": search_info.get("customer_id"),
                "vc_number": search_info.get("vc_number"),
                "activated_date": search_info.get("activated_date"),
                "mobile": search_info.get("mobile"),
                "bill_type": search_info.get("bill_type"),
                "stb_type": search_info.get("stb_type"),
                "stb_model": search_info.get("stb_model"),
            }
        except Exception as e:
            logger.error(f"STB status error: {e}")
            # Reset login state on error so next call retries
            self._logged_in = False
            return {"error": str(e), "stb": stb_no}

    async def disconnect_stb(self, stb_no: str, reason_id: str = "5",
                              remarks: str = "Non payment") -> dict:
        """Deactivate an STB on TACTV portal.

        Flow: search STB on dashboard → results page → check checkbox →
              click DEACTIVATE → select reason → confirm.

        The search redirects to search_cutomer_stb/customer_or_stb which has
        the DASHBOARD table format:
          0:Select(checkbox) 1:STB Status 2:Serial Number 3:VC Number
          4:ActDate 5:Server 6:Stock 7:CustID 8:BillType 9:Name ...

        Args:
            stb_no: STB serial number (e.g. 17268634)
            reason_id: Deactivation reason ID (5=Non Payment, 17=Unpaid Customer)
            remarks: Remarks text

        Returns: {"stb": stb_no, "status": "deactivated"/"already_deactive"/"error", ...}
        """
        await self._ensure_logged_in()

        try:
            page = self._page

            # Step 1: Search for STB using dashboard search (redirects to results page)
            search_info = await self._search_stb_on_dashboard(stb_no)

            if search_info is None:
                return {"stb": stb_no, "status": "not_found"}

            current_status = search_info.get("status", "unknown")

            # Check if already deactive
            if "deactive" in current_status.lower():
                return {"stb": stb_no, "status": "already_deactive",
                        "previous_status": current_status,
                        "name": search_info.get("name", "")}

            # Step 2: Check the checkbox for this STB in the results table.
            # The checkbox has class 'serial_check' and is in the first cell of the row.
            checked = await page.evaluate(f"""() => {{
                let rows = document.querySelectorAll('table tr');
                for (let row of rows) {{
                    let cells = row.querySelectorAll('td');
                    if (cells.length >= 3) {{
                        let serialCell = cells[2] ? cells[2].textContent.trim() : '';
                        if (serialCell === '{stb_no}') {{
                            let cb = cells[0].querySelector('input[type="checkbox"]');
                            if (cb) {{
                                cb.checked = true;
                                cb.dispatchEvent(new Event('change'));
                                cb.dispatchEvent(new Event('click'));
                                return true;
                            }}
                        }}
                    }}
                }}
                return false;
            }}""")

            if not checked:
                return {"stb": stb_no, "status": "error",
                        "error": "Could not select STB checkbox in results table"}

            await page.wait_for_timeout(500)

            # Step 3: Click DEACTIVATE trigger
            await page.click("#deactive")
            await page.wait_for_timeout(2000)

            # Step 4: Select reason + enter remarks in the dialog
            try:
                await page.select_option("#deactivation_reason", reason_id)
            except Exception:
                logger.warning(f"Could not select deactivation_reason {reason_id}")
            try:
                await page.fill("#remark_txt", remarks)
            except Exception:
                logger.warning("Could not fill remark_txt")

            # Step 5: Click Deactivate button in dialog
            await page.evaluate("""() => {
                document.querySelectorAll('.ui-dialog-buttonpane .ui-button').forEach(btn => {
                    if (btn.textContent.trim() === 'Deactivate') btn.click();
                });
            }""")
            await page.wait_for_timeout(1000)

            # Step 6: Handle confirmation dialog — click OK
            await page.evaluate("""() => {
                let okBtns = document.querySelectorAll(
                    '.alertify .ok, .alertify-button-ok, .alertify-buttons button, .ui-dialog-buttonset button'
                );
                okBtns.forEach(btn => {
                    if (btn.textContent.trim() === 'OK' || btn.textContent.trim() === 'ok' ||
                        btn.textContent.trim() === 'Yes' || btn.textContent.trim() === 'Confirm') {
                        btn.click();
                    }
                });
            }""")
            await page.wait_for_timeout(4000)

            # Step 7: Check result message
            alert_msg = await page.evaluate("""() => {
                let msg = document.querySelector('.alertify-message');
                return msg ? msg.textContent.trim() : '';
            }""")

            if alert_msg and "Successfully" in alert_msg:
                logger.info(f"TACTV STB {stb_no} deactivated successfully")
                return {"stb": stb_no, "status": "deactivated", "message": alert_msg}

            # Step 8: Fallback — verify by re-checking status
            verify_info = await self._search_stb_on_dashboard(stb_no)
            new_status = verify_info.get("status", "unknown") if verify_info else "unknown"

            if "deactive" in new_status.lower():
                logger.info(f"TACTV STB {stb_no} deactivated (verified via status)")
                return {"stb": stb_no, "status": "deactivated",
                        "message": alert_msg or "Verified deactive"}

            if alert_msg:
                return {"stb": stb_no, "status": "error", "message": alert_msg}

            return {"stb": stb_no, "status": "unknown", "current_status": new_status}

        except Exception as e:
            logger.error(f"TACTV deactivate error for {stb_no}: {e}")
            # Reset login state on error
            self._logged_in = False
            return {"stb": stb_no, "status": "error", "error": str(e)}

    async def activate_stb(self, stb_no: str) -> dict:
        """Activate/reconnect an STB on TACTV portal via edit_services page.

        Flow: dashboard search → get customer_id → edit_services page →
        expand accordion → check Exclusive Pack → enable fields → submit form.

        Returns:
            {"status": "activated"} — successfully activated
            {"status": "already_active"} — was already active
            {"status": "not_found"} — STB not found on portal
            {"status": "failed"} — submitted but status didn't change
            {"status": "error", "error": "..."} — exception occurred
        """
        await self._ensure_logged_in()

        try:
            page = self._page

            # Step 1: Search STB on dashboard to get customer_id and status
            search_info = await self._search_stb_on_dashboard(stb_no)

            if search_info is None:
                return {"stb": stb_no, "status": "not_found"}

            stb_status = search_info.get("status", "unknown")
            customer_id = search_info.get("customer_id")

            # Check if already active
            if "active" in stb_status.lower() and "deactive" not in stb_status.lower():
                return {"stb": stb_no, "status": "already_active",
                        "tactv_status": stb_status,
                        "name": search_info.get("name", "")}

            if not customer_id:
                return {"stb": stb_no, "status": "error",
                        "error": "Could not find customer_id",
                        "tactv_status": stb_status}

            logger.info(f"TACTV activate: STB {stb_no}, customer_id={customer_id}, current={stb_status}")

            # Step 2: Navigate to edit_services page
            await self._goto_with_session_check(
                f"https://sms.tactv.in/index.php/customer/edit_services/{customer_id}"
            )
            await page.wait_for_timeout(2000)

            # Step 3: Expand the accordion for this STB
            await page.evaluate(f"""() => {{
                document.querySelectorAll('.accordion').forEach(h => {{
                    if (h.textContent.includes('{stb_no}')) h.click();
                }});
            }}""")
            await page.wait_for_timeout(1500)

            # Step 4: Find and check the Exclusive Pack (base package) checkbox
            # The first checkbox (serial_number_2) is typically the base pack
            checkbox_info = await page.evaluate(f"""() => {{
                let container = document.querySelector('.multiple_boxes_container_{stb_no}');
                if (!container) return {{found: false}};
                let checkboxes = container.querySelectorAll('input.serial[type="checkbox"]');
                if (checkboxes.length === 0) return {{found: false}};
                // Check the first checkbox (base pack / Exclusive Pack)
                let cb = checkboxes[0];
                cb.checked = true;
                $(cb).trigger('change');
                return {{
                    found: true,
                    id: cb.id,
                    value: cb.value,
                    total_checkboxes: checkboxes.length
                }};
            }}""")

            if not checkbox_info.get("found"):
                return {"stb": stb_no, "status": "error",
                        "error": "No service checkboxes found in accordion"}
            await page.wait_for_timeout(500)

            cb_id = checkbox_info["id"]
            cb_num = cb_id.replace("serial_number_", "")

            # Step 5: Forcefully remove disabled from ALL form fields
            # (fields stay disabled until properly enabled by portal JS which doesn't always work)
            await page.evaluate("""() => {
                $('input.products, input.sd, input.ed, input.qty, input.serial, input.packagetypes').each(function() {
                    $(this).removeAttr('disabled');
                });
            }""")

            # Step 6: Set hidden fields for activation reason and remarks
            end_date = await page.evaluate(f"""() => {{
                let ed = document.getElementById('datepicker_to_{cb_num}');
                return ed ? ed.value : '';
            }}""")

            await page.evaluate(f"""() => {{
                // Set act_reason_id (Payment Made = typically value 3)
                let ri = document.getElementById('act_reason_id');
                if (!ri) {{
                    ri = document.createElement('input');
                    ri.type = 'hidden';
                    ri.id = 'act_reason_id';
                    ri.name = 'act_reason_id';
                    document.getElementById('customer_services').appendChild(ri);
                }}
                ri.value = '3';

                // Set act_remarks
                let rm = document.getElementById('act_remarks');
                if (!rm) {{
                    rm = document.createElement('input');
                    rm.type = 'hidden';
                    rm.id = 'act_remarks';
                    rm.name = 'act_remarks';
                    document.getElementById('customer_services').appendChild(rm);
                }}
                rm.value = 'Payment received via Cable TV app';

                // Set end_dates
                let ed = document.getElementById('end_dates');
                if (ed) ed.value = '{end_date}';
            }}""")

            # Step 7: Submit the form
            await page.evaluate("document.getElementById('customer_services').submit()")
            await page.wait_for_timeout(5000)

            # Step 8: Verify activation via dashboard search
            search_info2 = await self._search_stb_on_dashboard(stb_no)
            new_status = search_info2.get("status", "not found") if search_info2 else "not found"

            if "active" in new_status.lower() and "deactive" not in new_status.lower():
                logger.info(f"TACTV activate SUCCESS: STB {stb_no} now Active")
                return {"stb": stb_no, "status": "activated", "previous": stb_status,
                        "tactv_status": new_status,
                        "name": search_info2.get("name", "") if search_info2 else ""}
            else:
                logger.warning(f"TACTV activate UNCLEAR: STB {stb_no} still {new_status}")
                return {"stb": stb_no, "status": "failed",
                        "previous": stb_status, "current": new_status}

        except Exception as e:
            logger.error(f"TACTV activate error for {stb_no}: {e}")
            self._logged_in = False
            return {"stb": stb_no, "status": "error", "error": str(e)}

    async def close(self):
        """Clean up browser resources."""
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None
        self._logged_in = False
