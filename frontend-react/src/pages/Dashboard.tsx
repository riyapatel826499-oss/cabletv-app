import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, reportsApi } from '../api';
import { Users, IndianRupee, TrendingUp, Clock, AlertCircle, Wifi, BarChart3 } from 'lucide-react';
import type { DashboardStats } from '../types';
import { fmtRs, fmtDate } from '../lib/format';

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const colorMap: Record<string, string> = {
    primary: '#0071e3',
    success: '#34c759',
    warning: '#ff9f0a',
    danger: '#ff3b30',
  };
  const bgMap: Record<string, string> = {
    primary: 'rgba(0,113,227,0.1)',
    success: 'rgba(52,199,89,0.1)',
    warning: 'rgba(255,159,10,0.1)',
    danger: 'rgba(255,59,48,0.1)',
  };

  return (
    <div className="glass-card" style={{ padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p
            style={{
              fontSize: '0.78rem',
              fontWeight: 500,
              color: 'var(--text-light)',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              marginBottom: 8,
            }}
          >
            {title}
          </p>
          <p
            style={{
              fontSize: '1.8rem',
              fontWeight: 700,
              color: colorMap[color],
              letterSpacing: '-0.02em',
            }}
          >
            {value}
          </p>
          {subtitle && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 4 }}>
              {subtitle}
            </p>
          )}
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            background: bgMap[color],
          }}
        >
          <Icon style={{ width: 24, height: 24, color: colorMap[color] }} />
        </div>
      </div>
    </div>
  );
}

interface TrendItem {
  month: string;
  local: number;
  paypakka: number;
  total: number;
  count: number;
}

function RevenueBarChart({ data }: { data: TrendItem[] }) {
  const maxVal = Math.max(...data.map((d) => d.total), 1);

  return (
    <div>
      {/* Bars */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          height: 180,
          padding: '0 8px',
        }}
      >
        {data.map((d, i) => {
          const localPct = (d.local / maxVal) * 100;
          const ppPct = (d.paypakka / maxVal) * 100;
          const totalPct = (d.total / maxVal) * 100;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                height: '100%',
                justifyContent: 'flex-end',
                position: 'relative',
              }}
            >
              {/* Tooltip on hover */}
              <div
                style={{
                  position: 'absolute',
                  bottom: `calc(${totalPct}% + 4px)`,
                  background: 'var(--bg-secondary)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '4px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  opacity: 0,
                  transition: 'opacity 0.2s',
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
                className="bar-tooltip"
              >
                {fmtRs(d.total)} · {d.count} payments
              </div>

              {/* Stacked bar */}
              <div
                style={{
                  width: '70%',
                  maxWidth: 48,
                  borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scaleY(1.03)';
                  e.currentTarget.style.transformOrigin = 'bottom';
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

              {/* Month label */}
              <p
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-light)',
                  marginTop: 8,
                  fontWeight: 500,
                }}
              >
                {d.month.split(' ')[0]}
              </p>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 16 }}>
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

export default function Dashboard() {
  const { user } = useAuth();

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await dashboardApi.stats()).data as DashboardStats,
    refetchInterval: 30000,
  });

  const { data: trendData } = useQuery({
    queryKey: ['mom-trend', 6],
    queryFn: async () => (await reportsApi.momTrend(6)).data as {
      data: Array<{ month: string; local: number; paypakka: number; total: number; count: number }>;
    },
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

  if (isError || !stats) {
    return (
      <div
        className="glass-card animate-fade-in"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 64,
          color: 'var(--text-light)',
        }}
      >
        <AlertCircle style={{ width: 32, height: 32, marginBottom: 8 }} />
        <p>Unable to load dashboard data</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Greeting */}
      <div>
        <h1
          style={{
            fontSize: '1.4rem',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--text)',
          }}
        >
          Welcome back, {user?.name?.split(' ')[0] || 'Admin'} 👋
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          Here's your collection overview for this month
        </p>
      </div>

      {/* Stat Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        <StatCard
          title="Total Connections"
          value={stats.total_connections ?? 0}
          icon={Wifi}
          color="primary"
        />
        <StatCard
          title="Collected This Month"
          value={fmtRs(stats.total_collected ?? 0)}
          icon={IndianRupee}
          color="success"
          subtitle={`${stats.paid_this_month ?? 0} customers paid`}
        />
        <StatCard
          title="Pending Collection"
          value={fmtRs(stats.unpaid_this_month ? Math.round((stats.total_collected / Math.max(1, stats.paid_this_month)) * stats.unpaid_this_month) : 0)}
          icon={Clock}
          color="warning"
          subtitle={`${stats.unpaid_this_month ?? 0} customers pending`}
        />
        <StatCard
          title="Collection Efficiency"
          value={`${stats.collection_efficiency ?? 0}%`}
          icon={TrendingUp}
          color={stats.collection_efficiency >= 80 ? 'success' : 'warning'}
        />
      </div>

      {/* Revenue Trend Chart */}
      {trendData?.data && trendData.data.length > 0 && (
        <div className="glass-card animate-fade-in" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <BarChart3 style={{ width: 18, height: 18, color: 'var(--text-light)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
              Revenue Trend — Last 6 Months
            </h2>
          </div>
          <RevenueBarChart data={trendData.data} />
        </div>
      )}

      {/* Recent Payments */}
      <div className="glass-card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '0.5px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            Recent Payments
          </h2>
          <Users style={{ width: 18, height: 18, color: 'var(--text-light)' }} />
        </div>

        {stats.recent_payments && stats.recent_payments.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_payments.slice(0, 8).map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{p.customer_name || '--'}</td>
                    <td style={{ fontWeight: 600, color: '#34c759' }}>
                      {fmtRs(Number(p.amount) || 0)}
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
                        {p.mode || '--'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>
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

      {/* By Area */}
      {stats.by_area && stats.by_area.length > 0 && (
        <div className="glass-card animate-fade-in" style={{ padding: '20px 24px' }}>
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--text)',
              marginBottom: 16,
            }}
          >
            Collection by Area
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {stats.by_area.map((area, i) => {
              const pct = area.total_amount
                ? Math.round((Number(area.paid_count) / Math.max(1, Number(area.total_amount))) * 100)
                : 0;
              return (
                <div
                  key={i}
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>
                    {area.area || '--'}
                  </p>
                  <p
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-light)',
                      marginTop: 4,
                    }}
                  >
                    {fmtRs(area.total_amount)}
                  </p>
                  {/* Progress bar */}
                  <div
                    style={{
                      marginTop: 8,
                      height: 4,
                      borderRadius: 2,
                      background: 'rgba(0,0,0,0.06)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 2,
                        width: `${pct}%`,
                        background:
                          pct >= 80
                            ? '#34c759'
                            : pct >= 50
                              ? '#ff9f0a'
                              : '#ff3b30',
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
