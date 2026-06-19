# Sidebar Redesign Plan — Wasool Cable TV App

> **Status:** Analysis & plan only — **no implementation performed.**
> **Scope:** Frontend React sidebar (`Layout.tsx`) restructuring + role-permission fixes.
> **Author:** Generated from grounded source analysis of `Layout.tsx`, `App.tsx`, `index.css`, `useAuth.tsx`, `migrate_multi_tenant.py`, and `test_authz.py`.

---

## 1. Executive Summary

The sidebar currently renders **19 flat menu items** with no hierarchy, which is overwhelming on mobile (the primary device). This plan proposes collapsing them into **6 collapsible groups + 1 standalone item (Dashboard)**, auto-expanding the group that contains the active route.

It also diagnoses and prescribes a fix for the **invisible Employee menu bug**: `Employees`, `Audit Log`, and `Operators` are gated to `['master']` only in both `Layout.tsx` (`ROUTE_PERMISSIONS`) and `App.tsx` (`ROUTE_ROLES`). The production admin account **`ssncables`** has role `admin` (the migration script sets only user `id=1` to `master`), so these three items never render for the admin. Critically, **the backend already permits `admin` to read the audit log** (proven by `test_authz.py`), so the frontend restriction is a confirmed mismatch, not a security boundary.

---

## 2. Current State Analysis

### 2.1 Source of truth (file & line locations)

| Concern | File | Lines | Notes |
|---|---|---|---|
| Role permissions (nav visibility) | `frontend-react/src/components/Layout.tsx` | **47–71** | `ROUTE_PERMISSIONS` record |
| Flat nav items | `frontend-react/src/components/Layout.tsx` | **73–93** | `navItems` array (19 entries) |
| Role filter helper | `frontend-react/src/components/Layout.tsx` | **95–112** | `getAllowedRoutes()` |
| Nav render loop | `frontend-react/src/components/Layout.tsx` | **333–373** | `visibleNavItems.map(...)` → `<NavLink>` |
| Route role guard (render gate) | `frontend-react/src/App.tsx` | **60–83** | `ROUTE_ROLES` record |
| Route guard component | `frontend-react/src/App.tsx` | **85–96** | `RoleRoute()` |
| Sidebar CSS (`.glass-sidebar`) | `frontend-react/src/index.css` | **94–99** | glass background + blur |
| Design tokens (`--sidebar-width: 260px`, `--radius-sm`, `--transition`) | `frontend-react/src/index.css` | **5–32** | `:root` |
| Auth context (`user.role`) | `frontend-react/src/hooks/useAuth.tsx` | **20–25** | role comes from backend login response, stored in `localStorage` |
| Role seeding (who is `master`) | `backend/migrate_multi_tenant.py` | **84** | `UPDATE users SET role='master' WHERE id = 1` |
| Backend authz proof | `backend/tests/test_authz.py` | **156–162** | `admin` CAN read `/api/reports/audit-log` (200) |

### 2.2 Current 19 flat items (and their roles)

| # | Label | Route | Allowed roles |
|---|---|---|---|
| 1 | Dashboard | `/` | all incl. `collection_point` |
| 2 | Customers | `/customers` | ALL_ROLES |
| 3 | Add Customer | `/add-customer` | master, admin |
| 4 | Unpaid | `/unpaid` | ALL_ROLES |
| 5 | Not Renewed | `/not-renewed` | ALL_ROLES |
| 6 | Record Payment | `/payments/new` | all incl. `collection_point` |
| 7 | My Collections | `/my-collections` | all incl. `collection_point` |
| 8 | Payments | `/payments` | master, admin |
| 9 | Plans | `/plans` | master, admin |
| 10 | Reports | `/reports` | all incl. `collection_point` |
| 11 | Reminders | `/reminders` | master, admin |
| 12 | Connections | `/connections` | master, admin |
| 13 | Service Requests | `/service-requests` | all incl. `collection_point` |
| 14 | Surrenders | `/surrender` | master, admin |
| 15 | Inventory | `/inventory` | master, admin, support |
| 16 | Audit Log | `/audit` | **master ONLY** ⚠️ |
| 17 | Settings | `/settings` | master, admin |
| 18 | Employees | `/employees` | **master ONLY** ⚠️ ← reported bug |
| 19 | Operators | `/operators` | **master ONLY** ⚠️ |

### 2.3 Code smell noted

Permission truth is **duplicated** across `Layout.tsx` (`ROUTE_PERMISSIONS`) and `App.tsx` (`ROUTE_ROLES`). They must be edited in lockstep or they drift (this is exactly how the bug went unnoticed). The plan recommends consolidating to a single shared module as a follow-up.

