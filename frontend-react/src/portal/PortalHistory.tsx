import { useQuery } from '@tanstack/react-query';
import api from './portalApi';

type PaymentRecord = {
  id: number;
  amount: number;
  mode: string;
  type: string;
  month_year: string | null;
  date: string | null;
  notes: string | null;
  source: 'local' | 'paypakka';
};

type PaymentsRes = {
  count: number;
  payments: PaymentRecord[];
};

const modeColors: Record<string, string> = {
  'Cash': '#059669',
  'GPay': '#1e40af',
  'PhonePe': '#7c3aed',
  'Online (Razorpay)': '#5aa2ff',
  'Paypakka': '#92400e',
};

function modeColor(mode: string) {
  for (const [k, v] of Object.entries(modeColors)) {
    if (mode.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return '#6b7280';
}

export default function PortalHistory() {
  const { data, isLoading } = useQuery<PaymentsRes>({
    queryKey: ['portal-payments'],
    queryFn: async () => (await api.get('/payments')).data,
  });

  const payments = data?.payments ?? [];

  const shareRecept = (p: PaymentRecord) => {
    const lines = [
      `Payment Receipt`,
      `Amount: Rs.${p.amount}`,
      `Mode: ${p.mode}`,
      p.month_year ? `Month: ${p.month_year}` : '',
      p.date ? `Date: ${new Date(p.date).toLocaleString('en-IN')}` : '',
      p.notes ? `Notes: ${p.notes}` : '',
    ].filter(Boolean);
    const text = encodeURIComponent(lines.join('\n'));
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 4 }}>Payment History</h2>
      <p style={{ fontSize: '0.8rem', color: '#86868b', marginBottom: 16 }}>
        {data?.count ?? 0} payment{data?.count !== 1 ? 's' : ''} recorded
      </p>

      {isLoading ? (
        <div style={{ textAlign: 'center', color: '#86868b', padding: 20 }}>Loading\u2026</div>
      ) : payments.length === 0 ? (
        <div
          style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
            padding: 24, textAlign: 'center', fontSize: '0.85rem', color: '#86868b',
          }}
        >
          No payments recorded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {payments.map((p) => (
            <div
              key={`${p.source}-${p.id}`}
              style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>\u20b9{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                <span
                  style={{
                    fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                    color: modeColor(p.mode), background: `${modeColor(p.mode)}16`,
                  }}
                >
                  {p.mode}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 4 }}>
                {p.month_year ? `Month: ${p.month_year}` : ''}
                {p.date ? ` \u00b7 ${new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
              </div>
              {p.notes && (
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>{p.notes}</div>
              )}
              <button
                onClick={() => shareRecept(p)}
                style={{
                  marginTop: 8, padding: '6px 12px', borderRadius: 8, border: '1px solid #25D366',
                  background: 'transparent', color: '#128C4B', fontSize: '0.75rem', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Share on WhatsApp
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
