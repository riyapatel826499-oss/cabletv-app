import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { dashboardApi, reportsApi } from '../api';
import {
  IndianRupee, TrendingUp, TrendingDown, Clock, AlertCircle, Wifi,
  BarChart3, Plus, Send, Wrench, ArrowRight, Phone, ZapOff, UserPlus,
  Calendar, CreditCard, ListChecks, Target,
} from 'lucide-react';
import type { DashboardStats, DashboardToday, AgentDashboardStats, ExpiringCustomer, RecentPayment } from '../types';
import { fmtRs, fmtDate } from '../lib/format';

// ── Progress Ring ──────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 120, stroke = 10 }: { pct: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 80 ? '#34c759' : pct >= 50 ? '#ff9f0a' : '#ff3b30';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="rgba(0,0,0,0.08)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '1.5rem', fontWeight: 700, fill: color, transform: 'rotate(90deg)', transformOrigin: 'center' }}>
        {pct}%
      </text>
    </svg>
  );
}

// ── Action Card ────────────────────────────────────────────────────────────
function ActionCard({
  icon: Icon, label, value, color, onClick, subtitle,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  onClick: () => void;
  subtitle?: string;
}) {
  return (
    <div
      onClick={onClick}
      className="glass-card"
      style={{
        padding: 18, cursor: 'pointer', transition: 'all 0.2s',
        borderLeft: `3px solid ${color}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ padding: 10, borderRadius: 'var(--radius-sm)', background: `${color}15` }}>
          <Icon style={{ width: 22, height: 22, color }} />
        </div>
        <div>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color, lineHeight: 1.1 }}>{value}</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: 2 }}>
            {label}
          </p>
        </div>
      </div>
      {subtitle && <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 8 }}>{subtitle}</p>}
    </div>
  );
}

// ── Quick Action Button ────────────────────────────────────────────────────
function QuickAction({ icon: Icon, label, onClick, color }: { icon: React.ElementType; label: string; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderRadius: 'var(--radius-sm)',
        background: `${color}12`, border: `1px solid ${color}30`,
        cursor: 'pointer', transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = `${color}20`; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = `${color}12`; }}
    >
      <Icon style={{ width: 17, height: 17, color }} />
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color }}>{label}</span>
    </button>
  );
}

// ── Revenue Bar Chart ──────────────────────────────────────────────────────
interface TrendItem { month: string; local: number; paypakka: number; total: number; count: number }

function RevenueBarChart({ data }: { data: TrendItem[] }) {
  const maxVal = Math.max(...data.map((d) => d.total), 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 160, padding: '0 8px' }}>
        {data.map((d, i) => {
          const localPct = (d.local / maxVal) * 100;
          const ppPct = (d.paypakka / maxVal) * 100;
          const totalPct = (d.total / maxVal) * 100;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', position: 'relative' }}>
              <div className="bar-tooltip" style={{
                position: 'absolute', bottom: `calc(${totalPct}% + 4px)`, background: 'var(--bg-secondary)',
                border: '0.5px solid var(--border)', borderRadius: 'var(--radius-xs)', padding: '4px 8px',
                fontSize: '0.7rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap',
                opacity: 0, transition: 'opacity 0.2s', pointerEvents: 'none', zIndex: 5,
              }}>
                {fmtRs(d.total)} . {d.count} payments
              </div>
              <div style={{
                width: '70%', maxWidth: 44, borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0',
                overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'all 0.3s ease', cursor: 'pointer',
              }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scaleY(1.03)'; e.currentTarget.style.transformOrigin = 'bottom';
                  const tip = e.currentTarget.parentElement?.querySelector('.bar-tooltip') as HTMLElement;
                  if (tip) tip.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scaleY(1)';
                  const tip = e.currentTarget.parentElement?.querySelector('.bar-tooltip') as HTMLElement;
                  if (tip) tip.style.opacity = '0';
                }}
              >
                <div style={{ height: `${ppPct}%`, background: '#ff9f0a', minHeight: d.paypakka > 0 ? 2 : 0 }} />
                <div style={{ height: `${localPct}%`, background: '#0071e3', minHeight: d.local > 0 ? 2 : 0 }} />
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 8, fontWeight: 500 }}>
                {d.month.split(' ')[0]}
              </p>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#0071e3' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Local</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#ff9f0a' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Paypakka</span>
        </div>
      </div>
    </div>
  );
}

// ── Agent Dashboard ────────────────────────────────────────────────────────
function AgentDashboard({ stats }: { stats: AgentDashboardStats }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: today } = useQuery({
    queryKey: ['dashboard-today'],
    queryFn: async () => (await dashboardApi.today()).data as DashboardToday,
    refetchInterval: 20000,
  });

  const myCollected = stats.my_collected ?? 0;
  const myCount = stats.my_payments ?? 0;
  const openSR = stats.my_open_sr_count ?? 0;
  const todayCollected = today?.today_collected ?? 0;
  const todayCount = today?.today_count ?? 0;
  const yesterday = today?.yesterday_collected ?? 0;
  const lastMonth = today?.last_month_collected ?? 0;

  const todayVsYesterday = yesterday > 0 ? Math.round(((todayCollected - yesterday) / yesterday) * 100) : 0;
  const monthVsLast = lastMonth > 0 ? Math.round(((myCollected - lastMonth) / lastMonth) * 100) : 0;
  const recentPayments = stats.recent_payments || [];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Hi {user?.name?.split(' ')[0] || 'Agent'}
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 2 }}>
            {stats.month} . You collected {fmtRs(myCollected)} from {myCount} payments
          </p>
        </div>

      </div>

      {/* Collection Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {/* Today */}
        <div className="glass-card" style={{ padding: 20, borderLeft: '3px solid #34c759' }}>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 500 }}>
            My Collection Today
          </p>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#34c759', letterSpacing: '-0.02em', marginTop: 4 }}>
            {fmtRs(todayCollected)}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
            {todayCount} payments today
          </p>
          {yesterday > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 6 }}>
              {todayVsYesterday >= 0 ? (
                <TrendingUp style={{ width: 13, height: 13, color: '#34c759' }} />
              ) : (
                <TrendingDown style={{ width: 13, height: 13, color: '#ff3b30' }} />
              )}
              <span style={{
                fontSize: '0.7rem', fontWeight: 500,
                color: todayVsYesterday >= 0 ? '#34c759' : '#ff3b30',
              }}>
                {todayVsYesterday >= 0 ? '+' : ''}{todayVsYesterday}% vs yesterday
              </span>
            </div>
          )}
        </div>

        {/* This Month Total */}
        <div className="glass-card" style={{ padding: 20, borderLeft: '3px solid #0071e3' }}>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 500 }}>
            My Total This Month
          </p>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0071e3', letterSpacing: '-0.02em', marginTop: 4 }}>
            {fmtRs(myCollected)}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
            {myCount} total payments
          </p>
          {lastMonth > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 6 }}>
              {monthVsLast >= 0 ? (
                <TrendingUp style={{ width: 13, height: 13, color: '#34c759' }} />
              ) : (
                <TrendingDown style={{ width: 13, height: 13, color: '#ff3b30' }} />
              )}
              <span style={{
                fontSize: '0.7rem', fontWeight: 500,
                color: monthVsLast >= 0 ? '#34c759' : '#ff3b30',
              }}>
                {monthVsLast >= 0 ? '+' : ''}{monthVsLast}% vs last month
              </span>
            </div>
          )}
        </div>

        {/* Last Month */}
        <div className="glass-card" style={{ padding: 20, borderLeft: '3px solid #8e8e93' }}>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 500 }}>
            Last Month Total
          </p>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-light)', letterSpacing: '-0.02em', marginTop: 4 }}>
            {fmtRs(lastMonth)}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
            {today?.last_month_paid ?? 0} payments
          </p>
        </div>

        {/* Open SRs */}
        {openSR > 0 && (
          <div
            className="glass-card"
            style={{ padding: 20, borderLeft: '3px solid #ff9f0a', cursor: 'pointer' }}
            onClick={() => navigate('/service-requests')}
          >
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 500 }}>
              My Open Service Requests
            </p>
            <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ff9f0a', letterSpacing: '-0.02em', marginTop: 4 }}>
              {openSR}
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
              Tap to view . <ArrowRight style={{ width: 12, height: 12, display: 'inline' }} />
            </p>
          </div>
        )}
      </div>

      {/* Daily Target / Streak (motivational) */}
      {todayCount > 0 && (
        <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Target style={{ width: 20, height: 20, color: '#34c759' }} />
          <p style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
            You've made <b>{todayCount} payment{todayCount > 1 ? 's' : ''}</b> today
            {todayCount >= 5 ? ' . Great pace! Keep going!' : ' . Keep collecting!'}
          </p>
        </div>
      )}

      {/* My Recent Payments */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ListChecks style={{ width: 17, height: 17, color: 'var(--text-light)' }} />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
              My Recent Collections
            </h2>
          </div>
          <button onClick={() => navigate('/my-collections')} style={{ fontSize: '0.78rem', color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
            View all . <ArrowRight style={{ width: 12, height: 12, display: 'inline' }} />
          </button>
        </div>
        {recentPayments.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Area</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.slice(0, 8).map((p: RecentPayment, i: number) => (
                  <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${p.customer_id}`)}>
                    <td style={{ fontWeight: 500 }}>{p.customer_name || '--'}</td>
                    <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(Number(p.amount) || 0)}</td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 500,
                        background: 'rgba(0,113,227,0.08)', color: '#0071e3',
                      }}>
                        {p.mode || '--'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>{p.area || '--'}</td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.78rem' }}>{fmtDate(p.date || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
            No collections yet this month. Start collecting!
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await dashboardApi.stats()).data as DashboardStats | AgentDashboardStats,
    refetchInterval: 30000,
  });

  const { data: today } = useQuery({
    queryKey: ['dashboard-today'],
    queryFn: async () => (await dashboardApi.today()).data as DashboardToday,
    refetchInterval: 20000,
  });

  const { data: trendData } = useQuery({
    queryKey: ['mom-trend', 6],
    queryFn: async () => (await reportsApi.momTrend(6)).data as {
      data: TrendItem[];
    },
  });

  const { data: modesData } = useQuery({
    queryKey: ['dashboard-modes'],
    queryFn: async () => (await dashboardApi.paymentModes()).data as {
      modes: Record<string, { count: number; total: number }>;
      total_count: number;
      total_amount: number;
    },
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ width: 40, height: 40, border: '4px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="glass-card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, color: 'var(--text-light)' }}>
        <AlertCircle style={{ width: 32, height: 32, marginBottom: 8 }} />
        <p>Unable to load dashboard data</p>
      </div>
    );
  }

  // ── Agent branch ─────────────────────────────────────────────────────
  const adminStats = stats as DashboardStats;
  if ('is_agent' in stats && stats.is_agent) {
    return <AgentDashboard stats={stats} />;
  }

  const efficiency = adminStats.collection_efficiency ?? 0;
  const isPastCutoff = new Date().getDate() > 12; // default cutoff
  const expiring = (adminStats.expiring_soon || []) as ExpiringCustomer[];

  // Sort areas worst-first (lowest paid_count to total ratio)
  // We don't have total per area, so sort by paid_count ascending
  const sortedAreas = [...(adminStats.by_area || [])].sort((a, b) => Number(a.paid_count) - Number(b.paid_count));

  // Payment modes sorted by total desc
  const modes = modesData?.modes
    ? Object.entries(modesData.modes).sort((a, b) => b[1].total - a[1].total)
    : [];
  const modesTotal = modesData?.total_amount || 1;

  // Today vs yesterday trend
  const todayVsYesterday = today?.yesterday_collected
    ? Math.round(((today.today_collected - today.yesterday_collected) / today.yesterday_collected) * 100)
    : 0;

  // Month vs last month trend
  const monthVsLast = today?.last_month_collected
    ? Math.round(((adminStats.total_collected - today.last_month_collected) / today.last_month_collected) * 100)
    : 0;

  // Estimate expected revenue (avg per paying customer * total)
  const avgPerCustomer = adminStats.paid_this_month > 0 ? adminStats.total_collected / adminStats.paid_this_month : 0;
  const expectedRevenue = Math.round(avgPerCustomer * adminStats.total_customers);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header + Quick Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            {user?.name?.split(' ')[0] || 'Admin'} — here's today
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 2 }}>
            {adminStats.month} . {efficiency}% collected . {adminStats.paid_this_month} of {adminStats.total_customers} paid
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <QuickAction icon={Plus} label="Add Customer" onClick={() => navigate('/add-customer')} color="#0071e3" />
          <QuickAction icon={Send} label="Reminders" onClick={() => navigate('/reminders')} color="#ff9f0a" />
        </div>
      </div>

      {/* ── Collection Hero Card ─────────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
          {/* Progress Ring */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <ProgressRing pct={Math.round(efficiency)} />
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 500 }}>
              Collection Rate
            </p>
          </div>

          {/* Big Numbers */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
              Collected This Month
            </p>
            <p style={{ fontSize: '2.2rem', fontWeight: 700, color: '#34c759', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              {fmtRs(adminStats.total_collected ?? 0)}
            </p>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              {/* Today */}
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>Today</p>
                <p style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text)' }}>
                  {fmtRs(today?.today_collected ?? 0)}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                  {todayVsYesterday > 0 ? (
                    <TrendingUp style={{ width: 13, height: 13, color: '#34c759' }} />
                  ) : todayVsYesterday < 0 ? (
                    <TrendingDown style={{ width: 13, height: 13, color: '#ff3b30' }} />
                  ) : null}
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 500,
                    color: todayVsYesterday > 0 ? '#34c759' : todayVsYesterday < 0 ? '#ff3b30' : 'var(--text-light)',
                  }}>
                    {todayVsYesterday > 0 ? '+' : ''}{todayVsYesterday}% vs yesterday
                  </span>
                </div>
              </div>
              {/* Last Month */}
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>Last Month</p>
                <p style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text)' }}>
                  {fmtRs(today?.last_month_collected ?? 0)}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                  {monthVsLast > 0 ? (
                    <TrendingUp style={{ width: 13, height: 13, color: '#34c759' }} />
                  ) : monthVsLast < 0 ? (
                    <TrendingDown style={{ width: 13, height: 13, color: '#ff3b30' }} />
                  ) : null}
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 500,
                    color: monthVsLast > 0 ? '#34c759' : monthVsLast < 0 ? '#ff3b30' : 'var(--text-light)',
                  }}>
                    {monthVsLast > 0 ? '+' : ''}{monthVsLast}% vs last month
                  </span>
                </div>
              </div>
              {/* Expected */}
              {expectedRevenue > 0 && (
                <div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>Expected</p>
                  <p style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-light)' }}>
                    {fmtRs(expectedRevenue)}
                  </p>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 2 }}>
                    {adminStats.unpaid_this_month} unpaid pending
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Action Items Row ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <ActionCard
          icon={Clock}
          label="Unpaid Customers"
          value={adminStats.unpaid_this_month ?? 0}
          color={isPastCutoff ? '#ff3b30' : '#ff9f0a'}
          subtitle={isPastCutoff ? 'Past cutoff — disconnect pending' : `Collected from ${adminStats.paid_this_month}`}
          onClick={() => navigate('/unpaid')}
        />
        <ActionCard
          icon={Calendar}
          label="Expiring in 3 Days"
          value={expiring.length}
          color="#ff9f0a"
          subtitle={expiring.length > 0 ? 'Call to renew' : 'All up to date'}
          onClick={() => navigate('/customers')}
        />
        {adminStats.open_sr_count > 0 && (
          <ActionCard
            icon={Wrench}
            label="Open Service Requests"
            value={adminStats.open_sr_count}
            color="#0071e3"
            subtitle="Needs attention"
            onClick={() => navigate('/service-requests')}
          />
        )}
        {(today?.temp_disconnected ?? 0) > 0 && (
          <ActionCard
            icon={ZapOff}
            label="Temp Disconnected"
            value={today?.temp_disconnected ?? 0}
            color="#ff3b30"
            subtitle="May need reconnection"
            onClick={() => navigate('/connections')}
          />
        )}
        {(today?.new_customers_this_month ?? 0) > 0 && (
          <ActionCard
            icon={UserPlus}
            label="New This Month"
            value={today?.new_customers_this_month ?? 0}
            color="#34c759"
            subtitle="Customer growth"
            onClick={() => navigate('/customers')}
          />
        )}
      </div>

      {/* ── Expiring Soon Call List ──────────────────────────────────────── */}
      {expiring.length > 0 && (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar style={{ width: 17, height: 17, color: '#ff9f0a' }} />
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
                Renewal Reminder Call List
              </h2>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>Expiring within 3 days</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Area</th>
                  <th>Plan</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expiring.slice(0, 8).map((c, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${c.customer_id}`)}>
                    <td style={{ fontWeight: 500 }}>{c.customer_name || '--'}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Phone style={{ width: 12, height: 12, color: 'var(--text-light)' }} />
                        {c.phone || '--'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>{c.area || '--'}</td>
                    <td style={{ fontSize: '0.82rem' }}>{c.plan_name || '--'}</td>
                    <td>
                      <span style={{
                        padding: '3px 8px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
                        background: 'rgba(255,159,10,0.12)', color: '#ff9f0a',
                      }}>
                        {fmtDate(c.expiry_date || '')}
                      </span>
                    </td>
                    <td>
                      <IndianRupee
                        style={{ width: 16, height: 16, color: '#34c759', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); navigate('/payments/new'); }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {expiring.length > 8 && (
            <div style={{ padding: '10px 20px', textAlign: 'center' }}>
              <button onClick={() => navigate('/customers')} style={{ fontSize: '0.8rem', color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                View all {expiring.length} expiring . <ArrowRight style={{ width: 12, height: 12, display: 'inline' }} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Two Column: Area Performance + Payment Modes ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        {/* Area Performance — worst first */}
        {sortedAreas.length > 0 && (
          <div className="glass-card" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <BarChart3 style={{ width: 17, height: 17, color: 'var(--text-light)' }} />
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
                Areas Needing Attention
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sortedAreas.slice(0, 6).map((area, i) => {
                const collected = Number(area.total_amount) || 0;
                const paid = Number(area.paid_count) || 0;
                const maxArea = Math.max(...sortedAreas.map(a => Number(a.total_amount) || 0), 1);
                const barPct = Math.round((collected / maxArea) * 100);
                return (
                  <div key={i} style={{ cursor: 'pointer' }} onClick={() => navigate('/unpaid')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>{area.area || 'Unknown'}</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: paid < 3 ? '#ff3b30' : paid < 8 ? '#ff9f0a' : '#34c759' }}>
                        {paid} paid . {fmtRs(collected)}
                      </span>
                    </div>
                    <div style={{ marginTop: 5, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 3, width: `${barPct}%`,
                        background: paid < 3 ? '#ff3b30' : paid < 8 ? '#ff9f0a' : '#34c759',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {sortedAreas.length > 6 && (
              <button onClick={() => navigate('/reports')} style={{ marginTop: 12, fontSize: '0.78rem', color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                View all areas in reports . <ArrowRight style={{ width: 12, height: 12, display: 'inline' }} />
              </button>
            )}
          </div>
        )}

        {/* Payment Mode Breakdown */}
        {modes.length > 0 && (
          <div className="glass-card" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <CreditCard style={{ width: 17, height: 17, color: 'var(--text-light)' }} />
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
                Payment Mode Breakdown
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {modes.map(([mode, data]) => {
                const pct = Math.round((data.total / modesTotal) * 100);
                const modeColors: Record<string, string> = {
                  Cash: '#34c759', GPay: '#0071e3', PhonePe: '#5e5ce6',
                  UPI: '#5e5ce6', Card: '#ff9f0a', Bank: '#ff9f0a',
                };
                const color = modeColors[mode] || '#8e8e93';
                return (
                  <div key={mode}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{mode}</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-light)' }}>
                        {fmtRs(data.total)} . {data.count} txns
                      </span>
                    </div>
                    <div style={{ marginTop: 5, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 3, width: `${pct}%`,
                        background: color, transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Revenue Trend ────────────────────────────────────────────────── */}
      {trendData?.data && trendData.data.length > 0 && (
        <div className="glass-card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <TrendingUp style={{ width: 17, height: 17, color: 'var(--text-light)' }} />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
              Revenue Trend . Last 6 Months
            </h2>
          </div>
          <RevenueBarChart data={trendData.data} />
        </div>
      )}

      {/* ── Recent Payments ──────────────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
            Recent Payments
          </h2>
          <button onClick={() => navigate('/reports')} style={{ fontSize: '0.78rem', color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
            View all . <ArrowRight style={{ width: 12, height: 12, display: 'inline' }} />
          </button>
        </div>
        {adminStats.recent_payments && adminStats.recent_payments.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Source</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {adminStats.recent_payments.slice(0, 6).map((p, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${p.customer_id}`)}>
                    <td style={{ fontWeight: 500 }}>{p.customer_name || '--'}</td>
                    <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(Number(p.amount) || 0)}</td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 500,
                        background: 'rgba(0,113,227,0.08)', color: '#0071e3',
                      }}>
                        {p.mode || '--'}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 20, fontSize: '0.68rem', fontWeight: 500,
                        background: p.source === 'Paypakka' ? 'rgba(255,159,10,0.1)' : 'rgba(52,199,89,0.1)',
                        color: p.source === 'Paypakka' ? '#ff9f0a' : '#34c759',
                      }}>
                        {p.source || 'Local'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.78rem' }}>
                      {fmtDate(p.date || '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
            No payments yet this month
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Wifi style={{ width: 13, height: 13 }} /> {adminStats.total_connections ?? 0} connections
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
          . Auto-refreshes every 30s
        </span>
      </div>
    </div>
  );
}
