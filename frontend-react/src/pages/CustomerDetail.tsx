import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../api';
import { fmtRs, fmtDate } from '../lib/format';
import { ArrowLeft, Phone, MapPin, Wifi, IndianRupee, Clock, Plus } from 'lucide-react';

interface CustomerDetail {
  id: number;
  customer_id: string;
  name: string;
  phone: string;
  phone2?: string;
  address?: string;
  area?: string;
  city: string;
  status: string;
  plan_amount?: number;
  stb_no?: string;
  connections?: Array<{
    id: number;
    stb_no: string;
    type: string;
    status: string;
    package_name?: string;
    amount?: number;
  }>;
  payments?: Array<{
    id: number;
    amount: number;
    payment_mode: string;
    month_year: string;
    collected_at: string;
  }>;
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number | null | undefined }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius-xs)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon style={{ width: 18, height: 18, color: 'var(--text-light)' }} />
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
          {label}
        </p>
        <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)', marginTop: 2 }}>
          {value || '--'}
        </p>
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: customer, isLoading, isError } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await customersApi.get(String(id))).data as CustomerDetail,
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div
          style={{
            width: 40,
            height: 40,
            border: '4px solid rgba(0,113,227,0.2)',
            borderTopColor: '#0071e3',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (isError || !customer) {
    return (
      <div className="glass-card animate-fade-in" style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
        <p>Customer not found</p>
        <Link to="/customers" style={{ color: '#0071e3', marginTop: 8, display: 'inline-block' }}>
          Back to Customers
        </Link>
      </div>
    );
  }

  const active = (customer.status || '').toLowerCase() === 'active';

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '0.5px solid var(--border)',
            background: 'var(--bg-secondary)',
            cursor: 'pointer',
            color: 'var(--text)',
            fontSize: '0.85rem',
            fontWeight: 500,
            transition: 'var(--transition)',
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            {customer.name}
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 2 }}>
            STB: {customer.stb_no || 'N/A'} &middot; ID: {customer.customer_id}
          </p>
        </div>
        <span
          style={{
            padding: '5px 14px',
            borderRadius: 20,
            fontSize: '0.78rem',
            fontWeight: 600,
            background: active ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
            color: active ? '#34c759' : '#ff3b30',
          }}
        >
          {customer.status || 'Unknown'}
        </span>
        <Link
          to="/payments/new"
          state={{ customerId: customer.customer_id, customerName: customer.name }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 18px',
            borderRadius: 'var(--radius-sm)',
            background: '#0071e3',
            color: '#fff',
            fontSize: '0.85rem',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
            transition: 'var(--transition)',
          }}
        >
          <Plus style={{ width: 16, height: 16 }} /> Add Payment
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        {/* Left: Info */}
        <div className="glass-card" style={{ padding: '20px 24px' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
            Customer Info
          </h2>
          <InfoRow icon={Phone} label="Phone" value={customer.phone} />
          <InfoRow icon={MapPin} label="Area" value={customer.area} />
          <InfoRow icon={MapPin} label="Address" value={customer.address} />
          <InfoRow icon={IndianRupee} label="Plan Amount" value={customer.plan_amount ? `\u20B9${customer.plan_amount}/mo` : null} />
        </div>

        {/* Right: Connections + Payments */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Connections */}
          {customer.connections && customer.connections.length > 0 && (
            <div className="glass-card" style={{ padding: '20px 24px' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                Connections ({customer.connections.length})
              </h2>
              {customer.connections.map((conn, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: i < customer.connections!.length - 1 ? '0.5px solid var(--border)' : 'none',
                  }}
                >
                  <Wifi style={{ width: 16, height: 16, color: '#0071e3' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>
                      {conn.type || conn.package_name || 'Connection'}
                    </p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
                      {conn.stb_no} &middot; {conn.status}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
                    {conn.amount ? `\u20B9${conn.amount}` : '--'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Payment History */}
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
                Payment History
              </h2>
            </div>
            {customer.payments && customer.payments.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <th>Amount</th>
                      <th>Mode</th>
                      <th>Month</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.payments.slice(0, 10).map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(p.amount)}</td>
                        <td>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: 20,
                              fontSize: '0.72rem',
                              fontWeight: 500,
                              background: 'rgba(0,113,227,0.08)',
                              color: '#0071e3',
                            }}
                          >
                            {p.payment_mode || '--'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-light)' }}>{p.month_year || '--'}</td>
                        <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>{fmtDate(p.collected_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-light)' }}>
                <Clock style={{ width: 28, height: 28, margin: '0 auto 8px', opacity: 0.4 }} />
                No payment history
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
