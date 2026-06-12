import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { paymentsApi } from '../api';
import type { Payment } from '../types';
import { fmtRs, fmtDate } from '../lib/format';
import { Search, ChevronLeft, ChevronRight, CreditCard, Plus } from 'lucide-react';

const PER_PAGE = 25;

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

interface PaymentsResponse {
  payments: Payment[];
  total: number;
  page: number;
  per_page: number;
}

export default function Payments() {
  const defaults = useMemo(() => monthRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useQuery({
    queryKey: ['payments', { from, to, debounced, page }],
    queryFn: async () => {
      const params: Record<string, string> = {
        start_date: from,
        end_date: to,
        page: String(page),
        per_page: String(PER_PAGE),
      };
      if (debounced) params.search = debounced;
      return (await paymentsApi.list(params)).data as PaymentsResponse;
    },
    placeholderData: keepPreviousData,
  });

  const payments = data?.payments ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Payments
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            {total} payments this period &middot; {fmtRs(totalAmount)} collected
          </p>
        </div>
        <Link
          to="/payments/new"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 18px',
            borderRadius: 'var(--radius-sm)',
            background: '#0071e3',
            color: '#fff',
            fontSize: '0.88rem',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
            transition: 'var(--transition)',
          }}
        >
          <Plus style={{ width: 16, height: 16 }} /> Record Payment
        </Link>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 500, marginRight: 6 }}>From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="glass-input"
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-xs)', fontSize: '0.85rem' }}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 500, marginRight: 6 }}>To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="glass-input"
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-xs)', fontSize: '0.85rem' }}
          />
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 18,
              height: 18,
              color: 'var(--text-light)',
            }}
          />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="glass-input"
            style={{ paddingLeft: 40, width: '100%', padding: '8px 16px 8px 40px', borderRadius: 'var(--radius-xs)', fontSize: '0.85rem' }}
            placeholder="Search customer or reference..."
          />
        </div>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {payments.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
            <CreditCard style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.5 }} />
            {isFetching ? 'Loading...' : 'No payments in this period'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Month</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{p.customer_name || '--'}</td>
                    <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(Number(p.amount) || 0)}</td>
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
                    <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>
                      {fmtDate(p.collected_at || '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '0.5px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--radius-xs)',
                border: '0.5px solid var(--border)',
                background: 'var(--bg-secondary)',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                color: 'var(--text)',
                opacity: page <= 1 ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.82rem',
              }}
            >
              <ChevronLeft style={{ width: 16, height: 16 }} /> Prev
            </button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-light)', padding: '0 12px' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--radius-xs)',
                border: '0.5px solid var(--border)',
                background: 'var(--bg-secondary)',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                color: 'var(--text)',
                opacity: page >= totalPages ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.82rem',
              }}
            >
              Next <ChevronRight style={{ width: 16, height: 16 }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
