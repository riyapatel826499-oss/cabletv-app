import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { auditApi } from '../api';
import { fmtDate } from '../lib/format';
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';

const PER_PAGE = 50;

interface AuditEntry {
  id: number;
  action: string;
  entity: string;
  entity_id?: string | number;
  old_value?: string | null;
  new_value?: string | null;
  user_name?: string;
  created_at: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  per_page: number;
}

const ENTITY_OPTIONS = [
  '', 'Customer', 'Payment', 'Connection', 'Plan', 'Employee', 'Operator', 'ServiceRequest', 'Reminder', 'Setting',
];
const ACTION_OPTIONS = ['', 'Create', 'Update', 'Delete'];

function actionColor(action: string): { bg: string; color: string } {
  const a = action.toLowerCase();
  if (a.includes('create')) return { bg: 'rgba(52,199,89,0.1)', color: '#34c759' };
  if (a.includes('update') || a.includes('change')) return { bg: 'rgba(0,113,227,0.1)', color: '#0071e3' };
  if (a.includes('delete') || a.includes('remove')) return { bg: 'rgba(255,59,48,0.1)', color: '#ff3b30' };
  return { bg: 'rgba(255,159,10,0.1)', color: '#ff9f0a' };
}

// Try to parse a JSON old/new value into a brief change summary.
function summarizeChange(
  oldRaw?: string | null,
  newRaw?: string | null,
): string {
  if (!oldRaw && !newRaw) return '--';

  function parse(raw?: string | null): Record<string, unknown> | string | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return raw;
    }
  }

  const oldV = parse(oldRaw);
  const newV = parse(newRaw);

  // Both objects → diff keys.
  if (oldV && typeof oldV === 'object' && newV && typeof newV === 'object') {
    const oldObj = oldV as Record<string, unknown>;
    const newObj = newV as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(newObj), ...Object.keys(oldObj)]));
    const changes: string[] = [];
    for (const k of keys) {
      if (oldObj[k] !== newObj[k]) {
        const ov = JSON.stringify(oldObj[k]) ?? '∅';
        const nv = JSON.stringify(newObj[k]) ?? '∅';
        changes.push(`${k}: ${truncate(ov)} → ${truncate(nv)}`);
      }
    }
    return changes.length ? changes.slice(0, 3).join(', ') + (changes.length > 3 ? ` (+${changes.length - 3} more)` : '') : 'no changes';
  }

  // Pure scalar swap.
  if (oldV !== newV) {
    const o = oldV === null ? '∅' : truncate(String(oldV));
    const n = newV === null ? '∅' : truncate(String(newV));
    return `${o} → ${n}`;
  }
  return '--';
}

function truncate(s: string, max = 30): string {
  const s2 = s.replace(/^"(.*)"$/, '$1');
  return s2.length > max ? s2.slice(0, max) + '…' : s2;
}

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['audit-log', page, entity, action],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(PER_PAGE),
      };
      if (entity) params.entity = entity;
      if (action) params.action = action;
      return (await auditApi.list(params)).data as AuditResponse;
    },
    placeholderData: keepPreviousData,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

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
          <ScrollText style={{ width: 28, height: 28 }} />
          Audit Log
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          {total} {total === 1 ? 'entry' : 'entries'} recorded
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
          className="glass-input"
          style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.88rem', cursor: 'pointer' }}
        >
          {ENTITY_OPTIONS.map((e) => (
            <option key={e} value={e}>
              {e || 'All Entities'}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="glass-input"
          style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.88rem', cursor: 'pointer' }}
        >
          {ACTION_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a || 'All Actions'}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {entries.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
            <ScrollText style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.5 }} />
            {isFetching ? 'Loading...' : 'No audit entries found'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Entity ID</th>
                  <th>Changes</th>
                  <th>User</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const ac = actionColor(e.action);
                  return (
                    <tr key={e.id}>
                      <td>
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: 20,
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            background: ac.bg,
                            color: ac.color,
                            textTransform: 'capitalize',
                          }}
                        >
                          {e.action || '--'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{e.entity || '--'}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{e.entity_id ?? '--'}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-light)', maxWidth: 320 }}>
                        {summarizeChange(e.old_value, e.new_value)}
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{e.user_name || '--'}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>{fmtDate(e.created_at)}</td>
                    </tr>
                  );
                })}
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