---

## 3. Proposed Grouped Sidebar Structure

### 3.1 Design principles

1. **Reduce 19 flat rows → 7 visual blocks** (1 standalone + 6 groups) so the eye can scan by domain.
2. **Collapse by default; auto-expand the group containing the active route** so the user always sees their current context.
3. **Hide empty groups**: a group only renders if it has ≥1 item the user is allowed to see. This keeps `collection_point` users on a minimal sidebar.
4. **Preserve existing `NavLink` active-state styling** and role filtering (`getAllowedRoutes`) — groups are an organizational layer on top, not a replacement.
5. **Mobile-first**: collapsed groups minimize scroll on phones; the active group opens automatically.

### 3.2 Proposed tree

```
■ Dashboard                         /              (standalone, always first)

▼ Customers
    Customers                       /customers
    Add Customer                    /add-customer
    Unpaid                          /unpaid
    Not Renewed                     /not-renewed

▼ Payments
    Record Payment                  /payments/new
    My Collections                  /my-collections
    Payments                        /payments

▼ Operations
    Reminders                       /reminders
    Connections                     /connections
    Service Requests                /service-requests
    Surrenders                      /surrender

▼ Plans & Inventory
    Plans                           /plans
    Inventory                       /inventory

▼ Reports
    Reports                         /reports

▼ Administration
    Settings                        /settings
    Employees                       /employees       (after role fix)
    Operators                       /operators       (decision — see §4.3)
    Audit Log                       /audit           (after role fix)
```

### 3.3 Per-role visibility matrix (after proposed role fixes)

| Group / Item | `collection_point` | `agent` / `collection_agent` | `support` | `admin` | `master` |
|---|:--:|:--:|:--:|:--:|:--:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Customers** | — | Customers, Unpaid, Not Renewed | Customers, Unpaid, Not Renewed | + Add Customer | all 4 |
| **Payments** | Record Payment, My Collections | Record Payment, My Collections | Record Payment, My Collections | + Payments | all 3 |
| **Operations** | Service Requests | Service Requests | Service Requests | + Reminders, Connections, Surrenders | all 4 |
| **Plans & Inventory** | — | — | Inventory | Plans, Inventory | both |
| **Reports** | Reports | Reports | Reports | Reports | Reports |
| **Administration** | — | — | — | Settings, Employees, Audit (+Operators?) | all 4 |

**Net effect**: the `admin` user (`ssncables`) goes from **14 flat rows → 7 blocks** and now correctly sees Employees + Audit Log.

> **Alternative (optional):** `Reports` is a single-item group. If a single-item section looks sparse, it can instead be rendered as a **standalone top-level link** alongside Dashboard (no collapse chevron). The recommended default keeps it as its own group for visual consistency, since Reports is a high-value destination.

---

## 4. Bug Diagnosis — Employee menu invisible to admin

### 4.1 Symptom
The logged-in production admin user (`ssncables`) never sees **Employees** in the sidebar, and navigating to `/app/employees` would redirect home.

### 4.2 Root cause (confirmed in source)

The menu is rendered by `visibleNavItems = navItems.filter(item => allowedRoutes.has(item.to))` (`Layout.tsx:189`). `allowedRoutes` is built from `ROUTE_PERMISSIONS` (`Layout.tsx:47-71`), where:

```ts
// Layout.tsx line 69
'/employees':           ['master'],
```

So only a user whose `user.role === 'master'` passes the filter. Two independent gates compound this:

| Gate | File:Line | Current value |
|---|---|---|
| Nav visibility filter | `Layout.tsx:69` | `'/employees': ['master']` |
| Route render guard | `App.tsx:81` | `'/employees': ['master']` |

### 4.3 Why `ssncables` is `admin`, not `master`

- `CLAUDE.md` states: *"Admin username on production: `ssncables`"* — i.e. `ssncables` is the **operator-admin** account, not the super-admin.
- `backend/migrate_multi_tenant.py:84` sets **only** `id=1` to `master`:
  ```python
  conn.execute("UPDATE users SET operator_id = NULL, role = 'master' WHERE id = 1")
  ```
  `id=1` is **Prabhu** (the `master`/super-admin). Unless `ssncables` was manually promoted, it retains whatever role it was created with (`admin`).
- `useAuth.tsx` confirms `user.role` is taken verbatim from the backend login response (`res.user`) — there is no client-side promotion. So a DB role of `admin` ⇒ frontend role of `admin` ⇒ Employees filtered out.

### 4.4 The same bug affects Audit Log & Operators

