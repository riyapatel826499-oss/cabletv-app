import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi, paymentsApi } from '../api';
import { fmtRs, fmtDateTime } from '../lib/format';
import StbCopy from '../components/StbCopy';
import { useAuth } from '../hooks/useAuth';
import {
  FileBarChart,
  Download,
  CheckCircle2,
  XCircle,
  Search,
  TrendingUp,
  Users,
  IndianRupee,
  Trash2,
  X,
  AlertTriangle,
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

interface PaymentRow {
  id: number;
  source: string;
  customer_id: string;
  customer_name: string;
  area: string;
  amount: number;
  payment_mode: string;
  date: string;
  collector: string;
  stb_no: string;
  mso: string;
  deletable: boolean;
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('paid');
  const [from, setFrom] = useState(monthRange().from);
  const [to, setTo] = useState(monthRange().to);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Delete payment state
  const [deleteTarget, setDeleteTarget] = useState<PaymentRow | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteResult, setDeleteResult] = useState<{ old: string; new: string | null } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      return (await paymentsApi.delete(id, reason)).data;
    },
    onSuccess: (data) => {
      setDeleteResult({ old: data.old_expiry || '--', new: data.new_expiry || null });
      queryClient.invalidateQueries({ queryKey: ['reports-paid'] });
    },
    onError: () => {
      alert('Failed to delete payment. Please try again.');
      setDeleteTarget(null);
    },
  });

  // ── PAID tab: individual payment transactions ──
  const paidQ = useQuery({
    queryKey: ['reports-paid', from, to, page, search],
    queryFn: async () =>
      (
        await paymentsApi.list({
          date_from: from,
          date_to: to,
          page: String(page),
          per_page: '50',
          ...(search ? { q: search } : {}),
        })
      ).data,
    enabled: tab === 'paid',
  });

  // ── UNPAID tab: customer list ──
  const unpaidQ = useQuery({
    queryKey: ['reports-unpaid', page],
    queryFn: async () => (await customersApi.list({ payment_filter: 'unpaid', status: '', per_page: '50', page: String(page) })).data,
    enabled: tab === 'unpaid',
  });

  const perPage = 50;
  void perPage;
  const inputStyle: React.CSSProperties = {
    padding: '7px 10px',
    borderRadius: 'var(--radius-xs)',
    border: '0.5px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text)',
    fontSize: '0.82rem',
  };

  const paidPayments: PaymentRow[] = paidQ.data?.payments || [];
  const paidTotal = paidQ.data?.total ?? 0;
  const paidTotalAmount = paidQ.data?.total_amount ?? 0;
  const paidTotalPages = paidQ.data?.total_pages ?? 1;

  const unpaidCustomers: Array<Record<string, unknown>> = unpaidQ.data?.customers || [];
  const unpaidTotal = unpaidQ.data?.total ?? 0;
  const unpaidTotalPages = unpaidQ.data?.total_pages ?? 1;
  const unpaidPending = unpaidCustomers.reduce((s, c) => s + Number(c.plan_amount || 0), 0);

  const [exporting, setExporting] = useState(false);

  async function fetchAllPages<T>(
    fetchPage: (page: number) => Promise<{ data: { total?: number; total_pages?: number; [key: string]: unknown } }>,
    dataKey: string,
  ): Promise<T[]> {
    const first = await fetchPage(1);
    const totalPages = first.data.total_pages ?? 1;
    const all: T[] = ((first.data[dataKey] as T[]) || []);
    for (let p = 2; p <= totalPages; p++) {
      const resp = await fetchPage(p);
      all.push(...((resp.data[dataKey] as T[]) || []));
    }
    return all;
  }

  async function exportPaidCSV() {
    setExporting(true);
    try {
      const allPayments = await fetchAllPages<PaymentRow>(
        (p) => paymentsApi.list({ date_from: from, date_to: to, page: String(p), per_page: '500', ...(search ? { q: search } : {}) }),
        'payments',
      );
      if (!allPayments.length) { alert('No transactions to export'); return; }
      downloadCSV(
        `transactions-${from}_to_${to}${search ? '_filtered' : ''}.csv`,
        allPayments.map((p) => ({
          ID: p.customer_id,
          Name: p.customer_name,
          STB: p.stb_no || '',
          MSO: p.mso || '',
          Area: p.area || '',
          Amount: p.amount,
          Mode: p.payment_mode,
          Date: p.date,
          CollectedBy: p.collector || '',
          Source: p.source,
        })),
      );
    } catch {
      alert('Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function exportUnpaidCSV() {
    setExporting(true);
    try {
      const allUnpaid = await fetchAllPages<Record<string, unknown>>(
        (p) => customersApi.list({ payment_filter: 'unpaid', status: '', per_page: '500', page: String(p), ...(search ? { q: search } : {}) }),
        'customers',
      );
      if (!allUnpaid.length) { alert('No unpaid customers to export'); return; }
      downloadCSV(
        `unpaid-customers${search ? '_filtered' : ''}.csv`,
        allUnpaid.map((c) => ({
          ID: c.customer_id,
          Name: c.name,
          STB: c.stb_no || '',
          Phone: c.phone || '',
          Area: c.area || '',
          Plan: c.plan_name || '',
          Amount: c.plan_amount || '',
        })),
      );
    } catch {
      alert('Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  }

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
          Paid transactions and Unpaid customers
        </p>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
        <TabButton active={tab === 'paid'} onClick={() => { setTab('paid'); setPage(1); setSearch(''); }} icon={CheckCircle2} label="Paid" color="#34c759" />
        <TabButton active={tab === 'unpaid'} onClick={() => { setTab('unpaid'); setPage(1); setSearch(''); }} icon={XCircle} label="Unpaid" color="#ff3b30" />
      </div>

      {/* ── PAID TAB ── */}
      {tab === 'paid' && (
        <>
          {/* Stat Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <StatCard icon={Users} label="Transactions" value={String(paidTotal)} color="#34c759" />
            <StatCard icon={IndianRupee} label="Total Collected" value={fmtRs(paidTotalAmount)} color="#0071e3" />
            <StatCard icon={TrendingUp} label="Avg Amount" value={paidTotal > 0 ? fmtRs(Math.round(paidTotalAmount / paidTotal)) : '--'} color="#ff9f0a" />
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={inputStyle} />
            <span style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>to</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={inputStyle} />
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
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <Search style={{ width: 16, height: 16, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search name, ID, STB..."
                className="glass-input"
                style={{ padding: '7px 12px 7px 36px', fontSize: '0.82rem', width: 220 }}
              />
            </div>
            <button
              onClick={exportPaidCSV}
              disabled={!paidPayments.length || exporting}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 'var(--radius-xs)',
                border: 'none', background: '#0071e3', color: '#fff',
                fontSize: '0.82rem', fontWeight: 600,
                cursor: (!paidPayments.length || exporting) ? 'not-allowed' : 'pointer',
                opacity: (!paidPayments.length || exporting) ? 0.5 : 1,
              }}
            >
              <Download style={{ width: 14, height: 14 }} /> {exporting ? 'Exporting...' : 'CSV'}
            </button>
          </div>

          {/* Cards */}
          {paidQ.isLoading ? (
            <Spinner />
          ) : paidPayments.length === 0 ? (
            <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>No transactions in this period</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {paidPayments.map((p, i) => (
                <div key={i} className="glass-card" style={{ padding: '14px 16px', borderLeft: '3px solid #34c759' }}>
                  {/* Top row: name + amount */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.95rem' }}>{p.customer_name || '--'}</p>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span>{p.customer_id}</span>{(p as any).stb_no ? <><span>.</span><StbCopy stb={(p as any).stb_no} prefix="STB " /></> : null}
                      </p>
                    </div>
                    <p style={{ fontSize: '1.15rem', fontWeight: 700, color: '#34c759', whiteSpace: 'nowrap' }}>{fmtRs(p.amount)}</p>
                  </div>
                  {/* Bottom row: badges + meta */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 500, background: 'rgba(0,113,227,0.08)', color: '#0071e3' }}>
                      {p.payment_mode}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: p.source === 'Local' ? '#34c759' : 'var(--text-light)', padding: '1px 6px', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                      {p.source}
                    </span>
                    {p.area && <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{p.area}</span>}
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginLeft: 'auto' }}>{fmtDateTime(p.date)}</span>
                    {(user?.role === 'admin' || user?.role === 'master') && p.deletable && (
                      <button
                        onClick={() => { setDeleteTarget(p); setDeleteReason(''); setDeleteResult(null); }}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, display: 'inline-flex', marginLeft: 4 }}
                        title="Delete transaction"
                      >
                        <Trash2 style={{ width: 15, height: 15, color: '#ff3b30' }} />
                      </button>
                    )}
                  </div>
                  {p.collector && (
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 6 }}>Collected by {p.collector}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {paidTotalPages > 1 && (
            <Pagination page={page} totalPages={paidTotalPages} total={paidTotal} setPage={setPage} />
          )}
        </>
      )}

      {/* ── UNPAID TAB ── */}
      {tab === 'unpaid' && (
        <>
          {/* Stat Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <StatCard icon={Users} label="Unpaid Customers" value={String(unpaidTotal)} color="#ff3b30" />
            <StatCard icon={IndianRupee} label="Pending Amount" value={fmtRs(unpaidPending)} color="#ff9f0a" />
          </div>

          {/* Search + Export */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative', marginRight: 'auto' }}>
              <Search style={{ width: 16, height: 16, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="glass-input"
                style={{ padding: '7px 12px 7px 36px', fontSize: '0.82rem', width: 220 }}
              />
            </div>
            <button
              onClick={exportUnpaidCSV}
              disabled={!unpaidCustomers.length || exporting}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 'var(--radius-xs)',
                border: 'none', background: '#0071e3', color: '#fff',
                fontSize: '0.82rem', fontWeight: 600,
                cursor: (!unpaidCustomers.length || exporting) ? 'not-allowed' : 'pointer',
                opacity: (!unpaidCustomers.length || exporting) ? 0.5 : 1,
              }}
            >
              <Download style={{ width: 14, height: 14 }} /> {exporting ? 'Exporting...' : 'CSV'}
            </button>
          </div>

          {/* Cards */}
          {unpaidQ.isLoading ? (
            <Spinner />
          ) : unpaidCustomers.length === 0 ? (
            <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>No unpaid customers found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {unpaidCustomers
                .filter((c) =>
                  !search ||
                  String(c.name || '').toLowerCase().includes(search.toLowerCase()) ||
                  String(c.customer_id || '').toLowerCase().includes(search.toLowerCase()),
                )
                .map((c, i) => {
                  const phone = String(c.phone || '');
                  const area = String(c.area || '');
                  const plan = String(c.plan_name || '');
                  return (
                  <div key={i} className="glass-card" style={{ padding: '14px 16px', borderLeft: '3px solid #ff3b30' }}>
                    {/* Top row: name + amount */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.95rem' }}>{String(c.name || '--')}</p>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <span>{String(c.customer_id || '')}</span>{(c as any).stb_no ? <><span>.</span><StbCopy stb={String((c as any).stb_no)} prefix="STB " /></> : null}
                        </p>
                      </div>
                      <p style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ff3b30', whiteSpace: 'nowrap' }}>{fmtRs(Number(c.plan_amount) || 0)}</p>
                    </div>
                    {/* Bottom row: meta */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
                      {phone && (
                        <a href={`tel:${phone}`} style={{ fontSize: '0.75rem', color: '#0071e3', textDecoration: 'none', fontWeight: 500 }}>
                          {phone}
                        </a>
                      )}
                      {area && <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{area}</span>}
                      {plan && <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginLeft: 'auto' }}>{plan}</span>}
                    </div>
                  </div>
                  );
                })}
            </div>
          )}

          {unpaidTotalPages > 1 && (
            <Pagination page={page} totalPages={unpaidTotalPages} total={unpaidTotal} setPage={setPage} />
          )}
        </>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      {deleteTarget && (
        <div
          onClick={() => { if (!deleteMutation.isPending) { setDeleteTarget(null); setDeleteResult(null); } }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card"
            style={{ width: '100%', maxWidth: 440, padding: 28, borderRadius: 'var(--radius)' }}
          >
            {deleteResult ? (
              <>
                {/* Result screen */}
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(52,199,89,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <CheckCircle2 style={{ width: 28, height: 28, color: '#34c759' }} />
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Transaction Deleted</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{deleteTarget.customer_name} - {fmtRs(deleteTarget.amount)}</p>
                </div>
                <div className="glass-card" style={{ padding: 16, marginBottom: 20, background: 'rgba(0,113,227,0.04)' }}>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginBottom: 6 }}>Expiry date updated automatically:</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
                    <span style={{ fontSize: '0.85rem', textDecoration: 'line-through', color: 'var(--text-light)' }}>{deleteResult.old}</span>
                    <span style={{ color: 'var(--text-light)' }}>→</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: deleteResult.new ? '#ff3b30' : '#86868b' }}>
                      {deleteResult.new || 'Expired (no payments left)'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteResult(null); }}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 'var(--radius-xs)',
                    background: '#0071e3', color: '#fff', fontSize: '0.9rem', fontWeight: 600,
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                {/* Confirm screen */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,59,48,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <AlertTriangle style={{ width: 20, height: 20, color: '#ff3b30' }} />
                    </div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text)' }}>Delete Transaction?</h3>
                  </div>
                  <button onClick={() => setDeleteTarget(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}>
                    <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
                  </button>
                </div>

                <div className="glass-card" style={{ padding: 14, marginBottom: 16, background: 'rgba(0,0,0,0.02)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Customer</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{deleteTarget.customer_name}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Amount</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#34c759' }}>{fmtRs(deleteTarget.amount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Date</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{fmtDateTime(deleteTarget.date)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Mode</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{deleteTarget.payment_mode}</span>
                  </div>
                </div>

                <p style={{ fontSize: '0.8rem', color: '#ff3b30', marginBottom: 12, lineHeight: 1.5 }}>
                  The customer's expiry date will be recalculated based on remaining payments.
                </p>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                    Reason (optional)
                  </label>
                  <textarea
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="e.g. Duplicate entry, wrong amount..."
                    className="glass-input"
                    style={{ width: '100%', padding: '10px 12px', fontSize: '0.85rem', minHeight: 60, resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setDeleteTarget(null)}
                    disabled={deleteMutation.isPending}
                    style={{
                      flex: 1, padding: '11px', borderRadius: 'var(--radius-xs)',
                      border: '0.5px solid var(--border)', background: 'transparent',
                      color: 'var(--text)', fontSize: '0.88rem', fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason })}
                    disabled={deleteMutation.isPending}
                    style={{
                      flex: 1, padding: '11px', borderRadius: 'var(--radius-xs)',
                      border: 'none', background: '#ff3b30', color: '#fff',
                      fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
                      opacity: deleteMutation.isPending ? 0.6 : 1,
                    }}
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
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
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '10px 16px', borderRadius: 'var(--radius-xs)', fontSize: '0.88rem', fontWeight: 600,
        border: 'none', cursor: 'pointer',
        background: active ? 'var(--bg-primary)' : 'transparent',
        color: active ? color : 'var(--text-light)',
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.2s',
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

function Pagination({ page, totalPages, total, setPage }: { page: number; totalPages: number; total: number; setPage: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
      <button
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        style={pageNumBtn(page > 1)}
      >
        Previous
      </button>
      <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
        Page {page} of {totalPages} ({total} total)
      </span>
      <button
        onClick={() => setPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        style={pageNumBtn(page < totalPages)}
      >
        Next
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <div style={{ width: 36, height: 36, border: '4px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );
}

function pageNumBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 'var(--radius-xs)', border: '0.5px solid var(--border)',
    background: 'transparent', color: 'var(--text)', fontSize: '0.82rem',
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5,
  };
}
