# Cable TV Management App — Architecture Plan

## Phase 1: Deploy Current App to Railway (NOW)
- Keep SQLite for now (data in persistent volume)
- Backend: FastAPI as-is
- Frontend: Static HTML/JS served by FastAPI
- Zero code changes needed, just config

## Phase 2: React Frontend Rewrite (NEXT)
Replace vanilla HTML/JS with React + TypeScript + Vite.

### Tech Stack
- **Vite** — build tool (fast HMR, optimized builds)
- **React 19** — UI framework
- **TypeScript** — type safety
- **React Router** — client-side routing
- **TanStack Query** — server state management (caching, refetching)
- **Tailwind CSS** — utility-first styling
- **Shadcn/ui** — component library (copy-paste, not npm dep)
- **Recharts** — charts for dashboard

### Project Structure
```
cabletv-app/
├── railway.json
├── Procfile
├── backend/                    # FastAPI (existing)
│   ├── main.py
│   ├── config.py
│   ├── db.py                   # NEW: DB abstraction (sqlite/pg)
│   ├── deps.py
│   ├── models/
│   ├── routes/                 # REST API (unchanged)
│   └── requirements.txt
├── frontend/                   # React app (NEW)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── index.html
│   ├── public/
│   │   ├── manifest.json       # PWA manifest
│   │   └── sw.js               # Service worker
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                # API client layer
│       │   ├── client.ts       # Axios/fetch wrapper with auth
│       │   ├── auth.ts         # Login/logout/token
│       │   ├── customers.ts
│       │   ├── payments.ts
│       │   ├── connections.ts
│       │   ├── dashboard.ts
│       │   ├── reports.ts
│       │   └── operators.ts    # Multi-tenant
│       ├── hooks/              # Custom hooks
│       │   ├── useAuth.ts
│       │   ├── useOperator.ts  # Current LCO context
│       │   └── usePermissions.ts
│       ├── components/         # Shared components
│       │   ├── ui/             # Shadcn components
│       │   ├── Layout.tsx      # Sidebar + header
│       │   ├── DataTable.tsx   # Reusable table
│       │   ├── SearchBar.tsx
│       │   ├── StatusBadge.tsx
│       │   └── Modal.tsx
│       ├── pages/              # Route pages
│       │   ├── Login.tsx
│       │   ├── Dashboard.tsx
│       │   ├── Customers/
│       │   │   ├── List.tsx
│       │   │   ├── Detail.tsx
│       │   │   └── Form.tsx
│       │   ├── Payments/
│       │   │   ├── List.tsx
│       │   │   └── Add.tsx
│       │   ├── Connections/
│       │   │   ├── List.tsx
│       │   │   └── Form.tsx
│       │   ├── Reports.tsx
│       │   ├── ServiceRequests.tsx
│       │   ├── Settings.tsx
│       │   └── Operators.tsx   # Master admin only
│       ├── lib/
│       │   ├── utils.ts
│       │   └── constants.ts
│       └── types/              # TypeScript interfaces
│           ├── customer.ts
│           ├── payment.ts
│           ├── connection.ts
│           └── operator.ts
```

### Multi-Tenant (LCO) Design
- Master admin sees all operators + can switch between them
- Each LCO admin sees only their data (operator_id filter)
- Operator context stored in React state, sent as header/query param
- Different themes/branding per operator (optional)

### Key Screens
1. **Login** — simple username/password → JWT token
2. **Dashboard** — stats cards, collection chart, recent payments
3. **Customers** — searchable table, add/edit, connection details
4. **Payments** — add payment, month filter, export
5. **Connections** — STB management, MSO status
6. **Reports** — monthly collection, MSO reconciliation
7. **Service Requests** — TG bot integration, ticket tracking
8. **Settings** — plans, users, notifications
9. **Operators** — master admin: add/edit LCOs (multi-tenant)

### Deployment on Railway
```
cabletv-app/              ← Single repo
├── backend/              ← Railway backend service
├── frontend/             ← Build → static files served by backend
└── railway.json
```
- Frontend builds to `frontend/dist/`
- Backend serves `frontend/dist/` as static files
- Single Railway service, one $5/month cost

## Phase 3: PostgreSQL Migration (LATER, when needed)
- Switch `db.py` to PostgreSQL when DATABASE_URL is set
- Migrate existing SQLite data
- Needed when: 5+ LCOs or high concurrent writes
