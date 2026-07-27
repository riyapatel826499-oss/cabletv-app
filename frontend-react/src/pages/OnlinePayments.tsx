import { useQuery } from '@tanstack/react-query';
import { onlinePaymentsApi } from '../api';

type OnlinePayment = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  customer_id: string | null;
  customer_name: string | null;
  month: string | null;
  amount: number;
  status: string;
  error: string | null;
  created_at: string;
};

type OnlinePaymentsResponse = {
  count: number;
  summary: Record<string, number>;
  payments: OnlinePayment[];
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  recorded:      { label: 'Recorded',      color: '#137a3f', bg: '#e7f8ee' },
  needs_review:  { label: 'Needs Review',  color: '#b91c1c', bg: '#fdeaea' },
  no_customer_id:{ label: 'No Customer ID',color: '#92400e', bg: '#fef6e7' },
  captured:      { label: 'Captured',      color: '#1e40af', bg: '#dbeafe' },
};

function statusBadge(status: string) {
  const s = STATUS_LABEL[status] || { label: status, color: '#1d1d1f', bg: '#f3f4f6' };
  return (
    <span
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: '0.72rem',
        fontWeight: 600, background: s.bg, color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

export default function OnlinePayments() {
  const { data, isLoading } = useQuery<OnlinePaymentsResponse>({
    queryKey: ['online-payments'],
    queryFn: async () => (await onlinePaymentsApi.list()).data,
    refetchInterval: 30_000,
  });

  const summary = data?.summary ?? {};
  const payments = data?.payments ?? [];

  const summaryChips = [
    { key: 'recorded',       label: 'Recorded',       count: summary.recorded ?? 0,       bg: '#e7f8ee', color: '#137a3f' },
    { key: 'needs_review',  label: 'Needs Review',   count: summary.needs_review ?? 0,   bg: '#fdeaea', color: '#b91c1c' },
    { key: 'no_customer_id',label: 'No Customer ID',  count: summary.no_customer_id ?? 0, bg: '#fef6e7', color: '#92400e' },
    { key: 'captured',      label: 'Captured',        count: summary.captured ?? 0,       bg: '#dbeafe', color: '#1e40af' },
  ];

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text)' }}>Online Payments</h1>
      <p className="text-sm mb-4" style={{ color: 'var(--text-light)' }}>
        Razorpay webhook activity — auto-refreshes every 30 seconds
      </p>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div
          className="rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}
        >
          Total: {data?.count ?? 0}
        </div>
        {summaryChips.map((c) => (
          <div
            key={c.key}
            className="rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: c.bg, color: c.color }}
          >
            {c.label}: {c.count}
          </div>
        ))}
      </div>

      {/* Payments list */}
      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-light)' }}>Loading…</div>
      ) : payments.length === 0 ? (
        <div
          className="rounded-lg p-6 text-center text-sm"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-light)' }}
        >
          No online payments yet. Configure the Razorpay webhook at{' '}
          <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>Settings → Webhooks</span> —
          URL: <code>https://wasool.co.in/api/razorpay/webhook</code>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {payments.map((p) => (
            <div
              key={p.razorpay_payment_id}
              className="rounded-lg p-3"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-sm truncate">
                  {p.customer_name || p.customer_id || (
                    <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>No customer</span>
                  )}
                </span>
                {statusBadge(p.status)}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-light)' }}>
                {p.amount != null && (
                  <span>₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                )}
                {p.month && <span>Month: {p.month}</span>}
                {p.razorpay_payment_id && (
                  <span className="truncate" style={{ maxWidth: 160 }}>ID: {p.razorpay_payment_id}</span>
                )}
                {p.created_at && (
                  <span>
                    {new Date(p.created_at).toLocaleString('en-IN', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
              {p.status === 'needs_review' && p.error && (
                <div className="mt-1 text-xs" style={{ color: '#b91c1c' }}>
                  Error: {p.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
