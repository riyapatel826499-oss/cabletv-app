import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { dashboardApi, gtplApi, layaApi } from '../api';
import {
  TrendingUp, AlertCircle, Phone,
  Zap, Wifi, Tv, Package, CheckCircle2, Clock, ArrowRight,
  MessageCircle, BarChart3,
} from 'lucide-react';
import type { DashboardInsights } from '../types';
import Rs from '../components/Rs';

// ── Mini Stat Card ─────────────────────────────────────────────────────────
function MiniStat({ icon: Icon, label, value, color, sub, onClick }: {
  icon: React.ElementType; label: string; value: React.ReactNode; color: string; sub?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="glass-card animate-fade-in"
      style={{
        padding: 16, flex: 1, minWidth: 140,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
        ...(onClick ? { ['--tap' as any]: '1' } : {}),
      }}
      onTouchStart={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)'; } : undefined}
      onTouchEnd={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; } : undefined}
      onMouseDown={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)'; } : undefined}
      onMouseUp={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ padding: 8, borderRadius: 'var(--radius-sm)', background: `${color}15` }}>
          <Icon style={{ width: 18, height: 18, color }} />
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-light)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, color, action }: {
  icon: React.ElementType; title: string; color: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon style={{ width: 20, height: 20, color }} />
        <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

// ── Sparkline (simple SVG bar chart) ───────────────────────────────────────
function MiniBars({ data, height = 40 }: { data: { month: string; total: number }[]; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => Number(d.total)), 1);
  const barW = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      {data.map((d, i) => {
        const h = (Number(d.total) / max) * (height - 14);
        const x = i * barW + 1;
        const w = barW - 2;
        const y = height - h - 12;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} rx={1.5} fill="#0071e3" opacity={0.85} />
            <text x={x + w / 2} y={height - 2} textAnchor="middle" style={{ fontSize: '2.5px', fill: 'var(--text-light)' }}>
              {d.month.split('-')[1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Main Dashboard Component ───────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();

  const { data: insights, isLoading, isError } = useQuery<DashboardInsights>({
    queryKey: ['dashboard-insights'],
    queryFn: () => dashboardApi.insights().then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: today } = useQuery({
    queryKey: ['dashboard-today'],
    queryFn: () => dashboardApi.today().then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: priorityData } = useQuery({
    queryKey: ['priority-unpaid'],
    queryFn: () => dashboardApi.priorityUnpaid(1).then(r => r.data),
    refetchInterval: 30000,
  });

  // GTPL wallet balance — refresh every 5 min
  const { data: walletData } = useQuery({
    queryKey: ['gtpl-wallet'],
    queryFn: () => gtplApi.wallet().then(r => r.data),
    refetchInterval: 300000,
    retry: 1,
  });

  // Laya sync
  const [layaMsg, setLayaMsg] = useState('');
  const layaSyncMut = useMutation({
    mutationFn: () => layaApi.syncSubscribers(),
    onSuccess: (r) => setLayaMsg(`Synced: ${r.data.created} new, ${r.data.updated} updated`),
    onError: (e: any) => setLayaMsg(`Error: ${e?.response?.data?.detail || 'failed'}`),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTopColor: 'var(--primary, #0071e3)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  if (isError || !insights) {
    return (
      <div className="glass-card animate-fade-in" style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>
        <AlertCircle style={{ width: 32, height: 32, marginBottom: 8, color: '#ff3b30' }} />
        <p>Unable to load dashboard data. Please try again.</p>
      </div>
    );
  }

  const ins = insights;
  const todayData = today || {};
  const collectionPct = ins.collection_pct || 0;
  const waPhone = (phone: string) => {
    const clean = (phone || '').replace(/\D/g, '');
    if (clean.length === 10) return `91${clean}`;
    return clean;
  };
  const waLink = (phone: string, name: string, amount: number) => {
    const msg = encodeURIComponent(`Hi ${name}, your cable TV payment of ₹${Math.round(amount)} is pending. Please pay before 12th to avoid disconnection. Thank you - SSN Cables`);
    return `https://wa.me/${waPhone(phone)}?text=${msg}`;
  };

  const totalStb = Object.values(ins.stb_health || {}).reduce((a: number, b: any) => a + Number(b), 0);

  // MSO deadline logic
  const today_date = new Date();
  const dayOfMonth = today_date.getDate();
  const daysToDeadline = 16 - dayOfMonth;
  const deadlineColor = daysToDeadline <= 0 ? '#ff3b30' : daysToDeadline <= 3 ? '#ff9f0a' : '#34c759';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>

      {/* ═══ GTPL Wallet Balance Alert ════════════════════════════════════════ */}
      {walletData?.success && walletData.low && (
        <div className="glass-card animate-fade-in" style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(255, 59, 48, 0.08)', border: '1px solid rgba(255, 59, 48, 0.3)',
          borderRadius: 'var(--radius-md)',
        }}>
          <AlertCircle style={{ width: 20, height: 20, color: '#ff3b30', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, color: '#ff3b30' }}>GTPL Wallet Low</span>
            <span style={{ color: 'var(--text-light)', marginLeft: 6 }}>
              Balance: ₹{walletData.balance?.toFixed(2)} — renewals will fail. Recharge needed.
            </span>
          </div>
        </div>
      )}
      {walletData?.success && !walletData.low && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-light)' }}>
          <Zap style={{ width: 14, height: 14, color: '#34c759' }} />
          GTPL Wallet: ₹{walletData.balance?.toFixed(2)}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1: COLLECTION OVERVIEW + ACTION TODAY
      ══════════════════════════════════════════════════════════════════ */}
      <div className="glass-card animate-fade-in" style={{ padding: 20 }}>
        {/* Collection Header: Month + Percentage */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} Collection
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              <Rs amount={ins.month_collected} />
              <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-light)' }}> / <Rs amount={ins.month_target} /></span>
            </div>
          </div>
          {/* Percentage badge */}
          <div style={{
            padding: '6px 14px', borderRadius: 20,
            background: collectionPct >= 80 ? '#34c75915' : collectionPct >= 50 ? '#ff9f0a15' : '#ff3b3015',
            border: `1px solid ${collectionPct >= 80 ? '#34c75930' : collectionPct >= 50 ? '#ff9f0a30' : '#ff3b3030'}`,
          }}>
            <span style={{
              fontSize: '1.2rem', fontWeight: 700,
              color: collectionPct >= 80 ? '#34c759' : collectionPct >= 50 ? '#ff9f0a' : '#ff3b30',
            }}>
              {collectionPct.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{
          height: 24, borderRadius: 12, background: 'var(--bg-secondary, #f0f0f3)',
          overflow: 'hidden', position: 'relative', cursor: 'pointer',
        }} onClick={() => navigate('/reports')}>
          <div style={{
            height: '100%',
            width: `${Math.min(collectionPct, 100)}%`,
            borderRadius: 12,
            background: collectionPct >= 80
              ? 'linear-gradient(90deg, #30d158, #34c759)'
              : 'linear-gradient(90deg, #ffb340, #ff9f0a)',
            transition: 'width 0.8s ease',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            paddingRight: 10,
          }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}>
              <Rs amount={ins.month_collected} />
            </span>
          </div>
        </div>

        {/* Collected / Pending / Today row */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{
            flex: 1, minWidth: 100, padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            background: '#34c75908', cursor: 'pointer',
          }} onClick={() => navigate('/payments')}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Collected</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#34c759' }}><Rs amount={ins.month_collected} /></div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>{ins.today_count} payments today</div>
          </div>
          <div style={{
            flex: 1, minWidth: 100, padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            background: '#ff9f0a08', cursor: 'pointer',
          }} onClick={() => navigate('/unpaid')}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pending</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ff9f0a' }}><Rs amount={ins.month_target - ins.month_collected} /></div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>{ins.total_unpaid_count} customers</div>
          </div>
          <div style={{
            flex: 1, minWidth: 100, padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            background: '#0071e308', cursor: 'pointer',
          }} onClick={() => navigate('/payments')}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Today</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0071e3' }}><Rs amount={ins.today_collected} /></div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>{ins.today_count} collected</div>
          </div>
          {/* MSO Deadline */}
          <div style={{
            padding: '8px 14px', borderRadius: 'var(--radius-sm)',
            background: `${deadlineColor}10`, border: `1px solid ${deadlineColor}30`,
            textAlign: 'center', cursor: 'pointer',
          }} onClick={() => navigate('/reports')}>
            <Zap style={{ width: 16, height: 16, color: deadlineColor, margin: '0 auto 2px' }} />
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>MSO Deadline</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: deadlineColor }}>
              {daysToDeadline > 0 ? `${daysToDeadline}d` : 'DUE!'}
            </div>
          </div>
        </div>

        {/* Quick Stats Row */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <MiniStat icon={AlertCircle} label="Unpaid" value={String(ins.total_unpaid_count)} color="#ff9f0a"
            sub={<Rs amount={ins.total_pending} />} onClick={() => navigate('/unpaid')} />
          <MiniStat icon={TrendingUp} label="New This Month" value={String(todayData.new_customers_this_month || 0)} color="#0071e3"
            onClick={() => navigate('/customers')} />
          <MiniStat icon={Wifi} label="Temp DC" value={String(todayData.temp_disconnected || 0)} color="#ff3b30"
            onClick={() => navigate('/connections')} />
          <MiniStat icon={Clock} label="Yesterday" value={<Rs amount={todayData.yesterday_collected || 0} />} color="#5856d6"
            onClick={() => navigate('/payments')} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1B: FOLLOW UP TODAY — PRIORITY COLLECTION TARGETS
          Customers who paid last month but haven't paid this month
      ══════════════════════════════════════════════════════════════════ */}
      {priorityData && priorityData.customers && priorityData.customers.length > 0 && (
        <div className="glass-card animate-fade-in" style={{ padding: 20, borderColor: '#ff9f0a40' }}>
          <SectionHeader
            icon={AlertCircle}
            title={`Follow Up Today (${priorityData.total})`}
            color="#ff9f0a"
            action={
              <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                Paid {priorityData.last_month}, not {priorityData.this_month} · <Rs amount={priorityData.total_pending} />
              </span>
            }
          />
          <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginBottom: 10 }}>
            These customers paid last month but haven't renewed. Call or WhatsApp them first.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {priorityData.customers.slice(0, 10).map((c: any, i: number) => {
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary, #f5f5f7)',
                  transition: 'background 0.15s',
                }}>
                  {/* Name + details */}
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => navigate(`/customers/${c.customer_id}`)}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'flex', gap: 8 }}>
                      <span>{c.area || '—'}</span>
                      {c.mso && <span style={{ color: '#0071e3' }}>{c.mso}</span>}
                    </div>
                  </div>
                  {/* Amount */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ff9f0a' }}>
                      <Rs amount={c.pending_amount} />
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
                      <Rs amount={c.plan_amount} /> plan
                    </div>
                  </div>
                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {c.phone && (
                      <>
                        <a href={`tel:${c.phone}`} style={{
                          padding: 6, borderRadius: 'var(--radius-sm)', background: '#0071e315',
                          display: 'flex', alignItems: 'center', cursor: 'pointer',
                        }}>
                          <Phone style={{ width: 16, height: 16, color: '#0071e3' }} />
                        </a>
                        <a href={waLink(c.phone, c.name, c.pending_amount)} target="_blank" rel="noreferrer" style={{
                          padding: 6, borderRadius: 'var(--radius-sm)', background: '#25D36615',
                          display: 'flex', alignItems: 'center', cursor: 'pointer',
                        }}>
                          <MessageCircle style={{ width: 16, height: 16, color: '#25D366' }} />
                        </a>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {priorityData.total > 10 && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button
                onClick={() => navigate('/customers/not-renewed')}
                style={{ background: 'none', border: 'none', color: '#0071e3', fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                View All {priorityData.total} <ArrowRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2: DUE & OVERDUE — ACTIONABLE LIST
      ══════════════════════════════════════════════════════════════════ */}
      <div className="glass-card animate-fade-in" style={{ padding: 20, cursor: 'pointer' }}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a, button')) return; navigate('/unpaid'); }}>
        <SectionHeader
          icon={AlertCircle}
          title={`Due & Overdue (${ins.total_unpaid_count} customers)`}
          color="#ff9f0a"
          action={
            <button
              onClick={() => navigate('/customers?filter=unpaid')}
              style={{ background: 'none', border: 'none', color: '#0071e3', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              View All <ArrowRight style={{ width: 14, height: 14 }} />
            </button>
          }
        />
        {ins.top_unpaid.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-light)' }}>
            <CheckCircle2 style={{ width: 32, height: 32, marginBottom: 8, color: '#34c759' }} />
            <p>All customers have paid this month!</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ins.top_unpaid.slice(0, 8).map((c, i) => {
              const gapColor = c.gap_months === 0 ? '#34c759' : c.gap_months <= 2 ? '#ff9f0a' : '#ff3b30';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary, #f5f5f7)',
                  transition: 'background 0.15s',
                }}>
                  {/* Gap badge */}
                  <div style={{
                    minWidth: 44, height: 44, borderRadius: 'var(--radius-sm)',
                    background: `${gapColor}15`, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: gapColor }}>{c.gap_months === 0 ? 'DUE' : `${c.gap_months}m`}</span>
                  </div>

                  {/* Name + details */}
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => navigate(`/customers/${c.customer_id}`)}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'flex', gap: 8 }}>
                      <span>{c.area || '—'}</span>
                      {c.mso && <span style={{ color: '#0071e3' }}>{c.mso}</span>}
                    </div>
                  </div>

                  {/* Amount */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ff3b30' }}>
                      <Rs amount={c.pending_amount} />
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
                      {c.gap_months > 0 ? <>{c.gap_months + 1}m @ <Rs amount={c.plan_amount} /></> : <><Rs amount={c.plan_amount} /> plan</>}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {c.phone && (
                      <>
                        <a href={`tel:${c.phone}`} style={{
                          padding: 6, borderRadius: 'var(--radius-sm)', background: '#0071e315',
                          display: 'flex', alignItems: 'center', cursor: 'pointer',
                        }}>
                          <Phone style={{ width: 16, height: 16, color: '#0071e3' }} />
                        </a>
                        <a href={waLink(c.phone, c.name, c.pending_amount)} target="_blank" rel="noreferrer" style={{
                          padding: 6, borderRadius: 'var(--radius-sm)', background: '#25D36615',
                          display: 'flex', alignItems: 'center', cursor: 'pointer',
                        }}>
                          <MessageCircle style={{ width: 16, height: 16, color: '#25D366' }} />
                        </a>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {ins.total_unpaid_count > 8 && (
              <button
                onClick={() => navigate('/customers?filter=unpaid')}
                style={{
                  textAlign: 'center', padding: 10, background: 'none', border: `1px solid var(--border)`,
                  borderRadius: 'var(--radius-sm)', color: '#0071e3', fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                + {ins.total_unpaid_count - 8} more unpaid customers →
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3: MSO PROFITABILITY
      ══════════════════════════════════════════════════════════════════ */}
      <div className="glass-card animate-fade-in" style={{ padding: 20 }}>
        <SectionHeader icon={Tv} title="MSO Profitability" color="#5856d6" />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {ins.mso_profitability.map((m, i) => {
            const marginColor = m.margin_pct >= 50 ? '#34c759' : m.margin_pct >= 30 ? '#ff9f0a' : '#ff3b30';
            return (
              <div key={i} style={{
                flex: 1, minWidth: 200, padding: 16, borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-secondary, #f5f5f7)', borderLeft: `3px solid ${marginColor}`,
                cursor: 'pointer',
                transition: 'transform 0.12s ease',
              }}
              onClick={() => navigate('/connections')}
              onTouchStart={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
              onTouchEnd={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span style={{ fontSize: '1rem', fontWeight: 700 }}>{m.mso}</span>
                  <span style={{ fontSize: '1.3rem', fontWeight: 700, color: marginColor }}>{m.margin_pct}%</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Boxes</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{m.active_boxes}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>ARPU</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}><Rs amount={m.arpu} /></div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Revenue</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#34c759' }}><Rs amount={m.monthly_revenue} /></div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>MSO Cost</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#ff3b30' }}><Rs amount={m.total_cost} /></div>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Net Profit</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: marginColor }}><Rs amount={m.profit} /></div>
                  </div>
                </div>
                {m.cost_per_box > 0 && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 6 }}>
                    <Rs amount={m.cost_per_box} />/box MSO cost
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3.5: LAYA INTERNET SYNC
      ══════════════════════════════════════════════════════════════════ */}
      <div className="glass-card animate-fade-in" style={{ padding: 20 }}>
        <SectionHeader icon={Wifi} title="Laya Internet" color="#5e5ce6" />
        <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginBottom: 12 }}>
          Sync subscribers from Laya CRM
        </p>
        {layaMsg && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 10,
            background: layaMsg.startsWith('Error') ? 'rgba(255,59,48,0.08)' : 'rgba(52,199,89,0.08)',
            color: layaMsg.startsWith('Error') ? '#ff3b30' : '#34c759',
            fontSize: '0.82rem',
          }}>{layaMsg}</div>
        )}
        <button
          onClick={() => layaSyncMut.mutate()}
          disabled={layaSyncMut.isPending}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 16px', borderRadius: 10,
            border: '0.5px solid rgba(94,92,230,0.3)', background: 'transparent',
            color: '#5e5ce6', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
            opacity: layaSyncMut.isPending ? 0.6 : 1,
          }}
        >
          {layaSyncMut.isPending ? 'Syncing...' : 'Sync Subscribers from CRM'}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 4: REVENUE TREND + AGING + STB HEALTH
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* MRR Trend */}
        <div className="glass-card animate-fade-in" style={{ padding: 20, flex: 1, minWidth: 280 }}>
          <SectionHeader icon={BarChart3} title="6-Month Revenue Trend" color="#0071e3" />
          {ins.mrr_trend.length > 0 ? (
            <>
              <MiniBars data={ins.mrr_trend} height={50} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                {ins.mrr_trend.map((t, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
                      {t.month.split('-')[1]}/{t.month.split('-')[0].slice(2)}
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}><Rs amount={Number(t.total)} /></div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--text-light)', textAlign: 'center', padding: 20 }}>No trend data</p>
          )}
        </div>

        {/* Aging Buckets */}
        <div className="glass-card animate-fade-in" style={{ padding: 20, flex: 1, minWidth: 260 }}>
          <SectionHeader icon={Clock} title="Overdue Aging" color="#ff9f0a" />
          {(() => {
            const a = ins.aging;
            const buckets = [
              { label: 'Current', count: a.current, amt: a.current_amt, color: '#34c759' },
              { label: '1-2 months', count: a.b1_2, amt: a.b1_2_amt, color: '#ff9f0a' },
              { label: '3-5 months', count: a.b3_5, amt: a.b3_5_amt, color: '#ff6b00' },
              { label: '6+ months', count: a.b6plus, amt: a.b6plus_amt, color: '#ff3b30' },
            ];
            const maxCount = Math.max(...buckets.map(b => b.count), 1);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {buckets.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    onClick={() => navigate('/unpaid')}>
                    <span style={{ width: 75, fontSize: '0.8rem', color: 'var(--text-light)', flexShrink: 0 }}>{b.label}</span>
                    <div style={{ flex: 1, height: 24, background: 'var(--bg-secondary, #f5f5f7)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${(b.count / maxCount) * 100}%`, background: b.color,
                        borderRadius: 4, transition: 'width 0.5s ease', minWidth: 2,
                      }} />
                    </div>
                    <span style={{ width: 28, textAlign: 'right', fontSize: '0.85rem', fontWeight: 600, flexShrink: 0 }}>{b.count}</span>
                    <span style={{ width: 60, textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-light)', flexShrink: 0 }}>
                      <Rs amount={b.amt} />
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* STB Inventory Health */}
      <div className="glass-card animate-fade-in" style={{ padding: 20 }}>
        <SectionHeader
          icon={Package}
          title="STB Inventory Health"
          color="#5856d6"
          action={
            <button
              onClick={() => navigate('/inventory')}
              style={{ background: 'none', border: 'none', color: '#0071e3', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              Manage <ArrowRight style={{ width: 14, height: 14 }} />
            </button>
          }
        />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {totalStb > 0 ? (
            ['available', 'spare', 'assigned', 'faulty', 'with_mso'].map((status) => {
              const count = (ins.stb_health as any)[status] || 0;
              if (count === 0 && !['available', 'spare'].includes(status)) return null;
              const colors: Record<string, string> = {
                available: '#34c759', spare: '#0071e3', assigned: '#5856d6',
                faulty: '#ff3b30', with_mso: '#ff9f0a',
              };
              const labels: Record<string, string> = {
                available: 'Available', spare: 'Spare Stock', assigned: 'Assigned',
                faulty: 'Faulty/Repair', with_mso: 'With MSO',
              };
              const color = colors[status] || '#999';
              const pct = totalStb > 0 ? Math.round((count / totalStb) * 100) : 0;
              return (
                <div key={status} style={{
                  flex: 1, minWidth: 110, padding: 12, borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary, #f5f5f7)', textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'transform 0.12s ease',
                }}
                onClick={() => navigate('/inventory')}
                onTouchStart={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)'; }}
                onTouchEnd={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                >
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color }}>{count}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{labels[status] || status}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', marginTop: 2 }}>{pct}%</div>
                </div>
              );
            })
          ) : (
            <p style={{ color: 'var(--text-light)' }}>No STB inventory data</p>
          )}
        </div>
      </div>

    </div>
  );
}
