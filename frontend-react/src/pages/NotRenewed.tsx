import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { customersApi } from '../api';
import { fmtRs, fmtDate } from '../lib/format';
import StbCopy from '../components/StbCopy';
import {
  UserX,
  Search,
  Download,
  AlertCircle,
  Calendar,
} from 'lucide-react';

interface NotRenewedCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  area?: string;
  stb_no?: string;
  plan_name?: string;
  plan_amount?: number;
  expiry_date?: string;
  last_payment_date?: string;
}

interface NotRenewedResponse {
  customers: NotRenewedCustomer[];
  total: number;
  total_amount: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Build the last 7 months options (current + 6 prior) as YYYY-MM.
function buildMonthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

function toCsv(rows: NotRenewedCustomer[]): string {
  const header = ['Name', 'Phone', 'STB', 'Area', 'Plan', 'Expiry Date', 'Amount'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    lines.push(
      [
        cell(r.name),
        cell(r.phone),
        cell(r.stb_no),
        cell(r.area),
        cell(r.plan_name),
        cell(r.expiry_date ? fmtDate(r.expiry_date) : ''),
        cell(r.plan_amount ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NotRenewed() {
  const navigate = useNavigate();
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [month, setMonth] = useState(monthOptions[0].value);
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['not-renewed', month],
    queryFn: async () =>
      (await customersApi.notRenewed(month)).data as NotRenewedResponse,
  });

  const all = data?.customers ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? all.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q) ||
          (c.stb_no || '').toLowerCase().includes(q),
      )
    : all;

  const total = data?.total ?? 0;
  const totalAmount = data?.total_amount ?? all.reduce((s, c) => s + (c.plan_amount || 0), 0);

  function handleExport() {
    downloadCsv(`not-renewed-${month}.csv`, toCsv(filtered));
  }

  const monthLabel = monthOptions.find((m) => m.value === month)?.label ?? month;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1
            style={{
              fontSize: '1.4rem',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <UserX style={{ width: 28, height: 28, color: '#ff9f0a' }} />
            Not Renewed
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            Customers who haven't renewed for {monthLabel}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Calendar
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 16,
                height: 16,
                color: 'var(--text-light)',
                pointerEvents: 'none',
              }}
            />
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="glass-input"
              style={{
                padding: '10px 16px 10px 36px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 16px',
              borderRadius: 'var(--radius-sm)',
              border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)',
              color: filtered.length === 0 ? 'var(--text-light)' : 'var(--text)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
              opacity: filtered.length === 0 ? 0.5 : 1,
            }}
          >
            <Download style={{ width: 16, height: 16 }} /> Export CSV
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,159,10,0.1)' }}>
            <UserX style={{ width: 22, height: 22, color: '#ff9f0a' }} />
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Not Renewed
            </p>
            <p style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{total}</p>
          </div>
        </div>
        <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,59,48,0.1)' }}>
            <UserX style={{ width: 22, height: 22, color: '#ff3b30' }} />
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Lost Revenue
            </p>
            <p style={{ fontSize: '1.4rem', fontWeight: 700, color: '#ff3b30', marginTop: 2 }}>
              {fmtRs(totalAmount)}
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', position: 'relative' }}>
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
            type="text"
            placeholder="Search by name, phone, or STB..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input"
            style={{
              width: '100%',
              padding: '10px 14px 10px 40px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.88rem',
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div
              style={{
                width: 32,
                height: 32,
                border: '3px solid rgba(0,113,227,0.2)',
                borderTopColor: '#0071e3',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto',
              }}
            />
          </div>
        ) : isError ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#ff3b30' }}>
            <AlertCircle style={{ width: 32, height: 32, margin: '0 auto 8px' }} />
            Failed to load not-renewed list
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
            <UserX style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.5 }} />
            {search ? 'No matching customers' : 'No customers in this list'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>STB</th>
                  <th>Area</th>
                  <th>Plan</th>
                  <th>Expiry</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={`${c.customer_id}-${i}`}>
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
                    <td style={{ fontSize: '0.85rem' }}>{c.area || '--'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{c.plan_name || '--'}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                      {c.expiry_date ? fmtDate(c.expiry_date) : '--'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#ff3b30' }}>
                      {c.plan_amount ? fmtRs(c.plan_amount) : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
