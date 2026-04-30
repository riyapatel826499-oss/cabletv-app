# Cable TV App — Full Audit Report
**Date:** 30 Apr 2026 | **Scope:** Backend (14 files) + Frontend (2 files)

---

## Summary

| Severity | Count | What it means |
|----------|-------|---------------|
| 🔴 CRITICAL | 5 | Will crash, data loss, or security breach |
| 🟠 HIGH | 9 | Broken features, security gaps, data integrity |
| 🟡 MEDIUM | 13 | Bugs, logic errors, missing handling |
| 🟢 LOW | 18 | Code quality, accessibility, maintainability |

---

## 🔴 CRITICAL — Fix First

### C1. XSS: `stb_no` not escaped in Unpaid & Not-Renewed tables
**File:** `dashboard.html` lines 2805, 2898
```js
'<td>' + (c.stb_no||'-') + '</td>'  // ← NO esc()
```
**Fix:** `'<td>' + esc(c.stb_no || '-') + '</td>'`

### C2. XSS: `esc()` bypass via onclick handlers
**File:** `dashboard.html` — 15+ locations
`esc()` converts `'` to `&#39;`, but browsers HTML-decode attribute values BEFORE JS runs.
So `onclick="deleteCustomer('&#39;);alert(1);//')"` becomes executable JS.
**Fix:** Use `data-*` attributes + `event delegation` instead of inline onclick with user data.

### C3. Unescaped `customer_id` in payment search onclick
**File:** `dashboard.html` line 1729
```js
'onclick="selectPayCustomer(\'' + c.customer_id + '\')"'
```
No `esc()` at all — direct XSS vector.
**Fix:** Use `data-cid` attribute + event delegation.

### C4. Auth bypass on `/customers/unpaid` and `/customers/not-renewed`
**File:** `customers.py` lines 342-351, 449
```python
current_user: Optional[dict] = None,  # NO Depends()!
```
No authentication required — anyone can access customer data.
**Fix:** Add `current_user: dict = Depends(get_current_user)`

### C5. STB exchange crashes on NOT NULL constraint
**File:** `stb_inventory.py` line 120
```python
conn.execute("UPDATE connections SET stb_no = NULL WHERE stb_no = ?", ...)
```
`stb_no` has `NOT NULL UNIQUE` constraint. Setting to NULL crashes.
**Fix:** Set to a unique placeholder like `'SURRENDERED-{id}'` or remove NOT NULL.

---

## 🟠 HIGH — Fix Soon

### H1. Payment deletion has no role check
**File:** `payments.py` line 328 — Any authenticated user can delete any payment.
**Fix:** Add `current_user: dict = Depends(require_role("admin"))`

### H2. Hardcoded fallback secret key
**File:** `config.py` line 11 — `"dev-only-secret-key-CHANGE-IN-PROD"`
If env vars missing, all JWTs are forgeable.
**Fix:** Raise error on startup if no secret configured.

### H3. `/api/me` failure defaults to admin role
**File:** `dashboard.html` lines 2620-2642
If API fails, admin nav items stay visible. Client-only RBAC.
**Fix:** On `/api/me` failure, redirect to login immediately.

### H4. `initPaymentForm` loads ALL customers into memory
**File:** `dashboard.html` lines 1677-1688
`while(true)` loop pages through all customers. No limit, no loading indicator.
**Fix:** Add safety limit (max 5000), show loading state.

### H5. `fmtDateTime` defined twice
**File:** `dashboard.html` lines 636 vs 2314-2318
First is dead code (overridden by second). Second adds `'Z'` suffix.
**Fix:** Remove first definition.

### H6. Connection leak in reports.py
**File:** `reports.py` line 4 — imports `get_db` from `models.database` (raw connection).
Context manager doesn't close connections — leaks on every report request.
**Fix:** Change to `from deps import get_db`.

