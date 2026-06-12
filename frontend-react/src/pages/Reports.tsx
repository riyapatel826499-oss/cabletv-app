import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api';
import { fmtRs } from '../lib/format';
import { FileBarChart, Download, Calendar, MapPin, Users, TrendingUp, Tv } from 'lucide-react';

type Tab = 'area' | 'collector' | 'mso';

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
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('area');
  const [from, setFrom] = useState(monthRange().from);
  const [to, setTo] = useState(monthRange().to);

  const params = { from_date: from, to_date: to };

  const areaQ = useQuery({
    queryKey: ['area-collection', params],
    queryFn: async () => (await reportsApi.areaCollection(params)).data,
    enabled: tab === 'area',
  });

  const collectorQ = useQuery({
    queryKey: ['collector-performance', params],
    queryFn: async () => (await reportsApi.collectorPerformance(params)).data,
    enabled: tab === 'collector',
  });

  const msoQ = useQuery({
    queryKey: ['mso-summary', params],
    queryFn: async () => (await reportsApi.msoSummary(params)).data,
    enabled: tab === 'mso',
  });

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'area', label: 'Area Collection', icon: MapPin },
    { key: 'collector', label: 'Collector Performance', icon: Users },
    { key: 'mso', label: 'MSO Summary', icon: Tv },
  ];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileBarChart style={{ width: 28, height: 28 }} />
            Reports
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            Collection analytics and performance insights
          </p>
        </div>

        {/* Date Range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Calendar style={{ width: 16, height: 16, color: 'var(--text-light)' }} />
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            style={{
              padding: '7px 10px', borderRadius: 10, border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem',
            }}
          />
          <span style={{ color: 'var(--text-light)' }}>to</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            style={{
              padding: '7px 10px', borderRadius: 10, border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem',
            }}
          />
        </div>
      </div>

      {/* Quick month pills */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 1, 2, 3].map(m => {
          const r = monthRange(m);
          const active = from === r.from && to === r.to;
          const label = m === 0 ? 'This Month' : m === 1 ? 'Last Month' : `${m} Months Ago`;
          return (
            <button
              key={m}
              onClick={() => { setFrom(r.from); setTo(r.to); }}
              style={{
                padding: '6px 16px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 500,
                border: active ? 'none' : '0.5px solid var(--border)',
                background: active ? '#0071e3' : 'transparent',
                color: active ? '#fff' : 'var(--text-light)',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--bg-secondary)' }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '10px 16px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 500,
              border: 'none', cursor: 'pointer',
              background: tab === key ? 'var(--bg-primary)' : 'transparent',
              color: tab === key ? '#0071e3' : 'var(--text-light)',
              boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            <Icon style={{ width: 16, height: 16 }} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'area' && <AreaTab data={areaQ.data} loading={areaQ.isLoading} />}
      {tab === 'collector' && <CollectorTab data={collectorQ.data} loading={collectorQ.isLoading} />}
      {tab === 'mso' && <MsoTab data={msoQ.data} loading={msoQ.isLoading} />}
    </div>
  );
}

function AreaTab({ data, loading }: { data?: { areas: { area: string; total_amount: number; customer_count: number }[]; total_amount: number; total_areas: number; total_customers: number }; loading: boolean }) {
  if (loading) return <Spinner />;
  if (!data) return null;

  const maxAmount = Math.max(...data.areas.map(a => a.total_amount), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <MiniStat label="Total Areas" value={String(data.total_areas)} icon={MapPin} />
        <MiniStat label="Total Customers" value={String(data.total_customers)} icon={Users} />
        <MiniStat label="Total Collected" value={fmtRs(data.total_amount)} icon={TrendingUp} color="#34c759" />
      </div>

      <div className="glass-card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Area-wise Collection</h2>
          <button
            onClick={() => downloadCSV('area_collection.csv', data.areas.map(a => ({ Area: a.area, Customers: a.customer_count, Amount: a.total_amount })))}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-light)', fontSize: '0.78rem', cursor: 'pointer' }}
          >
            <Download style={{ width: 14, height: 14 }} /> CSV
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
            <thead>
              <tr><th>Area</th><th>Customers</th><th>Amount</th><th>Share</th></tr>
            </thead>
            <tbody>
              {data.areas.map((a, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{a.area || '--'}</td>
                  <td>{a.customer_count}</td>
                  <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(a.total_amount)}</td>
                  <td>
                    <div style={{ width: 80, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${(a.total_amount / maxAmount) * 100}%`, background: '#0071e3', transition: 'width 0.4s' }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CollectorTab({ data, loading }: { data?: { collectors: { name: string; total_collected: number; payment_count: number }[]; total_amount: number; total_payments: number }; loading: boolean }) {
  if (loading) return <Spinner />;
  if (!data) return null;

  const maxCollected = Math.max(...data.collectors.map(c => c.total_collected), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <MiniStat label="Total Collectors" value={String(data.collectors.length)} icon={Users} />
        <MiniStat label="Total Payments" value={String(data.total_payments)} icon={TrendingUp} />
        <MiniStat label="Total Collected" value={fmtRs(data.total_amount)} icon={TrendingUp} color="#34c759" />
      </div>

      <div className="glass-card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Collector Performance</h2>
          <button
            onClick={() => downloadCSV('collector_performance.csv', data.collectors.map(c => ({ Collector: c.name, Payments: c.payment_count, Collected: c.total_collected })))}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-light)', fontSize: '0.78rem', cursor: 'pointer' }}
          >
            <Download style={{ width: 14, height: 14 }} /> CSV
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
            <thead>
              <tr><th>Collector</th><th>Payments</th><th>Collected</th><th>Performance</th></tr>
            </thead>
            <tbody>
              {data.collectors.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{c.name || '--'}</td>
                  <td>{c.payment_count}</td>
                  <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(c.total_collected)}</td>
                  <td>
                    <div style={{ width: 100, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${(c.total_collected / maxCollected) * 100}%`, background: '#34c759', transition: 'width 0.4s' }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MsoTab({ data, loading }: { data?: { msos: { name: string; total_customers: number; active_customers: number; total_collected: number }[] }; loading: boolean }) {
  if (loading) return <Spinner />;
  if (!data || !data.msos?.length) return <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>No MSO data</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="glass-card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>MSO-wise Summary</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
            <thead>
              <tr><th>MSO</th><th>Total Customers</th><th>Active</th><th>Collected</th></tr>
            </thead>
            <tbody>
              {data.msos.map((m, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Tv style={{ width: 16, height: 16, color: '#0071e3' }} />
                      {m.name || '--'}
                    </span>
                  </td>
                  <td>{m.total_customers}</td>
                  <td style={{ color: '#34c759', fontWeight: 500 }}>{m.active_customers}</td>
                  <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(m.total_collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MSO Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {data.msos.map((m, i) => (
          <div key={i} className="glass-card animate-fade-in" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ padding: 8, borderRadius: 10, background: 'rgba(0,113,227,0.1)' }}>
                <Tv style={{ width: 20, height: 20, color: '#0071e3' }} />
              </div>
              <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--text-light)' }}>Active</span>
                <span style={{ fontWeight: 500 }}>{m.active_customers}/{m.total_customers}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--text-light)' }}>Collected</span>
                <span style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(m.total_collected)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, color = '#0071e3' }: { label: string; value: string; icon: React.ElementType; color?: string }) {
  return (
    <div className="glass-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ padding: 10, borderRadius: 10, background: `${color}1a` }}>
        <Icon style={{ width: 20, height: 20, color }} />
      </div>
      <div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
        <p style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{value}</p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
      <div style={{ width: 36, height: 36, border: '4px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );
}
