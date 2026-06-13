import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Wifi,
  FileBarChart,
  Wrench,
  Settings,
  LogOut,
  Menu,
  X,
  Moon,
  Sun,
  Tv,
  AlertCircle,
  Building2,
  UserCog,
  UserPlus,
  UserX,
  Bell,
  ScrollText,
  PowerOff,
  Wallet,
  IndianRupee,
  Minus,
  Plus as PlusIcon,
  Phone,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

// ── Role-based permissions ─────────────────────────────────────────────────
// Each route maps to the roles that can access it.
// master = Prabhu (full), admin = operator admin (e.g. SSN Cables)
// collection_agent / agent = collection-focused staff
// service roles handled under collection_agent for now
type Role = 'master' | 'admin' | 'agent' | 'collection_agent' | 'support' | 'collection_point';

const ALL_ROLES: Role[] = ['master', 'admin', 'agent', 'collection_agent', 'support'];
const CP: Role[] = [...ALL_ROLES, 'collection_point'];

const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  '/':                    CP,                                  // Dashboard
  '/customers/:id':       CP,                                  // Customer detail (clickable from collections)
  '/payments/new':        CP,                                  // Record payment (via floating Collect button)
  '/my-collections':      CP,                                  // Own collections
  '/reports':             CP,                                  // Reports (backend auto-filters)
  '/service-requests':    CP,                                  // View/resolve SRs
  // Staff only (no collection_point)
  '/customers':           ALL_ROLES,                           // View customers list
  '/unpaid':              ALL_ROLES,                           // Collection work
  '/not-renewed':         ALL_ROLES,
  // Admin+ only
  '/add-customer':        ['master', 'admin'],
  '/payments':            ['master', 'admin'],
  '/plans':               ['master', 'admin'],
  '/reminders':           ['master', 'admin'],
  '/connections':         ['master', 'admin'],
  '/surrender':           ['master', 'admin'],
  // Master only
  '/settings':            ['master', 'admin'],
  '/audit':               ['master'],
  '/employees':           ['master'],
  '/operators':           ['master'],
};

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/add-customer', label: 'Add Customer', icon: UserPlus },
  { to: '/unpaid', label: 'Unpaid', icon: AlertCircle },
  { to: '/not-renewed', label: 'Not Renewed', icon: UserX },
  { to: '/payments/new', label: 'Record Payment', icon: CreditCard },
  { to: '/my-collections', label: 'My Collections', icon: Wallet },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/plans', label: 'Plans', icon: Tv },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/reminders', label: 'Reminders', icon: Bell },
  { to: '/connections', label: 'Connections', icon: Wifi },
  { to: '/service-requests', label: 'Service Requests', icon: Wrench },
  { to: '/surrender', label: 'Surrenders', icon: PowerOff },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/employees', label: 'Employees', icon: UserCog },
  { to: '/operators', label: 'Operators', icon: Building2 },
];

