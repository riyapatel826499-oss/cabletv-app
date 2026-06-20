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

            # Fill credentials
            await self._page.fill("#uname", TACTV_USER)
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

    async def get_stb_status(self, stb_no: str) -> dict:
        """Get STB status from TACTV portal via dashboard search."""
        if not self._logged_in:
            logged_in = await self.login()
            if not logged_in:
                return {"error": "Login failed", "stb": stb_no}

        try:
            # Search on dashboard (same as activate_stb step 1)
            await self._page.goto(
                "https://sms.tactv.in/index.php/welcome/index",
                wait_until="networkidle", timeout=30000
            )
            await self._page.wait_for_timeout(1500)
            await self._page.fill("#search_stb", stb_no)
            await self._page.click("#SearchSTB")
            await self._page.wait_for_timeout(4000)

            # Extract status from search results
            search_info = await self._page.evaluate(f"""() => {{
                let cells = document.querySelectorAll('table tr td');
                let result = {{status: 'not found', customer_id: null, name: null}};
                for (let i = 0; i < cells.length; i++) {{
                    if (cells[i].textContent.trim() === '{stb_no}') {{
                        result.status = cells[i-1] ? cells[i-1].textContent.trim() : 'unknown';
                        // Try to get customer name (usually a few cells before status)
                        for (let j = Math.max(0, i-5); j < i; j++) {{
                            let t = cells[j].textContent.trim();
                            if (t && !/^\d+$/.test(t) && t.length > 3) {{
                                result.name = t;
                                break;
                            }}
                        }}
                        // customer_id
                        for (let j = i; j < Math.min(i + 10, cells.length); j++) {{
                            let text = cells[j].textContent.trim();
                            let m = text.match(/^(\\d+)\\(/);
                            if (m) {{ result.customer_id = m[1]; break; }}
                        }}
                    }}
                }}
                return result;
            }}""")

            return {
                "stb": stb_no,
                "tactv_status": search_info.get("status", "not found"),
                "name": search_info.get("name", ""),
                "customer_id": search_info.get("customer_id"),
            }
        except Exception as e:
            logger.error(f"STB status error: {e}")
            return {"error": str(e), "stb": stb_no}

    async def disconnect_stb(self, stb_no: str, reason_id: str = "5",
                              remarks: str = "Non payment") -> dict:
        """Deactivate an STB on TACTV portal.
        
        Args:
            stb_no: STB serial number (e.g. 17268634)
            reason_id: Deactivation reason ID (5=Non Payment, 17=Unpaid Customer)
            remarks: Remarks text
            
        Returns: {"stb": stb_no, "status": "deactivated"/"already_deactive"/"error", ...}
        """
        if not self._logged_in:
            logged_in = await self.login()
            if not logged_in:
                return {"error": "Login failed", "stb": stb_no}

        try:
            # Navigate to STB Management
            await self._page.goto(
                "https://sms.tactv.in/index.php/das/stb_management",
                wait_until="networkidle", timeout=30000
            )
            await self._page.wait_for_timeout(1500)

            # Search for the STB
            await self._page.fill("#search_stb", stb_no)
            await self._page.click("#SearchSTB")
            await self._page.wait_for_timeout(3000)

            # Check if STB found in results
            page_text = await self._page.content()
            if stb_no not in page_text:
                return {"stb": stb_no, "status": "not_found"}

            # Check if already deactive
            rows = await self._page.query_selector_all("table tr")
            current_status = None
            for row in rows:
                row_text = await row.inner_text()
                if stb_no in row_text:
                    cells = await row.query_selector_all("td")
                    if len(cells) >= 2:
                        current_status = (await cells[1].inner_text()).strip()
                    break

            if current_status and "deactive" in current_status.lower():
                return {"stb": stb_no, "status": "already_deactive",
                        "previous_status": current_status}

            # Select checkbox
            checkbox = await self._page.query_selector("#serial_check\\[\\]")
            if not checkbox:
                return {"stb": stb_no, "status": "error",
                        "error": "Checkbox not found"}
            await checkbox.check()

            # Click DEACTIVATE trigger
            await self._page.click("#deactive")
            await self._page.wait_for_timeout(2000)

            # Select reason + enter remarks
            await self._page.select_option("#deactivation_reason", reason_id)
            await self._page.fill("#remark_txt", remarks)

            # Click Deactivate button in dialog
            await self._page.evaluate("""() => {
                document.querySelectorAll('.ui-dialog-buttonpane .ui-button').forEach(btn => {
                    if (btn.textContent.trim() === 'Deactivate') btn.click();
                });
            }""")
            await self._page.wait_for_timeout(1000)

            # Handle confirmation dialog — click OK
            await self._page.evaluate("""() => {
                let okBtns = document.querySelectorAll('.alertify .ok, .alertify-button-ok, .alertify-buttons button');
                okBtns.forEach(btn => {
                    if (btn.textContent.trim() === 'OK' || btn.textContent.trim() === 'ok') {
                        btn.click();
                    }
                });
            }""")
            await self._page.wait_for_timeout(4000)

            # Check result message
            alert_msg = await self._page.evaluate("""() => {
                let msg = document.querySelector('.alertify-message');
                return msg ? msg.textContent.trim() : '';
            }""")

            if "Deactivated Successfully" in alert_msg or "Successfully" in alert_msg:
                logger.info(f"TACTV STB {stb_no} deactivated successfully")
                return {"stb": stb_no, "status": "deactivated", "message": alert_msg}

            if alert_msg:
                return {"stb": stb_no, "status": "error", "message": alert_msg}

            # Fallback: verify by checking status in table
            stb_status = await self._page.evaluate(f"""() => {{
                let cells = document.querySelectorAll('table tr td');
                for (let i = 0; i < cells.length; i++) {{
                    if (cells[i].textContent.trim() === '{stb_no}') {{
                        return cells[i-1] ? cells[i-1].textContent.trim() : 'unknown';
                    }}
                }}
                return 'not found';
            }}""")

            if "deactive" in stb_status.lower():
                return {"stb": stb_no, "status": "deactivated"}
            return {"stb": stb_no, "status": "unknown", "current_status": stb_status}

        except Exception as e:
            logger.error(f"TACTV deactivate error for {stb_no}: {e}")
            # Reset login state on error
            self._logged_in = False
            return {"stb": stb_no, "status": "error", "error": str(e)}

    async def activate_stb(self, stb_no: str) -> dict:
        """Activate/reconnect an STB on TACTV portal via edit_services page.

        Flow: dashboard search → get customer_id → edit_services page →
        expand accordion → check Exclusive Pack → enable fields → submit form.
        """
        if not self._logged_in:
            logged_in = await self.login()
            if not logged_in:
                return {"error": "Login failed", "stb": stb_no}

        try:
            page = self._page

            # Step 1: Search STB on dashboard to get customer_id and status
            await page.goto(
                "https://sms.tactv.in/index.php/welcome/index",
                wait_until="networkidle", timeout=30000
            )
            await page.wait_for_timeout(1500)
            await page.fill("#search_stb", stb_no)
            await page.click("#SearchSTB")
            await page.wait_for_timeout(4000)

            # Get customer_id and status from search results
            search_info = await page.evaluate(f"""() => {{
                let cells = document.querySelectorAll('table tr td');
                let result = {{status: 'not found', customer_id: null}};
                for (let i = 0; i < cells.length; i++) {{
                    if (cells[i].textContent.trim() === '{stb_no}') {{
                        result.status = cells[i-1] ? cells[i-1].textContent.trim() : 'unknown';
                        // customer_id is in format like "17523640(C17523640)"
                        for (let j = i; j < Math.min(i + 10, cells.length); j++) {{
                            let text = cells[j].textContent.trim();
                            let m = text.match(/^(\\d+)\\(/);
                            if (m) {{ result.customer_id = m[1]; break; }}
                        }}
                    }}
                }}
                return result;
            }}""")

            stb_status = search_info.get("status", "not found")
            customer_id = search_info.get("customer_id")

            if stb_status == "not found":
                return {"stb": stb_no, "status": "not_found"}
            if "active" in stb_status.lower() and "deactive" not in stb_status.lower():
                return {"stb": stb_no, "status": "already_active"}
            if not customer_id:
                return {"stb": stb_no, "status": "error", "error": "Could not find customer_id"}

            logger.info(f"TACTV activate: STB {stb_no}, customer_id={customer_id}, current={stb_status}")

            # Step 2: Navigate to edit_services page
            await page.goto(
                f"https://sms.tactv.in/index.php/customer/edit_services/{customer_id}",
                wait_until="networkidle", timeout=30000
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
            await page.goto(
                "https://sms.tactv.in/index.php/welcome/index",
                wait_until="networkidle", timeout=30000
            )
            await page.wait_for_timeout(1500)
            await page.fill("#search_stb", stb_no)
            await page.click("#SearchSTB")
            await page.wait_for_timeout(4000)

            new_status = await page.evaluate(f"""() => {{
                let cells = document.querySelectorAll('table tr td');
                for (let i = 0; i < cells.length; i++) {{
                    if (cells[i].textContent.trim() === '{stb_no}') {{
                        return cells[i-1] ? cells[i-1].textContent.trim() : 'unknown';
                    }}
                }}
                return 'not found';
            }}""")

            if "active" in new_status.lower() and "deactive" not in new_status.lower():
                logger.info(f"TACTV activate SUCCESS: STB {stb_no} now Active")
                return {"stb": stb_no, "status": "activated", "previous": stb_status}
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
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None
        self._logged_in = False
