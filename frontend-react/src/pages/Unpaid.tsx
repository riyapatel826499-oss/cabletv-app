import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { customersApi } from '../api';
import { fmtRs, fmtDate } from '../lib/format';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Search, Users, IndianRupee, ChevronLeft, ChevronRight } from 'lucide-react';
import StbCopy from '../components/StbCopy';

interface UnpaidCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  area?: string;
  stb_no?: string;
  plan_name?: string;
  plan_amount?: number;
  expiry_date?: string;
  gap_months?: number;
  pending_amount?: number;
  mso?: string;
}

interface UnpaidResponse {
  customers: UnpaidCustomer[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  areas: string[];
  as_of: string;
}

function asOfDate(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

export default function Unpaid() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [page, setPage] = useState(1);
  const [asOf, setAsOf] = useState(asOfDate(0));
  const [asOfLabel, setAsOfLabel] = useState('today');
  const perPage = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['unpaid', q, area, page, asOf],
    queryFn: async () => (await customersApi.unpaid({
      q, area, page: String(page), per_page: String(perPage), as_of: asOf,
    })).data as UnpaidResponse,
    placeholderData: keepPreviousData,
  });

  function quickFilter(monthsAgo: number, label: string) {
    setAsOf(asOfDate(monthsAgo));
    setAsOfLabel(label);
    setPage(1);
  }

  const totalPending = data?.customers?.reduce((s, c) => s + (c.pending_amount || 0), 0) ?? 0;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle style={{ width: 28, height: 28, color: '#ff3b30' }} />
          Unpaid Customers
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          Customers with expired subscriptions as of {fmtDate(asOf)}
        </p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,59,48,0.1)' }}>
            <Users style={{ width: 22, height: 22, color: '#ff3b30' }} />
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Unpaid</p>
            <p style={{ fontSize: '1.4rem', fontWeight: 700, color: '#ff3b30', marginTop: 2 }}>{data?.total ?? '--'}</p>
          </div>
        </div>
        <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,159,10,0.1)' }}>
            <IndianRupee style={{ width: 22, height: 22, color: '#ff9f0a' }} />
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pending Amount</p>
            <p style={{ fontSize: '1.4rem', fontWeight: 700, color: '#ff9f0a', marginTop: 2 }}>{fmtRs(totalPending)}</p>
          </div>
        </div>
      </div>

      {/* Quick date filters */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { monthsAgo: 0, label: 'Today' },
          { monthsAgo: 1, label: 'Last Month' },
          { monthsAgo: 2, label: '2 Months Ago' },
          { monthsAgo: 3, label: '3 Months Ago' },
        ].map(f => {
          const active = asOfLabel === f.label;
          return (
            <button
              key={f.label}
              onClick={() => quickFilter(f.monthsAgo, f.label)}
              style={{
                padding: '6px 16px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 500,
                border: active ? 'none' : '0.5px solid var(--border)',
                background: active ? '#0071e3' : 'transparent',
                color: active ? '#fff' : 'var(--text-light)',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 250px', position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'var(--text-light)' }} />
          <input
            type="text"
            placeholder="Search by name, phone, or STB..."
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            style={{
              width: '100%', padding: '10px 12px 10px 40px', borderRadius: 12,
              border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
              color: 'var(--text)', fontSize: '0.88rem',
            }}
          />
        </div>
        <select
          value={area}
          onChange={e => { setArea(e.target.value); setPage(1); }}
          style={{
            padding: '10px 14px', borderRadius: 12, border: '0.5px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer',
          }}
        >
          <option value="">All Areas</option>
          {data?.areas?.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="glass-card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ width: 32, height: 32, border: '3px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          </div>
        ) : isError ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#ff3b30' }}>
            <AlertCircle style={{ width: 32, height: 32, margin: '0 auto 8px' }} />
            Failed to load unpaid customers
          </div>
        ) : !data?.customers?.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
            No unpaid customers found
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>STB</th>
                  <th>Area</th>
                  <th>Plan</th>
                  <th>Expiry</th>
                  <th>Gap</th>
                  <th style={{ textAlign: 'right' }}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <span
                        style={{ fontWeight: 500, color: '#0071e3', cursor: 'pointer' }}
                        onClick={() => navigate(`/customers/${c.customer_id}`)}
                      >
                        {c.name || '--'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{c.phone || '--'}</td>
                    <td style={{ fontSize: '0.82rem' }}>{c.stb_no ? <StbCopy stb={c.stb_no} prefix="" /> : '--'}</td>
                    <td>{c.area || '--'}</td>
                    <td>
                      {c.plan_name ? (
                        <span style={{ fontSize: '0.82rem' }}>{c.plan_name}</span>
                      ) : '--'}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{c.expiry_date ? fmtDate(c.expiry_date) : '--'}</td>
                    <td>
                      {c.gap_months ? (
                        <span style={{
                          padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
                          background: c.gap_months >= 3 ? 'rgba(255,59,48,0.1)' : 'rgba(255,159,10,0.1)',
                          color: c.gap_months >= 3 ? '#ff3b30' : '#ff9f0a',
                        }}>
                          {c.gap_months}m
                        </span>
                      ) : '--'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#ff3b30' }}>
                      {c.pending_amount ? fmtRs(c.pending_amount) : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div style={{ padding: '12px 24px', borderTop: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>
              Page {data.page} of {data.total_pages} ({data.total} customers)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8,
                  border: '0.5px solid var(--border)', background: 'transparent',
                  color: page <= 1 ? 'var(--text-light)' : 'var(--text)', cursor: page <= 1 ? 'default' : 'pointer',
                  opacity: page <= 1 ? 0.5 : 1, fontSize: '0.82rem',
                }}
              >
                <ChevronLeft style={{ width: 16, height: 16 }} /> Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(data.total_pages, p + 1))}
                disabled={page >= data.total_pages}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8,
                  border: '0.5px solid var(--border)', background: 'transparent',
                  color: page >= data.total_pages ? 'var(--text-light)' : 'var(--text)', cursor: page >= data.total_pages ? 'default' : 'pointer',
                  opacity: page >= data.total_pages ? 0.5 : 1, fontSize: '0.82rem',
                }}
              >
                Next <ChevronRight style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
