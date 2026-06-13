import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../api';
import { fmtRs, fmtDateTime } from '../lib/format';
import {
  FileBarChart,
  Download,
  CheckCircle2,
  XCircle,
  Search,
  TrendingUp,
  Users,
  IndianRupee,
  Clock,
} from 'lucide-react';

type Tab = 'paid' | 'unpaid';

function monthRange(monthsAgo = 0): { from: string; to: string } {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo, 1);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('paid');
  const [from, setFrom] = useState(monthRange().from);
  const [to, setTo] = useState(monthRange().to);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const params: Record<string, string> = {
    payment_filter: tab,
    status: '',
    per_page: String(perPage),
    page: String(page),
  };
  if (tab === 'paid') {
    params.paid_from = from;
    params.paid_to = to;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['reports-customers', tab, params, search],
    queryFn: async () => (await customersApi.list(params)).data,
  });

  const customers: Array<Record<string, unknown>> = data?.customers || [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const totalPaidAmount = data?.total_paid_amount ?? 0;

  // Filter by search client-side (since API doesn't have text search for this)
  const filtered = search
    ? customers.filter(
        (c) =>
          String(c.name || '').toLowerCase().includes(search.toLowerCase()) ||
          String(c.customer_id || '').toLowerCase().includes(search.toLowerCase()) ||
          String(c.stb_no || '').toLowerCase().includes(search.toLowerCase()) ||
          String(c.area || '').toLowerCase().includes(search.toLowerCase()),
      )
    : customers;

  // Sort paid customers by payment date descending (most recent first)
  const sorted = tab === 'paid'
    ? [...filtered].sort((a, b) => {
        const da = String(a.payment_date || '');
        const db = String(b.payment_date || '');
        return db.localeCompare(da);
      })
    : filtered;

  // Unpaid count and pending amount for stat cards
  const unpaidCount = tab === 'unpaid' ? total : 0;
  const unpaidPending = tab === 'unpaid'
    ? customers.reduce((sum, c) => sum + Number(c.plan_amount || 0), 0)
    : 0;

  function exportCSV() {
    if (!sorted.length) return;
    if (tab === 'paid') {
      downloadCSV(
        `paid-customers-${from}_to_${to}.csv`,
        sorted.map((c) => ({
          ID: c.customer_id,
          Name: c.name,
          STB: c.stb_no || '',
          Phone: c.phone || '',
          Area: c.area || '',
          Amount: c.paid_amount || '',
          Mode: c.payment_mode || '',
          Date: c.payment_date || '',
          CollectedBy: c.collected_by || '',
        })),
      );
    } else {
        downloadCSV(
        `unpaid-customers.csv`,
        sorted.map((c) => ({
          ID: c.customer_id,
          Name: c.name,
          STB: c.stb_no || '',
          Phone: c.phone || '',
          Area: c.area || '',
          Plan: c.plan_name || '',
          PlanAmount: c.plan_amount || '',
        })),
      );
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px',
    borderRadius: 'var(--radius-xs)',
    border: '0.5px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text)',
    fontSize: '0.82rem',
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
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
          <FileBarChart style={{ width: 28, height: 28 }} /> Reports
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          Paid and Unpaid customer details
        </p>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
        <TabButton active={tab === 'paid'} onClick={() => { setTab('paid'); setPage(1); setSearch(''); }} icon={CheckCircle2} label="Paid" color="#34c759" />
        <TabButton active={tab === 'unpaid'} onClick={() => { setTab('unpaid'); setPage(1); setSearch(''); }} icon={XCircle} label="Unpaid" color="#ff3b30" />
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {tab === 'paid' ? (
          <>
            <StatCard icon={Users} label="Paid Customers" value={String(total)} color="#34c759" />
            <StatCard icon={IndianRupee} label="Total Collected" value={fmtRs(totalPaidAmount)} color="#0071e3" />
            <StatCard icon={TrendingUp} label="Avg per Customer" value={total > 0 ? fmtRs(Math.round(totalPaidAmount / total)) : '--'} color="#ff9f0a" />
          </>
        ) : (
          <>
            <StatCard icon={Users} label="Unpaid Customers" value={String(unpaidCount)} color="#ff3b30" />
            <StatCard icon={IndianRupee} label="Pending Amount" value={fmtRs(unpaidPending)} color="#ff9f0a" />
            <StatCard icon={Clock} label="Collection Rate" value={unpaidCount > 0 ? `${Math.round((1 - unpaidCount / (unpaidCount + Number(data?.total || 0))) * 0)}%` : '--'} color="#0071e3" />
          </>
        )}
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {tab === 'paid' && (
          <>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={inputStyle} />
            <span style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>to</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={inputStyle} />
            {/* Quick month pills */}
            {[0, 1].map((m) => {
              const r = monthRange(m);
              const active = from === r.from && to === r.to;
              return (
                <button
                  key={m}
                  onClick={() => { setFrom(r.from); setTo(r.to); setPage(1); }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    border: active ? 'none' : '0.5px solid var(--border)',
                    background: active ? '#0071e3' : 'transparent',
                    color: active ? '#fff' : 'var(--text-light)',
                    cursor: 'pointer',
                  }}
                >
                  {m === 0 ? 'This Month' : 'Last Month'}
                </button>
              );
            })}
          </>
        )}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search style={{ width: 16, height: 16, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ID, STB, area..."
            className="glass-input"
            style={{ padding: '7px 12px 7px 36px', fontSize: '0.82rem', width: 240 }}
          />
        </div>
        <button
          onClick={exportCSV}
          disabled={!sorted.length}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: '#0071e3',
            color: '#fff',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: sorted.length ? 'pointer' : 'not-allowed',
            opacity: sorted.length ? 1 : 0.5,
          }}
        >
          <Download style={{ width: 14, height: 14 }} /> CSV
        </button>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div style={{ width: 36, height: 36, border: '4px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
            {tab === 'paid' ? 'No paid customers in this period' : 'No unpaid customers found'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                {tab === 'paid' ? (
                  <tr>
                    <th>Customer</th>
                    <th>STB</th>
                    <th>Area</th>
                    <th>Amount</th>
                    <th>Mode</th>
                    <th>Date</th>
                    <th>Collected By</th>
                  </tr>
                ) : (
                  <tr>
                    <th>Customer</th>
                    <th>STB</th>
                    <th>Phone</th>
                    <th>Area</th>
                    <th>Plan</th>
                    <th>Amount</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {sorted.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <div>
                        <p style={{ fontWeight: 500, color: 'var(--text)' }}>{String(c.name || '--')}</p>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>{String(c.customer_id || '')}</p>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{String(c.stb_no || '--')}</td>
                    {tab === 'paid' ? (
                      <>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{String(c.area || '--')}</td>
                        <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(Number(c.paid_amount) || 0)}</td>
                        <td>
                          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 500, background: 'rgba(0,113,227,0.08)', color: '#0071e3' }}>
                            {String(c.payment_mode || '--')}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{fmtDateTime(String(c.payment_date || ''))}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{String(c.collected_by || '--')}</td>
                      </>
                    ) : (
                      <>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{String(c.phone || '--')}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{String(c.area || '--')}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{String(c.plan_name || '--')}</td>
                        <td style={{ fontWeight: 600, color: '#ff3b30' }}>{fmtRs(Number(c.plan_amount) || 0)}</td>
                      </>
                    )}
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
            style={pageNumBtn(page > 1)}
          >
            Previous
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
            Page {page} of {totalPages} ({total} customers)
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            style={pageNumBtn(page < totalPages)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, color }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '10px 16px',
        borderRadius: 'var(--radius-xs)',
        fontSize: '0.88rem',
        fontWeight: 600,
        border: 'none',
        cursor: 'pointer',
        background: active ? 'var(--bg-primary)' : 'transparent',
        color: active ? color : 'var(--text-light)',
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
        transition: 'all 0.2s',
      }}
    >
      <Icon style={{ width: 16, height: 16 }} />
      {label}
    </button>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="glass-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ padding: 10, borderRadius: 'var(--radius-xs)', background: `${color}1a` }}>
        <Icon style={{ width: 20, height: 20, color }} />
      </div>
      <div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
        <p style={{ fontSize: '1.2rem', fontWeight: 700, color, marginTop: 2 }}>{value}</p>
      </div>
    </div>
  );
}

function pageNumBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 'var(--radius-xs)',
    border: '0.5px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: '0.82rem',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
  };
}
