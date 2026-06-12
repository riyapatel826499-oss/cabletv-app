import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { customersApi } from '../api';
import type { CustomerListItem } from '../types';
import { Search, ChevronLeft, ChevronRight, Users } from 'lucide-react';

const PER_PAGE = 20;

interface ListResponse {
  customers: CustomerListItem[];
  total: number;
  page: number;
  per_page: number;
}

function StatusBadge({ status }: { status?: string }) {
  const active = (status || '').toLowerCase() === 'active';
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: '0.72rem',
        fontWeight: 500,
        background: active ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
        color: active ? '#34c759' : '#ff3b30',
      }}
    >
      {status || '--'}
    </span>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useQuery({
    queryKey: ['customers', { debounced, status, page }],
    queryFn: async () => {
      if (debounced) {
        const rows = (await customersApi.search(debounced)).data as CustomerListItem[];
        return { customers: rows, total: rows.length, page: 1, per_page: rows.length } as ListResponse;
      }
      const params: Record<string, string> = { page: String(page), per_page: String(PER_PAGE) };
      if (status) params.status = status;
      return (await customersApi.list(params)).data as ListResponse;
    },
    placeholderData: keepPreviousData,
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const totalPages = debounced ? 1 : Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Customers
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            {total} {total === 1 ? 'customer' : 'customers'} total
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
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
            style={{ paddingLeft: 40, width: '100%', padding: '10px 16px 10px 40px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}
            placeholder="Search by name, phone, or STB number..."
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="glass-input"
          style={{ padding: '10px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="disconnected">Disconnected</option>
        </select>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {customers.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
            <Users style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.5 }} />
            {isFetching ? 'Loading...' : 'No customers found'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Area</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr
                    key={c.customer_id}
                    onClick={() => navigate(`/customers/${c.customer_id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontWeight: 500 }}>
                      {c.name}
                      {c.stb_no && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-light)', display: 'block', marginTop: 2 }}>
                          STB: {c.stb_no}
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-light)' }}>{c.phone || '--'}</td>
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {c.plan_amount ? `\u20B9${c.plan_amount}` : '--'}
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{c.area || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!debounced && totalPages > 1 && (
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
                transition: 'var(--transition)',
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
                transition: 'var(--transition)',
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