`ROUTE_PERMISSIONS` / `ROUTE_ROLES` gate **three** routes to `['master']` only:

| Route | Layout.tsx line | App.tsx line |
|---|---|---|
| `/audit` | 68 | 80 |
| `/employees` | 69 | 81 |
| `/operators` | 70 | 82 |

**Critical evidence that this is a genuine bug for `/audit`:** the backend *already* authorizes `admin` to read the audit log — `backend/tests/test_authz.py:160-162` asserts a 200 for an `admin` token:
```python
def test_admin_can_read_audit_log(self, client, seeded):
    r = client.get("/api/reports/audit-log", headers=_hdr(U_ADMIN_A, "admin", OP_A))
    assert r.status_code == 200
```
So the backend permits it; only the frontend menu hides it. This is a frontend/backend inconsistency, not a security decision.

### 4.5 Recommended permission changes

| Route | Current | **Recommended** | Rationale |
|---|---|---|---|
| `/employees` | `['master']` | **`['master', 'admin']`** | An LCO admin must manage their own staff. Backend endpoints for employee CRUD must also allow `admin` (verify — see §6.2). |
| `/audit` | `['master']` | **`['master', 'admin']`** | Backend already permits admin (`test_authz.py`). Frontend is the only thing blocking it. |
| `/operators` | `['master']` | **`['master']`** *(keep as-is)* — **decision point** | Operators = multi-tenant business management (cross-LCO), which is a super-admin concern. **Keep `master`-only** unless the page is meant to be a read-only *own-operator profile* editor, in which case promote to `['master', 'admin']`. Flag for product confirmation before changing. |

> **Security note:** Truly destructive endpoints (`/api/nuke-data`, `/api/admin/sql`, `/api/admin/bulk-payments`, `/api/backup`, etc.) remain **`master`-only at the backend** via token-claim gating (`test_authz.py:110-130`) and are **not** affected by this sidebar change. The sidebar changes only navigation visibility, not backend authorization.

---

## 5. Implementation Plan

Implement in **3 phases** (role fix → nav restructure → CSS), each independently testable. Phase 1 is the smallest, highest-value change and can ship alone.

### Phase 1 — Role-permission fixes (the Employee/Audit bug)
**Goal:** make Employees & Audit Log visible/usable to the `admin` role.

1. **`frontend-react/src/App.tsx`** — `ROUTE_ROLES` (lines 60–83):
   - Line 80: `'/audit':      ['master'],` → `'/audit':      ['master', 'admin'],`
   - Line 81: `'/employees':  ['master'],` → `'/employees':  ['master', 'admin'],`
   - (Leave line 82 `/operators` unchanged pending the §4.5 decision.)
2. **`frontend-react/src/components/Layout.tsx`** — `ROUTE_PERMISSIONS` (lines 47–71):
   - Line 68: `'/audit':      ['master'],` → `'/audit':      ['master', 'admin'],`
   - Line 69: `'/employees':  ['master'],` → `'/employees':  ['master', 'admin'],`
3. **Verify backend authorization** for any `/api/employees*` endpoints actually permits `admin` (not just `master`). The Audit endpoint is already confirmed OK (`test_authz.py`). If employee endpoints are `master`-only server-side, update them too — otherwise the admin will see the menu but get 403s. (See §6.2.)
4. **Smoke test:** log in as `admin`/`ssncables` → confirm Employees & Audit Log appear in sidebar and the pages load (no 403).

> ✅ This phase alone resolves the reported "Employee menu invisible" bug and can be deployed independently.

### Phase 2 — Nav restructuring into collapsible groups
**Goal:** replace the flat `navItems` + flat `.map()` with grouped, collapsible sections.

**Files to modify:** `frontend-react/src/components/Layout.tsx` only.

