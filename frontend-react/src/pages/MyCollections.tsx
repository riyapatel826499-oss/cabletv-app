import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api';
import { fmtDate } from '../lib/format';
import { Wallet, TrendingUp, Download } from 'lucide-react';
import Rs from '../components/Rs';

export default function MyCollections() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  const params: Record<string, string> = { page: String(page), per_page: '20' };
  if (fromDate) params.from_date = fromDate;
  if (toDate) params.to_date = toDate;

  const { data: resp, isLoading } = useQuery({
    queryKey: ['my-collections', params],
    queryFn: async () => (await reportsApi.myCollections(params)).data,
  });

  const totalCollected = resp?.total_collected ?? 0;
  const paymentCount = resp?.payment_count ?? 0;
  const avgCollection = paymentCount > 0 ? Math.round(totalCollected / paymentCount) : 0;
  const payments: Array<Record<string, unknown>> = resp?.payments || [];
  const totalPages = resp?.total_pages ?? 1;

  function exportCSV() {
    if (!payments.length) return;
    const headers = ['Customer', 'Area', 'Amount', 'Mode', 'Date', 'Source'];
    const rows = payments.map((p) => [
      String(p.customer_name || ''),
      String(p.area || ''),
      String(p.amount || ''),
      String(p.mode || ''),
      String(p.date || ''),
      String(p.source || ''),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-collections-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 'var(--radius-xs)',
    border: '0.5px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text)',
    fontSize: '0.85rem',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    borderRadius: 'var(--radius-sm)',
    border: '0.5px solid var(--border)',
    padding: '16px 20px',
    flex: 1,
    minWidth: 160,
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          My Collections
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 2 }}>
          Your personal collection summary and history
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 'var(--radius-xs)', background: 'rgba(52,199,89,0.1)' }}>
              <Wallet style={{ width: 22, height: 22, color: '#34c759' }} />
            </div>
            <div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total Collected
              </p>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#34c759' }}><Rs amount={totalCollected} /></p>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 'var(--radius-xs)', background: 'rgba(0,113,227,0.1)' }}>
              <Wallet style={{ width: 22, height: 22, color: '#0071e3' }} />
            </div>
            <div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Payments Made
              </p>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}>{paymentCount}</p>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 'var(--radius-xs)', background: 'rgba(255,159,10,0.1)' }}>
              <TrendingUp style={{ width: 22, height: 22, color: '#ff9f0a' }} />
            </div>
            <div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Avg per Payment
              </p>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}><Rs amount={avgCollection} /></p>
            </div>
          </div>
        </div>
      </div>

      {/* Date Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>From</label>
        <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} style={inputStyle} />
        <label style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>To</label>
        <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} style={inputStyle} />
        {(fromDate || toDate) && (
          <button
            onClick={() => { setFromDate(''); setToDate(''); setPage(1); }}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-xs)',
              border: '0.5px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
        <button
          onClick={exportCSV}
          disabled={!payments.length}
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: '#0071e3',
            color: '#fff',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: payments.length ? 'pointer' : 'not-allowed',
            opacity: payments.length ? 1 : 0.5,
          }}
        >
          <Download style={{ width: 14, height: 14 }} /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div
              style={{
                width: 36,
                height: 36,
                border: '4px solid rgba(0,113,227,0.2)',
                borderTopColor: '#0071e3',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
        ) : payments.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
            No collections found. Payments you collect will appear here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Area</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Source</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{String(p.customer_name || '--')}</td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>{String(p.area || '--')}</td>
                    <td style={{ fontWeight: 600, color: '#34c759' }}>
                      <Rs amount={Number(p.amount) || 0} />
                    </td>
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
                        {String(p.mode || '--')}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: '0.72rem',
                          fontWeight: 500,
                          background:
                            String(p.source) === 'paypakka' ? 'rgba(255,159,10,0.08)' : 'rgba(52,199,89,0.08)',
                          color: String(p.source) === 'paypakka' ? '#ff9f0a' : '#34c759',
                        }}
                      >
                        {String(p.source || '--')}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>
                      {fmtDate(String(p.date || ''))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-xs)',
              border: '0.5px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: '0.82rem',
              cursor: page > 1 ? 'pointer' : 'not-allowed',
              opacity: page > 1 ? 1 : 0.5,
            }}
          >
            Previous
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-xs)',
              border: '0.5px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: '0.82rem',
              cursor: page < totalPages ? 'pointer' : 'not-allowed',
              opacity: page < totalPages ? 1 : 0.5,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