### H7. `get_total_paid_amount` only counts Paypakka payments
**File:** `services/payments.py` lines 137-147
Ignores local `payments` table — understates total paid.
**Fix:** Add UNION ALL with local payments.

### H8. Race condition on rapid page switching
**File:** `dashboard.html` — No request cancellation in `showPage()`.
Stale API responses overwrite current page.
**Fix:** Add AbortController or page-tracking guard.

### H9. Change Password is a no-op stub
**File:** `dashboard.html` lines 2505-2511
Form validates but shows "coming soon" — users may think password changed.
**Fix:** Either implement or disable the form with a clear message.

---

## 🟡 MEDIUM — Fix When Possible

### M1. Undefined CSS variables
`--bg-card`, `--card`, `--bg-secondary`, `--error` used but never defined.

### M2. Silent empty catch blocks
Lines 1327, 1704, 1847, 1957, 2078 — errors swallowed silently.

### M3. Fragile plan data extraction from DOM
`selectPlan()` uses CSS selectors like `div[style*="font-weight:600"]`.

### M4. Sort column SQL via f-string
`customers.py` line 232 — `f"ORDER BY c.{sort_by}"` even with regex validation.

### M5. Triple DB query for paid filters
`customers.py` lines 254-321 — 3x query load when filters active.

### M6. Geolocation failure silent
No feedback when location permission denied.

### M7. Variable shadowing in `editEmployee` and `doLogout`
`catch(e)` shadows parameter `e`. `const token` shadows global.

### M8. Dynamic modals not cleaned up
Created modals persist in DOM after navigation.

### M9. Payment duplicate check race window
Client-side-only check, server has no unique constraint.

### M10. Area dropdowns only populate once
`options.length <= 1` check prevents refresh on revisit.

### M11. `loadReports()` unbounded payment load
No pagination — could timeout on large datasets.

### M12. Seed data role mismatch
Seed user has `role='agent'` but valid roles don't include it.

### M13. `validity_days` hardcoded to 30
`savePlan` ignores any UI field for validity.

---

## 🟢 LOW — Nice to Have

- L1: No git version control
- L2: Single 3000-line dashboard.html monolith
- L3: No tests for most endpoints
- L4: Hardcoded idle timeout (15 min)
- L5: Hardcoded date range (`2024-01-01` to `2030-12-31`)
- L6: Accessibility: no ARIA labels, no focus trapping, no skip-nav
- L7: PWA files may not exist (sw.js, manifest.json)
- L8: Token not refreshed from localStorage on change
- L9: Mobile double-load (dashboard + payments)
- L10: Hardcoded MSO colors in two places
- L11: Deprecated `regex=` in FastAPI Query params
- L12: Deprecated `.dict()` in Pydantic models
- L13: PRAGMA calls on every DB connection
- L14: Redundant imports inside functions
- L15: Legacy SHA256 password fallback
- L16: `import json as _json` inconsistency
- L17: Sentinel value `-1` for connection_id
- L18: Dynamic SQL column names without allowlist

---

## Fix Order (Recommended)

**Phase 1 — Security (do immediately):**
1. Fix XSS: Add `esc()` to stb_no (C1)
2. Fix auth: Add Depends to unpaid/not-renewed (C4)
3. Fix onclick XSS: Switch to data-attributes (C2, C3)
4. Add role check to payment delete (H1)
5. Fix `/api/me` failure handling (H3)

**Phase 2 — Stability (do next):**
6. Fix STB NOT NULL crash (C5)
7. Fix reports.py connection leak (H6)
8. Fix seed role mismatch (M12)
9. Remove dead fmtDateTime (H5)

**Phase 3 — Data Integrity:**
10. Fix total paid amount calculation (H7)
11. Add server-side payment unique constraint (M9)
12. Define missing CSS variables (M1)

**Phase 4 — Quality:**
13. Add loading states and error handling
14. Add request cancellation for page switching
15. Fix silent catch blocks
16. Refactor plan data extraction
