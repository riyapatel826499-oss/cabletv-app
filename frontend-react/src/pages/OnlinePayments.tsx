import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import {
  CreditCard,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Loader2,
} from 'lucide-react';
import { useT } from '../lib/i18n';

// Online Payments — an in-app monitor of Razorpay webhook activity.
// Every webhook Razorpay sends is logged server-side to `online_payments`.
// This screen lists them so you can confirm payments flowed into Wasool
// without digging through the Razorpay dashboard.

interface OnlinePayment {
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  month: string | null;
  amount: number | null;
  status: string | null;
  error: string | null;
  created_at: string | null;
}

interface OnlinePaymentsResp {
  count: number;
  summary: Record<string, number>;
  payments: OnlinePayment[];
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string; Icon: React.ComponentType<{ size?: number }> }> = {
  recorded:       { bg: 'rgba(34,197,94,0.15)',  color: '#22c55e', label: 'Recorded',        Icon: CheckCircle2 },
  needs_review:   { bg: 'rgba(239,68,68,0.15)',  color: '#ef4444', label: 'Needs review',    Icon: AlertTriangle },
  no_customer_id: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: 'Unattributed',    Icon: HelpCircle },
  captured:       { bg: 'rgba(90,162,255,0.15)', color: '#5aa2ff', label: 'Captured',        Icon: CreditCard },
};

function StatusChip({ status }: { status: string | null }) {
  const { t } = useT();
  const s = STATUS_STYLE[status || ''] || {
    bg: 'rgba(148,163,184,0.15)', color: '#94a3b8', label: status || 'Unknown', Icon: HelpCircle,
  };
  const { Icon } = s;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px',
      borderRadius: 999, background: s.bg, color: s.color, fontSize: '0.78rem', fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      <Icon size={13} />{t(s.label)}
    </span>
  );
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function OnlinePayments() {
  const { t } = useT();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<OnlinePaymentsResp>({
    queryKey: ['online-payments'],
    queryFn: async () => (await api.get('/online-payments', { params: { limit: 200 } })).data,
    refetchInterval: 30_000,
  });

  const card: React.CSSProperties = {
    background: 'var(--card-bg, #fff)',
    border: '1px solid var(--border-color, #e6e8ef)',
    borderRadius: 14,
    color: 'var(--text-color, #1d1d1f)',
  };
  const muted = 'var(--text-muted, #86868b)';

  const summary = data?.summary || {};

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '4px 2px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-color,#1d1d1f)' }}>
            <CreditCard size={22} /> {t('Online Payments')}
          </h1>
          <p style={{ color: muted, fontSize: '0.85rem', marginTop: 2 }}>
            {t('Payments received automatically through the Razorpay pay page.')}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px',
            borderRadius: 10, border: '1px solid var(--border-color,#e6e8ef)',
            background: 'var(--card-bg,#fff)', color: 'var(--text-color,#1d1d1f)',
            fontWeight: 600, cursor: 'pointer', opacity: isFetching ? 0.6 : 1,
          }}
        >
          <RefreshCw size={15} style={isFetching ? { animation: 'spin 1s linear infinite' } : undefined} />
          {t('Refresh')}
        </button>
      </div>

      {/* Summary chips */}
      {data && data.count > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {Object.entries(summary).map(([st, n]) => (
            <div key={st} style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusChip status={st} />
              <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      {isLoading && (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: muted }}>
          <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /> {t('Loading…')}
        </div>
      )}

      {isError && (
        <div style={{ ...card, padding: 20, borderColor: '#ef4444', color: '#ef4444' }}>
          {t('Could not load online payments. You may not have permission, or the server is unavailable.')}
        </div>
      )}

      {data && data.count === 0 && (
        <div style={{ ...card, padding: 32, textAlign: 'center' }}>
          <AlertTriangle size={26} style={{ color: '#f59e0b', marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('No online payments yet')}</div>
          <p style={{ color: muted, fontSize: '0.85rem', lineHeight: 1.5, maxWidth: 480, margin: '0 auto' }}>
            {t('When a customer pays through the Razorpay pay page and the webhook fires, it will appear here.')}
            {t('If you made a test payment and nothing shows, the webhook likely isn\'t configured yet')}
            ({t('Razorpay Dashboard → Settings → Webhooks →')} <code>/api/razorpay/webhook</code>{t(', event')} <code>payment.captured</code>).
          </p>
        </div>
      )}

      {/* List */}
      {data && data.count > 0 && (
        <div style={{ ...card, overflow: 'hidden' }}>
          {data.payments.map((p, i) => (
            <div
              key={p.razorpay_payment_id || i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
                padding: '14px 16px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#eef0f5)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {p.customer_name || p.customer_id || t('Unknown customer')}
                  {p.customer_id && p.customer_name && (
                    <span style={{ color: muted, fontWeight: 400 }}> · {p.customer_id}</span>
                  )}
                </div>
                <div style={{ color: muted, fontSize: '0.78rem', marginTop: 2, wordBreak: 'break-all' }}>
                  {p.razorpay_payment_id || '—'}{p.month ? ` · ${p.month}` : ''} · {fmtWhen(p.created_at)}
                </div>
                {p.error && (
                  <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 4 }}>
                    {p.error}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                  ₹{(p.amount ?? 0).toLocaleString('en-IN')}
                </div>
                <StatusChip status={p.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
