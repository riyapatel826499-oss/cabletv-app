import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { getToken, clearToken } from './portalApi';

const BUSINESS = 'Sree Selvanaayakki Amman Cables & Internet Services';

const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, textAlign: 'center', padding: '8px 0', fontSize: '0.75rem',
  fontWeight: active ? 700 : 500, color: active ? '#2563eb' : '#6b7280',
  textDecoration: 'none', borderTop: active ? '2px solid #2563eb' : '2px solid transparent',
  transition: 'all 0.15s',
});

export default function PortalLayout() {
  const loc = useLocation();
  const token = getToken();

  if (!token) {
    return <Navigate to="/app/portal" replace />;
  }

  const path = loc.pathname.replace('/app/portal', '') || '/home';

  const tabs = [
    { path: '/home', label: 'Home', href: '/app/portal/home' },
    { path: '/history', label: 'History', href: '/app/portal/history' },
    { path: '/support', label: 'Support', href: '/app/portal/support' },
  ];

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        background: '#f6f7fb', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
        color: '#1d1d1f',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: '#0b1020', color: '#fff', padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.2 }}>
          {BUSINESS}
        </div>
        <button
          onClick={() => { clearToken(); window.location.href = '/app/portal'; }}
          style={{
            background: 'rgba(255,255,255,0.12)', border: 'none', color: '#cfd6ea',
            padding: '6px 12px', borderRadius: 8, fontSize: '0.75rem', cursor: 'pointer',
          }}
        >
          Logout
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Outlet />
      </div>

      {/* Bottom tab bar */}
      <div
        style={{
          display: 'flex', background: '#fff', borderTop: '1px solid #e5e7eb',
          position: 'sticky', bottom: 0,
        }}
      >
        {tabs.map((t) => {
          const active = path.startsWith(t.path);
          return (
            <a key={t.path} href={t.href} style={tabStyle(active)}>
              {t.label}
            </a>
          );
        })}
      </div>
    </div>
  );
}
