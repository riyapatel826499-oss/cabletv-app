import { NavLink, Outlet, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { useState, useEffect } from 'react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/unpaid', label: 'Unpaid', icon: AlertCircle },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/payments/new', label: 'Record Payment', icon: CreditCard },
  { to: '/plans', label: 'Plans', icon: Tv },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/connections', label: 'Connections', icon: Wifi },
  { to: '/service-requests', label: 'Service Requests', icon: Wrench },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('dark-mode') === 'true';
    setDarkMode(saved);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('dark-mode', String(darkMode));
  }, [darkMode]);

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
        className={`glass-sidebar fixed lg:static inset-y-0 left-0 z-30 flex flex-col`}
        style={{
          width: 'var(--sidebar-width)',
          transition: 'var(--transition)',
          transform: sidebarOpen ? 'translateX(0)' : undefined,
        }}
      >
        {/* Mobile hidden class */}
        <div
          className={`w-full h-full flex flex-col ${sidebarOpen ? '' : '-translate-x-full'} lg:translate-x-0`}
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
            {navItems.map(({ to, label, icon: Icon }) => (
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
            padding: '14px 32px',
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
            padding: '28px 32px',
            maxWidth: 1400,
            margin: '0 auto',
            width: '100%',
            flex: 1,
          }}
          className="animate-fade-in"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