1. **Replace** the flat `navItems` array (lines 73–93) with a **grouped structure**. Proposed shape (keep existing `icon`/`to`/`label` values, just nest them):
   ```ts
   // Top-level standalone items (no collapse chevron)
   const standaloneNav: NavItem[] = [
     { to: '/', label: 'Dashboard', icon: LayoutDashboard },
   ];

   // Collapsible groups
   const navGroups: NavGroup[] = [
     {
       id: 'customers',
       label: 'Customers',
       icon: Users,
       items: [
         { to: '/customers',   label: 'Customers',    icon: Users },
         { to: '/add-customer',label: 'Add Customer', icon: UserPlus },
         { to: '/unpaid',      label: 'Unpaid',       icon: AlertCircle },
         { to: '/not-renewed', label: 'Not Renewed',  icon: UserX },
       ],
     },
     {
       id: 'payments',
       label: 'Payments',
       icon: CreditCard,
       items: [
         { to: '/payments/new',   label: 'Record Payment', icon: CreditCard },
         { to: '/my-collections', label: 'My Collections', icon: Wallet },
         { to: '/payments',       label: 'Payments',       icon: IndianRupee },
       ],
     },
     {
       id: 'operations',
       label: 'Operations',
       icon: Wrench,
       items: [
         { to: '/reminders',        label: 'Reminders',       icon: Bell },
         { to: '/connections',      label: 'Connections',     icon: Wifi },
         { to: '/service-requests', label: 'Service Requests',icon: Wrench },
         { to: '/surrender',        label: 'Surrenders',      icon: PowerOff },
       ],
     },
     {
       id: 'catalog',
       label: 'Plans & Inventory',
       icon: Package,
       items: [
         { to: '/plans',     label: 'Plans',     icon: Tv },
         { to: '/inventory', label: 'Inventory', icon: Package },
       ],
     },
     {
       id: 'reports',
       label: 'Reports',
       icon: FileBarChart,
       items: [
         { to: '/reports', label: 'Reports', icon: FileBarChart },
       ],
     },
     {
       id: 'admin',
       label: 'Administration',
       icon: Settings,
       items: [
         { to: '/settings',  label: 'Settings',  icon: Settings },
         { to: '/employees', label: 'Employees', icon: UserCog },
         { to: '/operators', label: 'Operators', icon: Building2 },
         { to: '/audit',     label: 'Audit Log', icon: ScrollText },
       ],
     },
   ];
   ```
2. **Add group state + active-group detection** (near existing `allowedRoutes`, ~line 188):
   - `const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());`
   - Compute `activeGroupId` via `useMemo` over `location.pathname`: a group is "active" if any child `to` matches the current path (use the same match logic `NavLink` uses, i.e. `to === '/' ? exact : pathname === to || pathname.startsWith(to + '/')`).
   - **Auto-expand rule:** merge `activeGroupId` into the expanded set on every render so the current section is always open; allow manual toggling of others. (A `useEffect` on `location.pathname` can seed the initial open state; subsequent toggles are user-driven.)
3. **Filter items per role inside each group** using the existing `allowedRoutes` set. A group is rendered **only if it has ≥1 visible child** (skip the section header entirely if empty — critical for `collection_point` minimalism).
4. **Rewrite the nav render loop** (`Layout.tsx:333–373`):
   - Render `standaloneNav` first (unchanged `<NavLink>` markup).
   - For each non-empty group, render a **section header button** (group icon + label + chevron `▼/▶`) that toggles membership in `expandedGroups`.
   - When expanded, render the group's visible children as the **same `<NavLink>`** markup currently used (reuse the exact `style`/`onMouseEnter`/`onMouseLeave` block from lines 339–368, just indented — e.g. add left padding `paddingLeft: 44` so children sit under the header).
   - Keep `onClick={() => setSidebarOpen(false)}` on leaf links so the mobile drawer closes on navigation (preserve current behavior, line 338).
   - Import a chevron icon from `lucide-react` (e.g. `ChevronDown`) — it is not currently imported.
4b. **Collapse-on-navigate (mobile):** optionally collapse all non-active groups when a leaf is clicked, to keep the mobile drawer tidy.
5. **Preserve invariants:**
   - `end={to === '/'}` on the Dashboard link (line 337) stays.
   - Active-state background `rgba(0,113,227,0.25)` / hover `rgba(255,255,255,0.08)` styling is reused verbatim.
   - Role filtering still flows through `getAllowedRoutes(user?.role)` — no change to the permission model, only to *grouping*.

### Phase 3 — CSS additions
**Goal:** minimal styling for section headers + smooth expand/collapse. The existing `.glass-sidebar` (index.css:94–99) and tokens need **no changes**.

