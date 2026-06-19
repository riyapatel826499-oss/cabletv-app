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
  Package,
  Wallet,
  IndianRupee,
  Minus,
  Plus as PlusIcon,
  Phone,
  Share,
  ChevronRight,
} from 'lucide-react';
import NotificationBell from './NotificationBell';
import { useState, useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

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
  '/inventory':           ['master', 'admin', 'support'],
  // Master only
  '/settings':            ['master', 'admin'],
  '/audit':               ['master', 'admin'],
  '/employees':           ['master', 'admin'],
  '/operators':           ['master'],
};

// ── Nav types ───────────────────────────────────────────────────────────────
type NavItem = { to: string; label: string; icon: React.ComponentType<{ style?: React.CSSProperties }> };
type NavGroup = { id: string; label: string; icon: React.ComponentType<{ style?: React.CSSProperties }>; items: NavItem[] };

// ── Standalone nav items (always visible at top, no collapse) ────────────────
const standaloneNav: NavItem[] = [
  { to: '/',        label: 'Dashboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Reports',   icon: FileBarChart },
];

// ── Collapsible nav groups ───────────────────────────────────────────────────
const navGroups: NavGroup[] = [
  {
    id: 'customers',
    label: 'Customers',
    icon: Users,
    items: [
      { to: '/customers',    label: 'Customers',    icon: Users },
      { to: '/add-customer', label: 'Add Customer', icon: UserPlus },
      { to: '/unpaid',       label: 'Unpaid',       icon: AlertCircle },
      { to: '/not-renewed',  label: 'Not Renewed',  icon: UserX },
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
      { to: '/reminders',        label: 'Reminders',        icon: Bell },
      { to: '/connections',      label: 'Connections',      icon: Wifi },
      { to: '/service-requests', label: 'Service Requests', icon: Wrench },
      { to: '/surrender',        label: 'Surrenders',       icon: PowerOff },
    ],
  },
  {
    id: 'admin',
    label: 'Setup & Admin',
    icon: Settings,
    items: [
      { to: '/plans',     label: 'Plans',     icon: Tv },
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/settings',  label: 'Settings',  icon: Settings },
      { to: '/employees', label: 'Employees', icon: UserCog },
      { to: '/operators', label: 'Operators', icon: Building2 },
      { to: '/audit',     label: 'Audit Log', icon: ScrollText },
    ],
  },
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

  // ── PWA: show toast when new version is available ──
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(url) {
      console.log('SW registered:', url);
    },
  });

  // ── Standalone (PWA) detection ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

  // ── Android install prompt ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showAndroidInstall, setShowAndroidInstall] = useState(false);

  useEffect(() => {
    if (isStandalone) return; // already installed
    const handler = (e: Event) => {
      e.preventDefault(); // stop Chrome's default infobar
      setDeferredPrompt(e);
      const dismissed = localStorage.getItem('android-install-dismissed') === 'true';
      if (!dismissed) {
        setTimeout(() => setShowAndroidInstall(true), 2000);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [isStandalone]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowAndroidInstall(false);
      setDeferredPrompt(null);
    }
    localStorage.setItem('android-install-dismissed', 'true');
  };

  // ── iOS install detection ──
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  useEffect(() => {
      if (isIOS && !isStandalone) {
        const dismissed = localStorage.getItem('ios-install-dismissed') === 'true';
        if (!dismissed) {
          // Small delay so it appears after page load
          const t = setTimeout(() => setShowIOSPrompt(true), 2000);
          return () => clearTimeout(t);
        }
      }
    }, [isIOS, isStandalone]);

  // Agent detection + current page check
  const isAgent = user?.role && !['master', 'admin'].includes(user.role);
  const isPaymentPage = location.pathname === '/payments/new';

  // Role-based nav filtering
  const allowedRoutes = getAllowedRoutes(user?.role);

  // ── Collapsible group state ──────────────────────────────────────────────
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Detect which group contains the current route (for auto-expand)
  const activeGroupId = navGroups.find(g =>
    g.items.some(item => {
      if (item.to === '/') return location.pathname === '/';
      return location.pathname === item.to || location.pathname.startsWith(item.to + '/');
    })
  )?.id;

  // Auto-expand: always show the active group's items
  const isGroupExpanded = (gid: string) => expandedGroups.has(gid) || gid === activeGroupId;

  const toggleGroup = (gid: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  // Filter groups to only those with ≥1 visible item
  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(item => allowedRoutes.has(item.to)) }))
    .filter(g => g.items.length > 0);

  const visibleStandalone = standaloneNav.filter(item => allowedRoutes.has(item.to));

  // ── Dark mode: auto by time (7PM–6AM), manual override persists ──
  function isDarkHour() {
    const h = new Date().getHours();
    return h >= 19 || h < 6;
  }

  useEffect(() => {
    const isManual = localStorage.getItem('dark-mode-manual') === 'true';
    if (isManual) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDarkMode(localStorage.getItem('dark-mode') === 'true');
    } else {
      setDarkMode(isDarkHour());
    }
    const savedScale = parseInt(localStorage.getItem('font-scale') || '100', 10);
    if (!isNaN(savedScale)) setFontScale(savedScale);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('dark-mode', String(darkMode));
  }, [darkMode]);

  // Auto-switch every 5 min (only if user hasn't manually overridden)
  useEffect(() => {
    const interval = setInterval(() => {
      const isManual = localStorage.getItem('dark-mode-manual') === 'true';
      if (!isManual) setDarkMode(isDarkHour());
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Apply font zoom (font-size on html, NOT zoom which breaks layout)
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * fontScale / 100}px`;
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
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)', width: '100%', overflowX: 'hidden' }}>
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
        className={`glass-sidebar fixed lg:static inset-y-0 left-0 z-[110] flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
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
            {/* Standalone items (Dashboard) */}
            {visibleStandalone.map(({ to, label, icon: Icon }) => (
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
                  if (!el.style.background.includes('113')) {
                    el.style.background = 'rgba(255,255,255,0.08)';
                    el.style.color = 'rgba(255,255,255,0.95)';
                  }
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  if (!el.style.background.includes('113')) {
                    el.style.background = 'transparent';
                    el.style.color = 'rgba(255,255,255,0.7)';
                  }
                }}
              >
                <Icon style={{ width: 18, height: 18 }} />
                {label}
              </NavLink>
            ))}

            {/* Collapsible groups */}
            {visibleGroups.map((group) => {
              const expanded = isGroupExpanded(group.id);
              const GroupIcon = group.icon;
              return (
                <div key={group.id}>
                  {/* Section header */}
                  <button
                    onClick={() => toggleGroup(group.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '9px 20px',
                      margin: '4px 8px 2px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: expanded ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      width: 'calc(100% - 16px)',
                      transition: 'var(--transition)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = expanded ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)';
                    }}
                  >
                    <GroupIcon style={{ width: 16, height: 16 }} />
                    {group.label}
                    <ChevronRight
                      style={{
                        width: 14,
                        height: 14,
                        marginLeft: 'auto',
                        transition: 'transform 0.2s ease',
                        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>

                  {/* Children */}
                  {expanded && group.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setSidebarOpen(false)}
                      style={({ isActive }) => ({
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '9px 20px 9px 44px',
                        margin: '1px 8px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.88rem',
                        fontWeight: 500,
                        transition: 'var(--transition)',
                        background: isActive ? 'rgba(0,113,227,0.25)' : 'transparent',
                        color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                        textDecoration: 'none',
                      })}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        if (!el.style.background.includes('113')) {
                          el.style.background = 'rgba(255,255,255,0.08)';
                          el.style.color = 'rgba(255,255,255,0.9)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget;
                        if (!el.style.background.includes('113')) {
                          el.style.background = 'transparent';
                          el.style.color = 'rgba(255,255,255,0.65)';
                        }
                      }}
                    >
                      <Icon style={{ width: 16, height: 16 }} />
                      {label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
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
          minWidth: 0,
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

            {/* Activity Bell */}
            <NotificationBell />

            {/* Dark mode */}
            <button
              onClick={() => {
                localStorage.setItem('dark-mode-manual', 'true');
                setDarkMode(!darkMode);
              }}
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
              boxShadow: darkMode
                ? '0 6px 20px rgba(52, 199, 89, 0.4), 0 0 24px rgba(52, 199, 89, 0.35), 0 0 48px rgba(52, 199, 89, 0.15)'
                : '0 6px 20px rgba(52, 199, 89, 0.4)',
              cursor: 'pointer',
              color: '#fff',
              fontSize: '0.95rem',
              fontWeight: 600,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = darkMode
                ? '0 8px 28px rgba(52, 199, 89, 0.5), 0 0 32px rgba(52, 199, 89, 0.4), 0 0 60px rgba(52, 199, 89, 0.2)'
                : '0 8px 28px rgba(52, 199, 89, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = darkMode
                ? '0 6px 20px rgba(52, 199, 89, 0.4), 0 0 24px rgba(52, 199, 89, 0.35), 0 0 48px rgba(52, 199, 89, 0.15)'
                : '0 6px 20px rgba(52, 199, 89, 0.4)';
            }}
          >
            <IndianRupee style={{ width: 20, height: 20 }} />
            Collect
          </button>
        )}

        {/* ── iOS install prompt ────────────────────────────────── */}
        {showIOSPrompt && (
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'var(--card)',
              borderTop: '1px solid var(--border)',
              boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
              padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
              zIndex: 150,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'linear-gradient(135deg, #0071e3, #64d2ff)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Tv style={{ width: 22, height: 22, color: '#fff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                  Install Wasool App
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-light)', lineHeight: 1.4, marginBottom: 8 }}>
                  Get the app on your home screen for quick access
                </p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.5 }}>
                  Tap <Share style={{ width: 13, height: 13, display: 'inline', verticalAlign: 'middle', color: 'var(--primary)' }} /> in Safari bar, then{' '}
                  <strong>Add to Home Screen</strong>
                </p>
              </div>
              <button
                onClick={() => {
                  setShowIOSPrompt(false);
                  localStorage.setItem('ios-install-dismissed', 'true');
                }}
                style={{
                  background: 'transparent', border: 'none', fontSize: '1.2rem',
                  color: 'var(--text-light)', cursor: 'pointer', padding: '0 4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── Android install prompt ──────────────────────────── */}
        {showAndroidInstall && (
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'var(--card)',
              borderTop: '1px solid var(--border)',
              boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
              padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
              zIndex: 150,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'linear-gradient(135deg, #0071e3, #64d2ff)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Tv style={{ width: 22, height: 22, color: '#fff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                  Install Wasool App
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-light)', lineHeight: 1.4 }}>
                  Add to home screen for quick access — works offline
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAndroidInstall(false);
                  localStorage.setItem('android-install-dismissed', 'true');
                }}
                style={{
                  background: 'transparent', border: 'none', fontSize: '1.2rem',
                  color: 'var(--text-light)', cursor: 'pointer', padding: '0 4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
            <button
              onClick={handleInstallClick}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #0071e3, #0091ff)',
                color: '#fff',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0,113,227,0.3)',
              }}
            >
              Install App
            </button>
          </div>
        )}

        {/* ── PWA Update toast ──────────────────────────────────── */}
        {needRefresh && (
          <div
            style={{
              position: 'fixed',
              bottom: 20,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--card)',
              border: '0.5px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-hover)',
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              zIndex: 200,
              maxWidth: '90vw',
            }}
          >
            <span style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500 }}>
              New version available
            </span>
            <button
              onClick={() => updateServiceWorker(true)}
              style={{
                background: 'var(--primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-xs)',
                padding: '7px 16px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Update
            </button>
            <button
              onClick={() => setNeedRefresh(false)}
              style={{
                background: 'transparent',
                color: 'var(--text-light)',
                border: 'none',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
