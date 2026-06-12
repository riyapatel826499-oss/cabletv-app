# Cable TV Management App

## Architecture
- **Backend**: FastAPI + Python, PostgreSQL (production) / SQLite (local dev)
- **Frontend (new)**: React 18 + TypeScript + Vite + TanStack Query + Tailwind + lucide-react
- **Frontend (legacy)**: Vanilla JS SPA in `frontend/dashboard.html` — still in production at `/dashboard`
- **Production**: wasool.co.in (Railway, auto-deploy from `git push origin main`)
- React app served at `/app` via Vite build output in `backend/static/react/`

## React Frontend Structure
```
frontend-react/
├── src/
│   ├── App.tsx           # Routes (BrowserRouter basename="/app")
│   ├── api/
│   │   ├── client.ts     # Axios instance with JWT interceptor
│   │   └── index.ts      # API functions grouped by domain
│   ├── components/
│   │   └── Layout.tsx    # Sidebar + dark mode + nav items
│   ├── hooks/
│   │   └── useAuth.tsx   # Auth context (localStorage token)
│   ├── lib/
│   │   └── format.ts     # fmtRs(), fmtDate()
│   ├── pages/            # One .tsx per page
│   └── types/
│       └── index.ts      # TypeScript interfaces
├── vite.config.ts        # proxy /api → backend, build → backend/static/react/
└── package.json
```

## Design System
- **Apple-inspired glass morphism**: `.glass-card`, `.glass-table`, `.animate-fade-in`
- CSS vars: `--bg-primary`, `--bg-secondary`, `--text`, `--text-light`, `--border`, `--radius-sm`
- Primary color: `#0071e3`, Success: `#34c759`, Warning: `#ff9f0a`, Danger: `#ff3b30`
- Dark mode: `.dark` class on body, toggle in Layout
- Fonts: system UI stack (SF Pro on Apple)
- Icons: lucide-react

## Existing Pages (DO NOT modify)
- Login, Dashboard, Customers, CustomerDetail, Payments, RecordPayment — all working

## Placeholder Pages (TODO — replace with real implementations)
- Reports, Connections, Service Requests, Settings, Operators

## Backend API Endpoints (all require JWT, prefix `/api/`)

### Reports
- `GET /api/reports/area-collection?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD`
- `GET /api/reports/collector-performance?from_date=&to_date=`
- `GET /api/reports/mso-summary?from_date=&to_date=`
- `GET /api/reports/my-collections?date_from=&date_to=&page=&per_page=`

### Unpaid Customers
- `GET /api/customers/unpaid?q=&area=&page=&per_page=&as_of=YYYY-MM-DD`
  Returns: `{customers: [{customer_id, name, phone, area, stb_no, plan_name, plan_amount, expiry_date, gap_months, pending_amount}], total, page, per_page, total_pages, areas}`

### Plans
- `GET /api/plans?status=Active` → `{plans: [{id, name, mso, type, price, mso_cost, status}]}`
- `POST /api/plans` → `{name, mso, type, price, mso_cost, status}`
- `PUT /api/plans/{id}` → same fields
- `DELETE /api/plans/{id}`

### Customers (for reference)
- `GET /api/customers?page=&per_page=&status=&q=&area=&sort=` → paginated list
- `GET /api/customers/search?q=` → quick search

## Patterns to Follow
1. Use TanStack Query (`useQuery`, `useMutation`) for data fetching
2. Use `react-router-dom` `Link` / `useNavigate` for navigation
3. Inline styles match existing pages (NOT CSS modules)
4. Glass cards: `<div className="glass-card animate-fade-in">`
5. Tables: `<table className="glass-table">`
6. Loading: spinner div (see Dashboard.tsx pattern)
7. Error: AlertCircle + message (see Dashboard.tsx pattern)
8. Currency: `fmtRs()` from `lib/format`
9. Dates: `fmtDate()` from `lib/format`
10. Stat cards: reusable `StatCard` component pattern from Dashboard

## Build & Deploy
```bash
cd frontend-react && npm run build    # outputs to backend/static/react/
cd /home/administrator/cabletv-app && git add -A && git commit -m "msg" && git push origin main
```
Railway auto-deploys on push. Verify: `curl -s https://wasool.co.in/api/health`

## Key Rules
- NEVER use "Network" in UI labels — always "MSO"
- Three MSOs: GTPL (default), TACTV (STB 172/173), SCV (STB 5000)
- Billing cycle: 13th → 12th of every month
- Admin username on production: `ssncables`, local: `admin`, password: `admin123`
