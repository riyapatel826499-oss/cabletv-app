import { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { getPortalToken, clearToken } from './portalApi';
import LangToggle from '../components/LangToggle';
import { useT } from '../lib/i18n';
import { appUrl } from '../lib/native';

const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, textAlign: 'center', padding: '8px 0', fontSize: '0.75rem',
  fontWeight: active ? 700 : 500, color: active ? 'var(--wp-accent)' : '#6b7280',
  textDecoration: 'none', borderTop: active ? '2px solid var(--wp-accent)' : '2px solid transparent',
  transition: 'all 0.15s',
});

/** CSS-in-JS style block injected by login / layout pages. */
export function PortalStyle() {
  return (
    <style>{`
      .wp {
        --wp-accent: #2563eb;
        --wp-accent-faint: #e8eefc;
        --wp-line: #e2e6ef;
        --wp-ink: #1d1d1f;
        --wp-muted: #86868b;
        --wp-red: #b91c1c;
        --wp-card-bg: #fff;
        font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
        color: var(--wp-ink);
      }
      .wp-card {
        background: var(--wp-card-bg);
        border-radius: 20px;
        box-shadow: 0 16px 50px rgba(0,0,0,0.08);
      }
      .wp-btn {
        width: 100%;
        padding: 15px;
        border-radius: 14px;
        border: none;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: opacity 0.15s;
      }
      .wp-en { font-weight: 400; font-size: .85rem; display: inline-block; margin-left: 4px; }
      .wp-muted { color: var(--wp-muted); font-size: .85rem; }
    `}</style>
  );
}

export default function PortalLayout() {
  const loc = useLocation();
  const token = getPortalToken();
  const { t } = useT();
  const [businessName, setBusinessName] = useState('Sree Selvanaayakki Amman Cables & Internet Services');

  useEffect(() => {
    fetch('/api/portal/settings')
      .then(r => r.json())
      .then(d => { if (d.business_name) setBusinessName(d.business_name); })
      .catch(() => {});
  }, []);

  if (!token) {
    return <Navigate to="/portal" replace />;
  }

  const path = loc.pathname.replace(/^\/(portal)?/, '') || '/home';

  const tabs = [
    { path: '/home', label: t('Home'), href: appUrl('/portal/home') },
    { path: '/history', label: t('History'), href: appUrl('/portal/history') },
    { path: '/support', label: t('Support'), href: appUrl('/portal/support') },
  ];

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        background: '#f6f7fb', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
        color: '#1d1d1f',
      }}
    >
      <PortalStyle />
      {/* Header */}
      <div
        style={{
          background: '#0b1020', color: '#fff', padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.2 }}>
          {businessName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LangToggle dark />
          <button
            onClick={() => { clearToken(); window.location.href = '/app/portal'; }}
            style={{
              background: 'rgba(255,255,255,0.12)', border: 'none', color: '#cfd6ea',
              padding: '6px 12px', borderRadius: 8, fontSize: '0.75rem', cursor: 'pointer',
            }}
          >
            {t('Logout')}
          </button>
        </div>
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
