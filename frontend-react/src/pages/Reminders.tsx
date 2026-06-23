import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { remindersApi } from '../api';
import { fmtRs, fmtDate } from '../lib/format';
import StbCopy from '../components/StbCopy';
import {
  Bell,
  Send,
  CheckCircle2,
  XCircle,
  Search,
  History,
  CheckCheck,
  Square,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface ReminderCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  area?: string;
  stb_no?: string;
  plan_name?: string;
  plan_amount?: number;
  expiry_date?: string;
  months_due?: number;
  pending_amount?: number;
}

interface DueResponse {
  reminders: ReminderCustomer[];
  total: number;
  total_amount: number;
}

interface StatusResponse {
  today_sent: number;
  total_sent: number;
  wa_connected: boolean;
}

interface HistoryEntry {
  id: number;
  sent_at: string;
  count: number;
  message?: string;
  status: string;
  sent_by?: string;
}

interface HistoryResponse {
  history: HistoryEntry[];
}

export default function Reminders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customMessage, setCustomMessage] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);

  const { data: dueData, isLoading } = useQuery({
    queryKey: ['reminders', 'due'],
    queryFn: async () => (await remindersApi.due()).data as DueResponse,
  });

  const { data: statusData } = useQuery({
    queryKey: ['reminders', 'status'],
    queryFn: async () => (await remindersApi.status()).data as StatusResponse,
    refetchInterval: 30_000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['reminders', 'history'],
    queryFn: async () => (await remindersApi.history()).data as HistoryResponse,
  });

  const reminders = dueData?.reminders ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? reminders.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q) ||
          (c.stb_no || '').toLowerCase().includes(q),
      )
    : reminders;

  const allFilteredIds = filtered.map((c) => c.customer_id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allFilteredIds));
  }

  function selectNone() {
    setSelected(new Set());
  }

  const sendMut = useMutation({
    mutationFn: async (payload: { customer_ids: string[]; message?: string }) =>
      (await remindersApi.send(payload)).data as { sent: number; failed: number; results?: unknown[] },
    onSuccess: (resp) => {
      setSendResult({ sent: resp.sent, failed: resp.failed });
      setConfirmOpen(false);
      setShowMessageInput(false);
      setCustomMessage('');
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: () => {
      setConfirmOpen(false);
    },
  });

  function openConfirm() {
    if (selected.size === 0) return;
    setConfirmOpen(true);
  }

  function handleSend() {
    if (selected.size === 0) return;
    const payload: { customer_ids: string[]; message?: string } = {
      customer_ids: Array.from(selected),
    };
    if (customMessage.trim()) payload.message = customMessage.trim();
    sendMut.mutate(payload);
  }

  const todaySent = statusData?.today_sent ?? 0;
  const totalSent = statusData?.total_sent ?? 0;
  const waConnected = statusData?.wa_connected ?? false;
  const history = historyData?.history ?? [];

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
          <Bell style={{ width: 28, height: 28 }} />
          Reminders
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          Send WhatsApp renewal reminders to customers with overdue subscriptions
        </p>
      </div>

      {/* Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(0,113,227,0.1)' }}>
            <Send style={{ width: 22, height: 22, color: '#0071e3' }} />
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sent Today
            </p>
            <p style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{todaySent}</p>
          </div>
        </div>
        <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(52,199,89,0.1)' }}>
            <CheckCircle2 style={{ width: 22, height: 22, color: '#34c759' }} />
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Sent
            </p>
            <p style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{totalSent}</p>
          </div>
        </div>
        <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: waConnected ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
            }}
          >
            {waConnected ? (
              <CheckCircle2 style={{ width: 22, height: 22, color: '#34c759' }} />
            ) : (
              <XCircle style={{ width: 22, height: 22, color: '#ff3b30' }} />
            )}
          </div>
          <div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              WhatsApp
            </p>
            <span
              style={{
                display: 'inline-block',
                marginTop: 4,
                padding: '3px 10px',
                borderRadius: 20,
                fontSize: '0.78rem',
                fontWeight: 600,
                background: waConnected ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
                color: waConnected ? '#34c759' : '#ff3b30',
              }}
            >
              {waConnected ? 'Connected' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Send Result Banner */}
      {sendResult && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background:
              sendResult.failed > 0 ? 'rgba(255,159,10,0.08)' : 'rgba(52,199,89,0.08)',
            border: `0.5px solid ${sendResult.failed > 0 ? 'rgba(255,159,10,0.2)' : 'rgba(52,199,89,0.2)'}`,
            color: sendResult.failed > 0 ? '#ff9f0a' : '#34c759',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.88rem',
          }}
        >
          <CheckCircle2 style={{ width: 18, height: 18 }} />
          <span>
            Sent <strong>{sendResult.sent}</strong> reminder(s)
            {sendResult.failed > 0 && (
              <> — <strong>{sendResult.failed}</strong> failed</>
            )}
          </span>
          <button
            onClick={() => setSendResult(null)}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '1rem' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Search + Action Bar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 240px', position: 'relative' }}>
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
            style={{ width: '100%', padding: '10px 14px 10px 40px', borderRadius: 'var(--radius-sm)', fontSize: '0.88rem' }}
          />
        </div>
        <button
          onClick={allSelected ? selectNone : selectAll}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '0.5px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text)',
            fontSize: '0.82rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {allSelected ? <Square style={{ width: 14, height: 14 }} /> : <CheckCheck style={{ width: 14, height: 14 }} />}
          {allSelected ? 'Select None' : 'Select All'}
        </button>
      </div>

      {/* Custom Message Toggle */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowMessageInput((v) => !v)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: '0.78rem',
              fontWeight: 500,
              border: showMessageInput ? 'none' : '0.5px solid var(--border)',
              background: showMessageInput ? '#0071e3' : 'transparent',
              color: showMessageInput ? '#fff' : 'var(--text-light)',
              cursor: 'pointer',
            }}
          >
            Custom Message
          </button>
          {showMessageInput && (
            <input
              type="text"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Optional custom reminder text (leave blank for default)"
              className="glass-input"
              style={{ flex: '1 1 300px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
            />
          )}
          <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
            {selected.size} selected
          </span>
          <button
            onClick={openConfirm}
            disabled={selected.size === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 18px',
              borderRadius: 'var(--radius-sm)',
              background: selected.size === 0 ? '#005bb5' : '#0071e3',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 600,
              border: 'none',
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
              marginLeft: 'auto',
            }}
          >
            <Send style={{ width: 16, height: 16 }} />
            Send Reminders ({selected.size})
          </button>
        </div>
      )}

      {/* Due List */}
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
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
            <Bell style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.5 }} />
            {search ? 'No matching customers' : 'No reminders due'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => (allSelected ? selectNone() : selectAll())}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Area</th>
                  <th style={{ textAlign: 'right' }}>Plan</th>
                  <th style={{ textAlign: 'center' }}>Months Due</th>
                  <th>Expiry</th>
                  <th style={{ textAlign: 'right' }}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const checked = selected.has(c.customer_id);
                  return (
                    <tr key={c.customer_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(c.customer_id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td>
                        <span
                          style={{ fontWeight: 500, color: '#0071e3', cursor: 'pointer' }}
                          onClick={() => navigate(`/customers/${c.customer_id}`)}
                        >
                          {c.name || '--'}
                        </span>
                        {c.stb_no && (
                          <div style={{ marginTop: 2 }}>
                            <StbCopy stb={c.stb_no} />
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{c.phone || '--'}</td>
                      <td style={{ fontSize: '0.85rem' }}>{c.area || '--'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                        {c.plan_amount ? fmtRs(c.plan_amount) : '--'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {c.months_due ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 12,
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              background: c.months_due >= 3 ? 'rgba(255,59,48,0.1)' : 'rgba(255,159,10,0.1)',
                              color: c.months_due >= 3 ? '#ff3b30' : '#ff9f0a',
                            }}
                          >
                            {c.months_due}m
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                        {c.expiry_date ? fmtDate(c.expiry_date) : '--'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#ff3b30' }}>
                        {c.pending_amount ? fmtRs(c.pending_amount) : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History */}
      <div className="glass-card" style={{ padding: '20px 24px' }}>
        <h2
          style={{
            fontSize: '0.95rem',
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <History style={{ width: 18, height: 18, color: 'var(--text-light)' }} />
          Reminder History
        </h2>
        {!history.length ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', padding: '8px 0' }}>
            No reminders sent yet
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((h) => (
              <div
                key={h.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '0.5px solid var(--border)',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-xs)',
                    background: h.status === 'success' || h.status === 'sent' ? 'rgba(52,199,89,0.1)' : 'rgba(255,159,10,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Send style={{ width: 14, height: 14, color: h.status === 'success' || h.status === 'sent' ? '#34c759' : '#ff9f0a' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>
                    {h.count} reminder(s) sent
                    {h.sent_by && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-light)', fontWeight: 400 }}>
                        {' '}by {h.sent_by}
                      </span>
                    )}
                  </p>
                  {h.message && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
                      "{h.message.length > 80 ? h.message.slice(0, 80) + '...' : h.message}"
                    </p>
                  )}
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>{fmtDate(h.sent_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmOpen && (
        <div
          onClick={() => setConfirmOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card"
            style={{ padding: 28, borderRadius: 16, maxWidth: 380, width: '90%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ padding: 10, borderRadius: 12, background: 'rgba(0,113,227,0.1)' }}>
                <AlertCircle style={{ width: 24, height: 24, color: '#0071e3' }} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>Send Reminders?</h3>
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginBottom: 20 }}>
              This will send WhatsApp renewal reminders to <strong style={{ color: 'var(--text)' }}>{selected.size}</strong> customer(s).
              {customMessage.trim() && (
                <>
                  <br />
                  <span style={{ fontSize: '0.8rem', marginTop: 6, display: 'block' }}>
                    Custom message: "{customMessage.trim().slice(0, 60)}
                    {customMessage.trim().length > 60 ? '...' : ''}"
                  </span>
                </>
              )}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  border: '0.5px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sendMut.isPending}
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#0071e3',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: sendMut.isPending ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {sendMut.isPending ? (
                  <>
                    <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send style={{ width: 14, height: 14 }} /> Send
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
