import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { surrenderApi } from '../api';
import { fmtDate } from '../lib/format';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Power,
  AlertTriangle,
} from 'lucide-react';

export default function Surrender() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewAction, setReviewAction] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reactivateId, setReactivateId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const { data: resp, isLoading } = useQuery({
    queryKey: ['surrender-requests', filter],
    queryFn: async () => (await surrenderApi.listRequests(filter !== 'all' ? filter : undefined)).data,
    refetchInterval: 15000,
  });

  const reviewMut = useMutation({
    mutationFn: async ({ id, action, notes }: { id: number; action: string; notes?: string }) =>
      (await surrenderApi.review(id, action, notes)).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['surrender-requests'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setMsg(data.message || 'Request reviewed');
      setReviewId(null);
      setReviewNotes('');
    },
  });

  const reactivateMut = useMutation({
    mutationFn: async (customerId: string) =>
      (await surrenderApi.reactivate(customerId)).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['surrender-requests'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setMsg(data.message || 'Customer reactivated');
      setReactivateId(null);
    },
  });

  const requests: Array<Record<string, unknown>> = resp?.requests || resp || [];
  const filtered = search
    ? requests.filter(
        (r) =>
          String(r.customer_name || '').toLowerCase().includes(search.toLowerCase()) ||
          String(r.customer_id || '').toLowerCase().includes(search.toLowerCase()),
      )
    : requests;

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    borderRadius: 'var(--radius-sm)',
    border: '0.5px solid var(--border)',
    padding: '16px 20px',
  };

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 'var(--radius-xs)',
    border: '0.5px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: '0.82rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'var(--transition)',
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Surrender Requests
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 2 }}>
          Manage customer surrender and reactivation requests
        </p>
      </div>

      {/* Message banner */}
      {msg && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(52,199,89,0.08)',
            border: '0.5px solid rgba(52,199,89,0.2)',
            color: '#34c759',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
          }}
        >
          <CheckCircle2 style={{ width: 16, height: 16 }} />
          {msg}
          <button
            onClick={() => setMsg('')}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '1rem' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {['pending', 'approved', 'rejected', 'all'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...btnStyle,
              background: filter === f ? '#0071e3' : 'transparent',
              color: filter === f ? '#fff' : 'var(--text)',
              border: filter === f ? 'none' : '0.5px solid var(--border)',
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search
            style={{ width: 16, height: 16, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer..."
            className="glass-input"
            style={{ padding: '8px 12px 8px 36px', fontSize: '0.85rem', width: 220 }}
          />
        </div>
      </div>

      {/* Review Modal */}
      {reviewId !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setReviewId(null)}
        >
          <div
            className="glass-card"
            style={{ padding: '24px', width: '90%', maxWidth: 420, borderRadius: 'var(--radius-sm)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <AlertTriangle style={{ width: 20, height: 20, color: '#ff9f0a' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
                {reviewAction === 'approve' ? 'Approve' : 'Reject'} Surrender Request
              </h2>
            </div>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Review notes (optional)..."
              className="glass-input"
              style={{ width: '100%', padding: '10px 14px', fontSize: '0.85rem', minHeight: 70, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setReviewId(null)} style={btnStyle}>
                Cancel
              </button>
              <button
                onClick={() =>
                  reviewMut.mutate({ id: reviewId, action: reviewAction, notes: reviewNotes.trim() || undefined })
                }
                disabled={reviewMut.isPending}
                style={{
                  ...btnStyle,
                  background: reviewAction === 'approve' ? '#34c759' : '#ff3b30',
                  color: '#fff',
                  border: 'none',
                  opacity: reviewMut.isPending ? 0.6 : 1,
                }}
              >
                {reviewMut.isPending ? 'Processing...' : 'Confirm'}
              </button>
            </div>
            {reviewMut.isError && (
              <p style={{ color: '#ff3b30', fontSize: '0.8rem', marginTop: 10 }}>
                {String(reviewMut.error instanceof Error ? reviewMut.error.message : 'Failed to review')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Reactivate confirm */}
      {reactivateId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setReactivateId(null)}
        >
          <div
            className="glass-card"
            style={{ padding: '24px', width: '90%', maxWidth: 380, borderRadius: 'var(--radius-sm)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Power style={{ width: 20, height: 20, color: '#34c759' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Reactivate Customer</h2>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginBottom: 16 }}>
              Reactivate customer {reactivateId}? This will restore their connections to Active status.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setReactivateId(null)} style={btnStyle}>
                Cancel
              </button>
              <button
                onClick={() => reactivateMut.mutate(reactivateId)}
                disabled={reactivateMut.isPending}
                style={{
                  ...btnStyle,
                  background: '#34c759',
                  color: '#fff',
                  border: 'none',
                  opacity: reactivateMut.isPending ? 0.6 : 1,
                }}
              >
                {reactivateMut.isPending ? 'Reactivating...' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div
            style={{
              width: 36,
              height: 36,
              border: '4px solid rgba(0,113,227,0.2)',
              borderTopColor: '#0071e3',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}>
          No surrender requests found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((r, i) => {
            const status = String(r.status || 'pending');
            const statusColor =
              status === 'approved' ? '#34c759' : status === 'rejected' ? '#ff3b30' : '#ff9f0a';
            return (
              <div key={i} style={cardStyle}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Status badge */}
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      borderRadius: 20,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      background: `${statusColor}1a`,
                      color: statusColor,
                    }}
                  >
                    {status === 'approved' ? (
                      <CheckCircle2 style={{ width: 12, height: 12 }} />
                    ) : status === 'rejected' ? (
                      <XCircle style={{ width: 12, height: 12 }} />
                    ) : (
                      <Clock style={{ width: 12, height: 12 }} />
                    )}
                    {status}
                  </span>

                  {/* Customer info */}
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <p style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)' }}>
                      {String(r.customer_name || 'Unknown')}
                    </p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>
                      ID: {String(r.customer_id || '--')} · STB: {String(r.stb_no || '--')}
                    </p>
                  </div>

                  {/* Dates */}
                  <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-light)' }}>
                    <p>Requested: {fmtDate(String(r.requested_at || ''))}</p>
                    {r.reviewed_at ? <p>Reviewed: {fmtDate(String(r.reviewed_at))}</p> : null}
                  </div>
                </div>

                {/* Reason */}
                {r.reason ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: 10 }}>
                    Reason: {String(r.reason)}
                  </p>
                ) : null}

                {/* Review notes */}
                {r.review_notes ? (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: 4, fontStyle: 'italic' }}>
                    Notes: {String(r.review_notes)}
                  </p>
                ) : null}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {status === 'pending' && (
                    <>
                      <button
                        onClick={() => {
                          setReviewId(Number(r.id));
                          setReviewAction('approve');
                        }}
                        style={{
                          ...btnStyle,
                          background: 'rgba(52,199,89,0.08)',
                          color: '#34c759',
                          borderColor: 'rgba(52,199,89,0.2)',
                        }}
                      >
                        <CheckCircle2 style={{ width: 14, height: 14 }} /> Approve
                      </button>
                      <button
                        onClick={() => {
                          setReviewId(Number(r.id));
                          setReviewAction('reject');
                        }}
                        style={{
                          ...btnStyle,
                          background: 'rgba(255,59,48,0.08)',
                          color: '#ff3b30',
                          borderColor: 'rgba(255,59,48,0.2)',
                        }}
                      >
                        <XCircle style={{ width: 14, height: 14 }} /> Reject
                      </button>
                    </>
                  )}
                  {status === 'approved' && (
                    <button
                      onClick={() => setReactivateId(String(r.customer_id))}
                      style={{
                        ...btnStyle,
                        background: 'rgba(0,113,227,0.08)',
                        color: '#0071e3',
                        borderColor: 'rgba(0,113,227,0.2)',
                      }}
                    >
                      <Power style={{ width: 14, height: 14 }} /> Reactivate
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
