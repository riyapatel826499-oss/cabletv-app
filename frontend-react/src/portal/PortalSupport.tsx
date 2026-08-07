import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './portalApi';
import { useT } from '../lib/i18n';

type Complaint = {
  ticket_no: string;
  type: string;
  category: string | null;
  description: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  remarks: string | null;
};

type ComplaintsRes = {
  count: number;
  complaints: Complaint[];
};

const PRESETS = [
  { label: '\uD83D\uDCFA No signal on TV', desc: 'No signal on TV' },
  { label: '\uD83D\uDD0C Internet not working', desc: 'Internet not working' },
  { label: '\uD83D\uDCF1 Set-top box issue', desc: 'Set-top box issue' },
  { label: '\uD83D\uDCB3 Payment not reflecting', desc: 'Payment not reflecting in my account' },
  { label: '\uD83D\uDD0C Slow internet speed', desc: 'Slow internet speed' },
];

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  open:              { color: '#92400e', bg: '#fef6e7' },
  acknowledged:      { color: '#92400e', bg: '#fef6e7' },
  'in_progress':     { color: '#1e40af', bg: '#dbeafe' },
  on_the_way:        { color: '#1e40af', bg: '#dbeafe' },
  resolved:          { color: '#137a3f', bg: '#e7f8ee' },
  settled:           { color: '#137a3f', bg: '#e7f8ee' },
  closed:            { color: '#6b7280', bg: '#f3f4f6' },
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', acknowledged: 'Acknowledged', 'in_progress': 'In Progress',
  on_the_way: 'On the way', resolved: 'Resolved', settled: 'Settled', closed: 'Closed',
};

function statusBadge(s: string) {
  const st = STATUS_STYLE[s] || { color: '#1d1d1f', bg: '#f3f4f6' };
  return { ...st, borderRadius: 999, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600 };
}

export default function PortalSupport() {
  const { t } = useT();
  const qc = useQueryClient();
  const [desc, setDesc] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [submitted, setSubmitted] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = useQuery<ComplaintsRes>({
    queryKey: ['portal-complaints'],
    queryFn: async () => (await api.get('/complaints')).data,
  });

  const createComplaint = useMutation({
    mutationFn: async (description: string) =>
      api.post('/complaints', { type: 'complaint', description }),
    onSuccess: (res) => {
      setSubmitted(res.data.ticket_no);
      setDesc('');
      setShowCustom(false);
      qc.invalidateQueries({ queryKey: ['portal-complaints'] });
    },
    onError: () => alert(t('Could not submit. Try again later.')),
  });

  const handlePreset = (desc: string) => {
    createComplaint.mutate(desc);
  };

  return (
    <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 4 }}>{t('Support')}</h2>
      <p style={{ fontSize: '0.8rem', color: '#86868b', marginBottom: 16 }}>
        {t('Report a problem or check past reports')}
      </p>

      {/* Success message */}
      {submitted && (
        <div
          style={{
            background: '#e7f8ee', color: '#137a3f', borderRadius: 12, padding: '12px 14px',
            fontSize: '0.85rem', marginBottom: 16,
          }}
        >
          {t('Submitted. Ticket:')} <b>{submitted}</b>. {t("We'll contact you soon.")}
          <button
            onClick={() => setSubmitted('')}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: '#137a3f', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
          >
            {t('Dismiss')}
          </button>
        </div>
      )}

      {/* Preset problem buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            disabled={createComplaint.isPending}
            onClick={() => handlePreset(p.desc)}
            style={{
              textAlign: 'left', padding: '10px 14px', borderRadius: 12, fontSize: '0.85rem',
              border: '1px solid #e2e6ef', background: '#fff', cursor: 'pointer',
              color: '#1d1d1f', fontWeight: 500, transition: 'background 0.1s',
            }}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {/* Custom problem */}
      {!showCustom ? (
        <button
          onClick={() => setShowCustom(true)}
          style={{
            width: '100%', padding: '10px', borderRadius: 12, fontSize: '0.85rem',
            border: '1px dashed #9ca3af', background: 'transparent', color: '#6b7280', cursor: 'pointer',
            marginBottom: 20,
          }}
        >
          {t('+ Describe your problem')}
        </button>
      ) : (
        <div style={{ marginBottom: 20 }}>
          <textarea
            ref={textRef}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={t('Describe your problem...')}
            rows={3}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12, fontSize: '0.85rem',
              border: '1px solid #e2e6ef', outline: 'none', resize: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              disabled={!desc.trim() || createComplaint.isPending}
              onClick={() => handlePreset(desc.trim())}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
                border: 'none', background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)', color: '#fff',
                cursor: desc.trim() && !createComplaint.isPending ? 'pointer' : 'not-allowed',
                opacity: desc.trim() && !createComplaint.isPending ? 1 : 0.6,
              }}
            >
              {createComplaint.isPending ? t('Submitting…') : t('Submit')}
            </button>
            <button
              onClick={() => { setShowCustom(false); setDesc(''); }}
              style={{
                padding: '10px 16px', borderRadius: 10, fontSize: '0.85rem',
                border: '1px solid #e2e6ef', background: '#fff', color: '#6b7280', cursor: 'pointer',
              }}
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Past reports */}
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8, marginTop: 8 }}>
        {t('Past Reports')}
      </h3>
      {isLoading ? (
        <div style={{ color: '#86868b', fontSize: '0.85rem' }}>{t('Loading…')}</div>
      ) : !data?.complaints?.length ? (
        <div style={{ color: '#86868b', fontSize: '0.85rem', padding: 12, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          {t('No past reports.')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.complaints.map((c) => (
            <div
              key={c.ticket_no}
              style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
                padding: '10px 12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem', flex: 1, minWidth: 0 }}>
                  {c.description}
                </span>
                <span style={statusBadge(c.status)}>{t(STATUS_LABEL[c.status] || c.status)}</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>
                {c.ticket_no}
                {c.created_at ? ` \u00b7 ${new Date(c.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
              </div>
              {c.remarks && (
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                  \ud83d\udcac {c.remarks}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
