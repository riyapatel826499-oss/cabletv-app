import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, TrendingUp, ArrowRight, AlertCircle,
  CheckCircle2, Clock, Target, Flame, MapPin, Zap,
} from 'lucide-react';
import Rs from '../components/Rs';
import { useAuth } from '../hooks/useAuth';
import api from '../api/client';

// ── Types ──────────────────────────────────────────────────────────────────
interface AgentInsights {
  month: string;
  agent_name: string;
  today_collected: number;
  today_count: number;
  week_collected: number;
  week_count: number;
  month_collected: number;
  month_count: number;
  month_target: number;
  month_pct: number;
  yesterday_collected: number;
  last_month_collected: number;
  recent_payments: Array<{
    customer_id: string;
    customer_name: string;
    amount: number;
    mode: string;
    date: string;
    area: string;
    source: string;
    stb_no: string;
  }>;
  priority_count: number;
  my_open_sr: number;
  my_areas: Array<{ area: string; unpaid: number; pending: number }>;
  collection_streak: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(d: string) {
  if (!d) return '';
  const dt = new Date(d.replace(' ', 'T'));
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function isToday(d: string) {
  if (!d) return false;
  const dt = new Date(d.replace(' ', 'T'));
  if (isNaN(dt.getTime())) return false;
  const now = new Date();
  return dt.getDate() === now.getDate() && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
}

const MODE_COLORS: Record<string, string> = {
  cash: '#34c759',
  upi: '#0071e3',
  card: '#5856d6',
  bank: '#5856d6',
  cheque: '#ff9f0a',
  online: '#0071e3',
};

// ── Main Component ─────────────────────────────────────────────────────────
export default function AgentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: agentData, isLoading, isError } = useQuery<AgentInsights>({
    queryKey: ['agent-insights'],
    queryFn: () => api.get('/dashboard/agent-insights').then(r => r.data),
    refetchInterval: 30000,
  });

