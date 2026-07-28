import { useQuery } from '@tanstack/react-query';
import api from './portalApi';

type DashData = {
  customer_id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  area: string | null;
  address: string | null;
  plan_name: string | null;
  plan_amount: number | null;
  expiry_date: string | null;
  is_active: boolean;
  is_paid: boolean;
  month: string | null;
};

function fmtDate(d: string | null) {
  if (!d) return '\u2014';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

export default function PortalHome() {
  const { data, isLoading } = useQuery<DashData>({
    queryKey: ['portal-dashboard'],
    queryFn: async () => (await api.get('/dashboard')).data,
    refetchInterval: 30_000,
  });

  const { data: settings } = useQuery<{phone?: string; care_phone?: string; email?: string}>({
    queryKey: ['portal-settings'],
    queryFn: async () => {
      const r = await fetch('/api/portal/settings');
      return r.json();
    },
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#86868b' }}>
        Loading\u2026
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>
        Could not load your account. Try logging in again.
      </div>
    );
  }

  const amt = data.plan_amount ?? 0;
  const amtParam = encodeURIComponent(String(amt));
  const payHref = `/app/pay?amt=${amtParam}&cid=${data.customer_id}&month=${data.month ?? ''}`;

  return (
    <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>
      {/* Greeting */}
      <div style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 4 }}>
        {data.name}
      </div>
      <div style={{ fontSize: '0.8rem', color: '#86868b', marginBottom: 16 }}>
        {data.customer_id}
        {data.area ? ` \u00b7 ${data.area}` : ''}
      </div>

      {/* Status card */}
      <div
        style={{
          borderRadius: 16, padding: '20px', marginBottom: 16,
          background: data.is_paid ? '#e7f8ee' : '#fdeaea',
          border: `1px solid ${data.is_paid ? '#a3d9b1' : '#f5b5b5'}`,
        }}
      >
        <div style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {data.is_paid ? '\u2705 Paid' : '\u26a0 Due'}
        </div>
        <div style={{ fontSize: '2rem', fontWeight: 700, margin: '4px 0' }}>
          ₹{amt}
        </div>
        <div style={{ fontSize: '0.85rem', color: '#3a3a3c' }}>
          {data.plan_name || 'Cable TV'} plan
        </div>
        {data.expiry_date && (
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 8 }}>
            {data.is_paid ? `Active till ${fmtDate(data.expiry_date)}` : `Expired on ${fmtDate(data.expiry_date)}`}
          </div>
        )}
        {data.expiry_date && !data.is_paid && (
          <a href={payHref}
            style={{
              display: 'block', textAlign: 'center', marginTop: 14, padding: '12px', borderRadius: 12,
              background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)', color: '#fff', fontWeight: 700,
              fontSize: '1rem', textDecoration: 'none',
            }}
          >
            Pay ₹{amt} now
          </a>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Quick actions</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {data.is_paid && (
          <a href={payHref}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px', borderRadius: 12, background: '#e8eefc', color: '#2563eb',
              fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none',
            }}
          >
            Pay now (₹{amt})
          </a>
        )}
        <a href="/app/portal/history"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px', borderRadius: 12, background: '#e8eefc', color: '#2563eb',
            fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none',
          }}
        >
          Payment history
        </a>
        <a href="/app/portal/support"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px', borderRadius: 12, background: '#fef6e7', color: '#92400e',
            fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none',
          }}
        >
          Report a problem
        </a>
      </div>

      {/* Contact */}
      <div
        style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
          padding: '14px', fontSize: '0.8rem', color: '#6b7280',
        }}
      >
        Need help? Call <b>{settings?.phone || '77085 51139'}</b> or email
        {settings?.email || 'selvanayakiammancables@gmail.com'}
      </div>
    </div>
  );
}