**File to modify:** `frontend-react/src/index.css` (append near the Glass Utilities section, after line 99). All styling can also be done inline (matching the codebase's inline-style convention), but these group helpers are cleaner as classes:

```css
/* ── Sidebar groups ──────────────────────────────────────────────── */
.sidebar-section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 20px;
  margin: 6px 8px 2px;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  background: transparent;
  border: none;
  cursor: pointer;
  width: calc(100% - 16px);
  transition: var(--transition);
}
.sidebar-section-header:hover { color: rgba(255, 255, 255, 0.8); }

.sidebar-section-header .chevron {
  margin-left: auto;
  transition: transform 0.2s ease;
}
.sidebar-section-header.expanded .chevron { transform: rotate(90deg); }

/* Indented child links (reuse existing NavLink inline styles + this class) */
.sidebar-child { padding-left: 44px !important; }

/* Smooth height animation for expand/collapse */
.sidebar-children {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.25s cubic-bezier(0.25, 0.1, 0.25, 1);
}
.sidebar-children.open { max-height: 320px; /* > tallest group */ }
```

> **Mobile note:** the drawer already slides via `translate-x` (Layout.tsx:280) and locks body scroll (`body.sidebar-open`, index.css:262-267). No mobile CSS changes needed — groups just reduce the drawer's scroll height.

### Phase 4 — Verification checklist
- [ ] `cd frontend-react && npm run build` succeeds (outputs to `backend/static/react/`).
- [ ] As **`master`** (Prabhu): all 7 blocks visible; every group expandable; active route's group auto-expanded.
- [ ] As **`admin`** (`ssncables`): Dashboard + Customers + Payments(all 3) + Operations(all 4) + Plans & Inventory + Reports + Administration(Settings, **Employees**, **Audit Log**) — Employees & Audit now appear and load (Phase 1 fix).
- [ ] As **`agent`/`collection_agent`**: Customers(3) + Payments(2) + Operations(Service Requests only) + Reports; no Add Customer, no Payments list, no Admin section.
- [ ] As **`collection_point`**: Dashboard + Payments(Record Payment, My Collections) + Operations(Service Requests) + Reports only — **no empty group headers**.
- [ ] As **`support`**: includes Inventory under Plans & Inventory.
- [ ] Mobile: drawer closes on leaf tap; active group auto-opens; collapsed groups don't push content off-screen.
- [ ] `NavLink` active highlight still works on every leaf.
- [ ] Backend: `curl` `/api/reports/audit-log` with an admin token returns 200 (already passes `test_authz.py`); verify any employee endpoints likewise return 200 (not 403) for admin.
- [ ] Deploy (`git push origin main`), verify at `https://wasool.co.in/app`.

---

## 6. Risks, Decisions & Follow-ups

### 6.1 Duplicated permission source of truth
`ROUTE_PERMISSIONS` (Layout.tsx) and `ROUTE_ROLES` (App.tsx) are hand-maintained copies. **Recommended follow-up (not in scope):** extract both to a single `frontend-react/src/lib/permissions.ts` exporting one `ROUTE_ROLES` map + a shared `Role` type, and import it in both files. This prevents future drift like the bug fixed in Phase 1.

### 6.2 Backend authorization for `/employees`
The frontend guard only controls *rendering*. The `/app/employees` page calls backend endpoints whose role checks were **not found** in `test_authz.py` (only `/api/reports/audit-log` and settings mutations are covered there). **Before shipping Phase 1 for Employees**, confirm the employee CRUD endpoints accept `admin` (not just `master`); otherwise the menu appears but the page 403s. Audit Log is already proven safe.

### 6.3 `/operators` decision
Recommend **keeping `/operators` as `['master']`** (multi-tenant business management is a super-admin function) unless product confirms admins should manage their own operator profile. Left unchanged in Phase 1 by default.

### 6.4 No regression to existing pages
No page components, routes, or API calls are touched. Only navigation structure + two permission entries change. Existing `Dashboard`, `Customers`, `Payments`, etc. are unaffected.

### 6.5 Placeholder pages
Per `CLAUDE.md`, `Reports`, `Connections`, `Service Requests`, `Settings`, `Operators` are placeholder pages. Grouping them does not change their implementation status — they remain TODO, just better organized.

---

## 7. Appendix — Exact edit locations

```
frontend-react/src/App.tsx
  ├─ Line 80:  '/audit':      ['master'],        → ['master', 'admin'],
  └─ Line 81:  '/employees':  ['master'],        → ['master', 'admin'],

frontend-react/src/components/Layout.tsx
  ├─ Lines 68–69 (ROUTE_PERMISSIONS): add 'admin' to /audit and /employees
  ├─ Lines 73–93 (navItems):          REPLACE flat array with standaloneNav + navGroups
  ├─ ~Line 188:                        ADD expandedGroups state + activeGroupId useMemo
  ├─ Lines 333–373 (nav render):       REWRITE to render standalone + collapsible groups
  └─ Line 3 imports:                   ADD ChevronDown (or ChevronRight) from lucide-react

frontend-react/src/index.css
  └─ After line 99: APPEND .sidebar-section-header / .sidebar-children / .sidebar-child classes
```

**Estimated effort:** Phase 1 ≈ 10 min (4 one-line edits + verify). Phase 2 ≈ 1–2 hrs (nav rewrite). Phase 3 ≈ 20 min (CSS). Total ≈ half a day including QA across 5 roles.