function getAllowedRoutes(role: string | undefined): Set<string> {
  const r = (role || 'agent') as Role;
  const allowed = new Set<string>();
  for (const [route, roles] of Object.entries(ROUTE_PERMISSIONS)) {
    if (roles.includes(r)) {
      allowed.add(route);
    }
  }
  // Safety: if no routes matched (unknown role), give agent-level access
  if (allowed.size === 0 && r !== 'master' && r !== 'admin') {
    for (const [route, roles] of Object.entries(ROUTE_PERMISSIONS)) {
      if (roles.includes('agent' as Role)) {
        allowed.add(route);
      }
    }
  }
  return allowed;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [fontScale, setFontScale] = useState(100);
  const [showFontControl, setShowFontControl] = useState(false);
  const fontRef = useRef<HTMLDivElement>(null);

  // Agent detection + current page check
  const isAgent = user?.role && !['master', 'admin'].includes(user.role);
  const isPaymentPage = location.pathname === '/payments/new';

  // Role-based nav filtering
  const allowedRoutes = getAllowedRoutes(user?.role);
  const visibleNavItems = navItems.filter((item) => allowedRoutes.has(item.to));

  useEffect(() => {
    const saved = localStorage.getItem('dark-mode') === 'true';
    setDarkMode(saved);
    const savedScale = parseInt(localStorage.getItem('font-scale') || '100', 10);
    if (!isNaN(savedScale)) setFontScale(savedScale);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('dark-mode', String(darkMode));
  }, [darkMode]);

  // Apply font zoom
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) {
      (root.style as any).zoom = `${fontScale}%`;
    }
    localStorage.setItem('font-scale', String(fontScale));
  }, [fontScale]);

  // Close font control on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fontRef.current && !fontRef.current.contains(e.target as Node)) {
        setShowFontControl(false);
      }
    };
    if (showFontControl) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFontControl]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add('sidebar-open');
    } else {
      document.body.classList.remove('sidebar-open');
    }
    return () => document.body.classList.remove('sidebar-open');
  }, [sidebarOpen]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = (user?.name || 'U')
    .split(' ')
    .map((s) => s[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>
      {/* ── Mobile overlay ─────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 20,
          }}
          className="lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside
        className={`glass-sidebar fixed lg:static inset-y-0 left-0 z-30 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
        style={{
          width: 'var(--sidebar-width)',
          transition: 'var(--transition)',
        }}
      >
        <div
          className="w-full h-full flex flex-col"
          style={{ transition: 'var(--transition)' }}
        >
          {/* Brand */}
          <div
            style={{
              padding: '24px 20px',
              borderBottom: '0.5px solid rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #0071e3, #64d2ff)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Tv style={{ width: 20, height: 20, color: '#fff' }} />
              </div>
              <div>
                <h2
                  style={{
                    fontSize: '1.3rem',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: '#fff',
                  }}
                >
                  Wasool
                </h2>
                <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)' }}>
                  Cable TV Management
                </p>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav
            style={{ padding: '12px 0', flex: 1, overflowY: 'auto' }}
          >
            {visibleNavItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setSidebarOpen(false)}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 20px',
                  margin: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.92rem',
                  fontWeight: 500,
                  transition: 'var(--transition)',
                  background: isActive ? 'rgba(0,113,227,0.25)' : 'transparent',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
                  textDecoration: 'none',
                })}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  const isActive = el.style.background !== 'transparent';
                  if (!isActive) {
                    el.style.background = 'rgba(255,255,255,0.08)';
                    el.style.color = 'rgba(255,255,255,0.95)';
                  }
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  const isActive = el.style.background.includes('113') || el.style.background.includes('0.25');
                  if (!isActive) {
                    el.style.background = 'transparent';
                    el.style.color = 'rgba(255,255,255,0.7)';
                  }
                }}
              >
                <Icon style={{ width: 18, height: 18 }} />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Footer / User */}
          <div
            style={{
              padding: '20px',
              borderTop: '0.5px solid rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #0071e3, #64d2ff)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    color: '#fff',
                  }}
                >
                  {initials}
                </div>
                <div>
                  <p
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.95)',
                    }}
                  >
                    {user?.name || 'User'}
                  </p>
                  <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)' }}>
                    {user?.role || ''}
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 8,
                  borderRadius: 'var(--radius-xs)',
                  color: 'rgba(255,255,255,0.5)',
                  transition: 'var(--transition)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,59,48,0.15)';
                  e.currentTarget.style.color = '#ff3b30';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
                }}
              >
                <LogOut style={{ width: 18, height: 18 }} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Content ───────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: '100vh',
          transition: 'var(--transition)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Topbar */}
        <header
          className="glass-topbar"
          style={{
            position: 'sticky',
            top: 0,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 100,
          }}
        >
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden"
              style={{
                background: 'var(--bg-secondary)',
                border: '0.5px solid var(--border)',
                borderRadius: 'var(--radius-xs)',
                padding: '8px 10px',
                cursor: 'pointer',
                color: 'var(--text)',
              }}
            >
              {sidebarOpen ? <X style={{ width: 20, height: 20 }} /> : <Menu style={{ width: 20, height: 20 }} />}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Font size control */}
            <div ref={fontRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowFontControl(!showFontControl)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: showFontControl ? 'var(--primary)' : 'var(--bg-secondary)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '7px 11px',
                  cursor: 'pointer',
                  color: showFontControl ? '#fff' : 'var(--text-light)',
                  transition: 'var(--transition)',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  minWidth: 36,
                }}
              >
                Aa
              </button>
              {showFontControl && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    background: 'var(--bg-card)',
                    backdropFilter: 'var(--glass)',
                    WebkitBackdropFilter: 'var(--glass)',
                    border: '0.5px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: 'var(--shadow-hover)',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    zIndex: 200,
                    minWidth: 170,
                  }}
                >
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Text Size: {fontScale}%
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                    <button
                      onClick={() => setFontScale(Math.max(80, fontScale - 10))}
                      disabled={fontScale <= 80}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 34, height: 34, borderRadius: 'var(--radius-xs)',
                        border: '0.5px solid var(--border)',
                        background: fontScale <= 80 ? 'var(--bg-secondary)' : 'var(--bg-secondary)',
                        color: fontScale <= 80 ? 'var(--text-light)' : 'var(--text)',
                        cursor: fontScale <= 80 ? 'not-allowed' : 'pointer',
                        opacity: fontScale <= 80 ? 0.4 : 1,
                      }}
                    >
                      <Minus style={{ width: 16, height: 16 }} />
                    </button>
                    {/* Quick presets */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[90, 100, 110, 125].map((s) => (
                        <button
                          key={s}
                          onClick={() => setFontScale(s)}
                          style={{
                            padding: '4px 8px', borderRadius: 6, border: 'none',
                            fontSize: '0.7rem', fontWeight: 600,
                            cursor: 'pointer',
                            background: fontScale === s ? 'var(--primary)' : 'transparent',
                            color: fontScale === s ? '#fff' : 'var(--text-light)',
                          }}
                        >
                          {s === 100 ? 'M' : s < 100 ? 'S' : s >= 125 ? 'XL' : 'L'}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setFontScale(Math.min(150, fontScale + 10))}
                      disabled={fontScale >= 150}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 34, height: 34, borderRadius: 'var(--radius-xs)',
                        border: '0.5px solid var(--border)',
                        background: 'var(--bg-secondary)',
                        color: fontScale >= 150 ? 'var(--text-light)' : 'var(--text)',
                        cursor: fontScale >= 150 ? 'not-allowed' : 'pointer',
                        opacity: fontScale >= 150 ? 0.4 : 1,
                      }}
                    >
                      <PlusIcon style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Call support */}
            <a
              href="tel:9787225577"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-secondary)',
                border: '0.5px solid var(--border)',
                borderRadius: 'var(--radius-xs)',
                padding: 8,
                cursor: 'pointer',
                color: '#34c759',
                transition: 'var(--transition)',
                textDecoration: 'none',
              }}
            >
              <Phone style={{ width: 18, height: 18 }} />
            </a>

            {/* Dark mode */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              style={{
                background: 'var(--bg-secondary)',
                border: '0.5px solid var(--border)',
                borderRadius: 'var(--radius-xs)',
                padding: 8,
                cursor: 'pointer',
                color: 'var(--text-light)',
                transition: 'var(--transition)',
              }}
            >
              {darkMode ? <Sun style={{ width: 18, height: 18 }} /> : <Moon style={{ width: 18, height: 18 }} />}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main
          style={{
            padding: '16px 12px',
            maxWidth: 1400,
            margin: '0 auto',
            width: '100%',
            flex: 1,
          }}
          className="animate-fade-in"
        >
          <Outlet />
        </main>

        {/* ── Floating Record Payment button (agents only) ──────────────── */}
        {isAgent && !isPaymentPage && (
          <button
            onClick={() => navigate('/payments/new')}
            style={{
              position: 'fixed',
              bottom: 24,
              right: 24,
              zIndex: 50,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 24px',
              borderRadius: 50,
              background: 'linear-gradient(135deg, #34c759, #248a3d)',
              border: 'none',
              boxShadow: '0 6px 20px rgba(52, 199, 89, 0.4)',
              cursor: 'pointer',
              color: '#fff',
              fontSize: '0.95rem',
              fontWeight: 600,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 8px 28px rgba(52, 199, 89, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(52, 199, 89, 0.4)';
            }}
          >
            <IndianRupee style={{ width: 20, height: 20 }} />
            Collect
          </button>
        )}
      </div>
    </div>
  );
}