  // ── Loading state ──
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div style={{
          width: 40, height: 40, border: '3px solid var(--border)',
          borderTopColor: 'var(--primary, #0071e3)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  // ── Error state ──
  if (isError || !agentData) {
    return (
      <div className="glass-card animate-fade-in" style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>
        <AlertCircle style={{ width: 32, height: 32, marginBottom: 8, color: '#ff3b30' }} />
        <p>Unable to load dashboard. Please try again.</p>
      </div>
    );
  }

  const d = agentData;
  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const pctColor = d.month_pct >= 80 ? '#34c759' : d.month_pct >= 50 ? '#ff9f0a' : '#ff3b30';
  const pctBg = d.month_pct >= 80 ? '#34c75915' : d.month_pct >= 50 ? '#ff9f0a15' : '#ff3b3015';
  const pctBorder = d.month_pct >= 80 ? '#34c75930' : d.month_pct >= 50 ? '#ff9f0a30' : '#ff3b3030';

  const todaysPayments = (d.recent_payments || []).filter(p => isToday(p.date));
  const greetingName = d.agent_name || user?.name || 'Agent';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>

      {/* ═══ 1. HEADER + MONTH PROGRESS ══════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text)' }}>
          Hi, {greetingName} 👋
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{todayStr}</div>
      </div>

      {/* Big collection progress card */}
      <div className="glass-card animate-fade-in" style={{ padding: 20 }}>
        {/* Header: month + percentage badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{
              fontSize: '0.75rem', color: 'var(--text-light)', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Target style={{ width: 12, height: 12 }} />
              {d.month || new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} Target
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
              <Rs amount={d.month_collected} />
              <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-light)' }}>
                {' '}/ <Rs amount={d.month_target} />
              </span>
            </div>
          </div>
          <div style={{
            padding: '6px 14px', borderRadius: 20,
            background: pctBg, border: `1px solid ${pctBorder}`,
          }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 700, color: pctColor }}>
              {d.month_pct.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          height: 24, borderRadius: 12, background: 'var(--bg-secondary, #f0f0f3)',
          overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            height: '100%',
            width: `${Math.min(d.month_pct, 100)}%`,
            borderRadius: 12,
            background: d.month_pct >= 80
              ? 'linear-gradient(90deg, #30d158, #34c759)'
              : d.month_pct >= 50
                ? 'linear-gradient(90deg, #ffb340, #ff9f0a)'
                : 'linear-gradient(90deg, #ff6b6b, #ff3b30)',
            transition: 'width 0.8s ease',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            paddingRight: 10,
          }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}>
              <Rs amount={d.month_collected} />
            </span>
          </div>
        </div>

        {/* 3 mini cards: Today / Week / Last Month */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <div style={{
            flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
            background: '#34c75908',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Zap style={{ width: 12, height: 12, color: '#34c759' }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Today
              </span>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#34c759' }}>
              <Rs amount={d.today_collected} />
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
              {d.today_count} payment{d.today_count !== 1 ? 's' : ''}
            </div>
          </div>

          <div style={{
            flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
            background: '#0071e308',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <TrendingUp style={{ width: 12, height: 12, color: '#0071e3' }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                This Week
              </span>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0071e3' }}>
              <Rs amount={d.week_collected} />
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
              {d.week_count} payment{d.week_count !== 1 ? 's' : ''}
            </div>
          </div>

          <div style={{
            flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
            background: '#5856d608',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Clock style={{ width: 12, height: 12, color: '#5856d6' }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Last Month
              </span>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#5856d6' }}>
              <Rs amount={d.last_month_collected} />
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
              previous
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 2. COLLECTION STREAK ════════════════════════════════════════════ */}
      {d.collection_streak > 0 && (
        <div className="animate-fade-in" style={{
          padding: '12px 18px', borderRadius: 'var(--radius-md)',
          background: 'linear-gradient(135deg, #ff9f0a, #ff6b00)',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 2px 12px rgba(255, 159, 10, 0.3)',
        }}>
          <Flame style={{ width: 24, height: 24, color: '#fff', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
              {d.collection_streak} Day Streak!
            </span>
            <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.85)', marginLeft: 6 }}>
              Keep collecting daily to maintain it 🔥
            </span>
          </div>
        </div>
      )}

      {/* ═══ 3. QUICK ACTION — RECORD PAYMENT ════════════════════════════════ */}
      <button
        onClick={() => navigate('/payments/new')}
        style={{
          width: '100%', padding: '16px 20px', border: 'none', cursor: 'pointer',
          borderRadius: 'var(--radius-md)',
          background: 'linear-gradient(135deg, #0071e3, #005bb5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: '0 4px 14px rgba(0, 113, 227, 0.35)',
          transition: 'transform 0.12s ease',
        }}
        onTouchStart={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
        onTouchEnd={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
        onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
        onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
      >
        <Wallet style={{ width: 22, height: 22, color: '#fff' }} />
        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>Record Payment</span>
        <ArrowRight style={{ width: 20, height: 20, color: '#fff' }} />
      </button>

      {/* ═══ 4. TODAY'S COLLECTIONS ══════════════════════════════════════════ */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <CheckCircle2 style={{ width: 20, height: 20, color: '#34c759' }} />
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>Today's Collections</h2>
          {todaysPayments.length > 0 && (
            <span style={{
              fontSize: '0.75rem', color: 'var(--text-light)', marginLeft: 'auto',
              background: 'var(--bg-secondary, #f0f0f3)', padding: '2px 8px', borderRadius: 10,
            }}>
              {todaysPayments.length}
            </span>
          )}
        </div>

        {todaysPayments.length === 0 ? (
          <div className="glass-card animate-fade-in" style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>
            <Wallet style={{ width: 32, height: 32, marginBottom: 8, color: 'var(--text-light)' }} />
            <p style={{ margin: 0 }}>No collections yet today. Start collecting!</p>
          </div>
        ) : (
          <div className="glass-card animate-fade-in" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {todaysPayments.map((p, i) => {
              const modeColor = MODE_COLORS[(p.mode || '').toLowerCase()] || '#8e8e93';
              return (
                <div
                  key={i}
                  onClick={() => navigate(`/customers/${p.customer_id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    transition: 'background 0.15s', borderBottom: i < todaysPayments.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  {/* Customer info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {p.customer_name}
                    </div>
                    <div style={{
                      fontSize: '0.75rem', color: 'var(--text-light)',
                      display: 'flex', gap: 8, alignItems: 'center',
                    }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <MapPin style={{ width: 10, height: 10 }} />
                        {p.area || '—'}
                      </span>
                      {fmtTime(p.date) && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <Clock style={{ width: 10, height: 10 }} />
                          {fmtTime(p.date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#34c759' }}>
                      <Rs amount={p.amount} />
                    </div>
                  </div>

                  {/* Mode badge */}
                  <div style={{
                    padding: '3px 8px', borderRadius: 10,
                    background: `${modeColor}15`, flexShrink: 0,
                  }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: modeColor, textTransform: 'uppercase' }}>
                      {p.mode || '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ 5. FOLLOW UP TODAY ═══════════════════════════════════════════════ */}
      {d.priority_count > 0 && (
        <div className="glass-card animate-fade-in" style={{
          padding: 18, borderLeft: '4px solid #ff9f0a',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              padding: 8, borderRadius: 'var(--radius-sm)', background: '#ff9f0a15',
            }}>
              <AlertCircle style={{ width: 22, height: 22, color: '#ff9f0a' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
                {d.priority_count} customer{d.priority_count !== 1 ? 's' : ''} to follow up
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                Paid last month, not renewed yet
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/customers/not-renewed')}
            style={{
              width: '100%', padding: '10px 16px', border: 'none', cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
              background: '#ff9f0a15',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'background 0.15s',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#ff9f0a' }}>View Follow-up List</span>
            <ArrowRight style={{ width: 16, height: 16, color: '#ff9f0a' }} />
          </button>
        </div>
      )}

      {/* ═══ 6. MY AREAS ══════════════════════════════════════════════════════ */}
      {d.my_areas && d.my_areas.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <MapPin style={{ width: 20, height: 20, color: '#0071e3' }} />
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>Your Areas</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.my_areas.map((a, i) => (
              <div
                key={i}
                onClick={() => navigate('/unpaid')}
                className="glass-card animate-fade-in"
                style={{
                  padding: '14px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'transform 0.12s ease',
                }}
                onTouchStart={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
                onTouchEnd={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              >
                <div style={{
                  padding: 8, borderRadius: 'var(--radius-sm)', background: '#0071e315', flexShrink: 0,
                }}>
                  <MapPin style={{ width: 18, height: 18, color: '#0071e3' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.area}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'flex', gap: 10 }}>
                    <span>{a.unpaid} unpaid</span>
                    <span style={{ color: '#ff9f0a', fontWeight: 600 }}>
                      <Rs amount={a.pending} /> pending
                    </span>
                  </div>
                </div>
                <ArrowRight style={{ width: 18, height: 18, color: 'var(--text-light)', flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 7. SERVICE REQUESTS ══════════════════════════════════════════════ */}
      {d.my_open_sr > 0 && (
        <div
          onClick={() => navigate('/service-requests')}
          className="glass-card animate-fade-in"
          style={{
            padding: '16px 18px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
            borderLeft: '4px solid #ff3b30',
            transition: 'transform 0.12s ease',
          }}
          onTouchStart={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
          onTouchEnd={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
        >
          <div style={{
            padding: 8, borderRadius: 'var(--radius-sm)', background: '#ff3b3015', flexShrink: 0,
          }}>
            <AlertCircle style={{ width: 22, height: 22, color: '#ff3b30' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
              Open Service Requests ({d.my_open_sr})
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              Tap to view and resolve
            </div>
          </div>
          <ArrowRight style={{ width: 20, height: 20, color: '#ff3b30', flexShrink: 0 }} />
        </div>
      )}
    </div>
  );
}
