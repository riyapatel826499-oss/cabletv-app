import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useT } from '../lib/i18n';
import { Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

type Settings = Record<string, string | number>;

const SETTINGS_FIELDS: { key: string; label: string; type: string; hint?: string }[] = [
  { key: 'business_name', label: 'Business Name', type: 'text' },
  { key: 'phone', label: 'Display Phone', type: 'text', hint: 'e.g. +91 77085 51139' },
  { key: 'care_phone', label: 'Care/WhatsApp Phone', type: 'text', hint: 'e.g. 7708551139' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'gstin', label: 'GSTIN', type: 'text' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'upi_id', label: 'Monthly UPI ID', type: 'text', hint: 'For regular monthly payments' },
  { key: 'upi_reconnect_id', label: 'Reconnection UPI ID', type: 'text', hint: 'For reconnection & receipt payments' },
  { key: 'map_lat', label: 'Map Latitude', type: 'number', hint: 'e.g. 11.0974473' },
  { key: 'map_lng', label: 'Map Longitude', type: 'number', hint: 'e.g. 77.2013613' },
  { key: 'map_radius_km', label: 'Map Radius (km)', type: 'number', hint: 'e.g. 3' },
  { key: 'app_name', label: 'App Name', type: 'text', hint: 'e.g. Wasool' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e6ef',
  fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color .15s',
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600, fontSize: '0.82rem', color: '#1d1d1f', marginBottom: 4, display: 'block',
};

export default function AppSettings() {
  const queryClient = useQueryClient();
  const { t } = useT();
  const [form, setForm] = useState<Settings>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading } = useQuery<Settings>({
    queryKey: ['operator-settings'],
    queryFn: async () => (await api.get('/operator-settings')).data,
  });

  useEffect(() => {
    if (data) setForm({ ...data });
  }, [data]);

  const set = (key: string, v: string) => {
    const field = SETTINGS_FIELDS.find(f => f.key === key);
    setForm(p => ({ ...p, [key]: field?.type === 'number' ? Number(v) || 0 : v }));
  };

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.patch('/operator-settings', { updates: form });
      setMsg({ ok: true, text: t('Settings saved!') });
      queryClient.invalidateQueries({ queryKey: ['operator-settings'] });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || t('Failed to save') });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 4000);
  }

  if (isLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#86868b' }}>{t('Loading…')}</div>;
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 40px' }}>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 4 }}>{t('White-label Settings')}</h1>
      <p style={{ fontSize: '0.82rem', color: '#86868b', marginBottom: 24 }}>
        {t('These values are shown across the public website, customer portal, staff panels, and WhatsApp messages.')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {SETTINGS_FIELDS.map(f => (
          <div key={f.key}>
            <label style={labelStyle}>{t(f.label)}</label>
            {f.type === 'textarea' ? (
              <textarea
                value={String(form[f.key] ?? '')}
                onChange={e => set(f.key, e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                value={String(form[f.key] ?? '')}
                onChange={e => set(f.key, e.target.value)}
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = '#5aa2ff'; }}
                onBlur={e => { e.target.style.borderColor = '#e2e6ef'; }}
              />
            )}
            {f.hint && <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 3 }}>{t(f.hint)}</div>}
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{
          marginTop: 28, width: '100%', padding: '14px', borderRadius: 12, border: 'none',
          background: saving ? '#9ca3af' : '#2563eb', color: '#fff', fontWeight: 700, fontSize: '1rem',
          cursor: saving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', gap: 8,
        }}
      >
        {saving ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={18} />}
        {saving ? t('Saving…') : t('Save Settings')}
      </button>

      {msg && (
        <div style={{
          marginTop: 16, padding: '12px 14px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8,
          background: msg.ok ? '#e7f8ee' : '#fdeaea', color: msg.ok ? '#137a3f' : '#b91c1c', fontSize: '0.85rem', fontWeight: 600,
        }}>
          {msg.ok ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
