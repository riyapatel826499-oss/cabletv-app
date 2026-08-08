import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, layaApi, pushApi } from '../api';
import api from '../api/client';
import { useT } from '../lib/i18n';
import {
  Settings as SettingsIcon, Bell, Send, Check, Unlink,
  Shield, Loader2, RefreshCw, Wifi, Upload, Save, User,
} from 'lucide-react';

export default function Settings() {
  const queryClient = useQueryClient();
  const { t } = useT();
  const [botToken, setBotToken] = useState('');
  const [chatIds, setChatIds] = useState('');
  const [cutoffInput, setCutoffInput] = useState('');
  const [cutoffSaved, setCutoffSaved] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data: notifSettings, isLoading } = useQuery({
    queryKey: ['settings-notifications'],
    queryFn: async () => (await settingsApi.getNotifications()).data,
  });

  const updateNotifMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await settingsApi.updateNotifications(data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-notifications'] });
      flash('success', t('Settings updated'));
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => flash('error', err?.response?.data?.detail || t('Update failed')),
  });

  const verifyTelegramMut = useMutation({
    mutationFn: async () => {
      const data: { bot_token: string; chat_ids?: string } = { bot_token: botToken };
      if (chatIds) data.chat_ids = chatIds;
      return (await settingsApi.verifyTelegram(data)).data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings-notifications'] });
      flash('success', data.message || t('Telegram bot linked'));
      setBotToken('');
      setChatIds('');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => flash('error', err?.response?.data?.detail || t('Verification failed')),
  });

  const detectChatsMut = useMutation({
    mutationFn: async () => (await settingsApi.detectChats()).data,
    onSuccess: (data) => flash('success', data.message || t('Detected {n} users', { n: data.chat_count })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => flash('error', err?.response?.data?.detail || t('Detection failed')),
  });

  const unlinkMut = useMutation({
    mutationFn: async () => (await settingsApi.unlinkTelegram()).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-notifications'] });
      flash('success', t('Telegram bot unlinked'));
    },
  });

  function flash(type: 'success' | 'error', text: string) {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 4000);
  }

  // ── Laya state (hooks MUST stay above any early return) ──
  const [layaMsg, setLayaMsg] = useState('');

  const layaSyncMut = useMutation({
    mutationFn: async () => (await layaApi.syncSubscribers()).data,
    onSuccess: (data) => setLayaMsg(`Synced: ${data.created} new, ${data.updated} updated (${data.total_in_crm} total)`),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => setLayaMsg(`Error: ${err?.response?.data?.detail || 'Sync failed'}`),
  });

  const layaStmtMut = useMutation({
    mutationFn: async (content: string) => (await layaApi.importStatement(content)).data,
    onSuccess: (data) => setLayaMsg(`Statement: ${data.payments_created} payments created, ${data.collection_pending?.length || 0} pending collection`),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => setLayaMsg(`Error: ${err?.response?.data?.detail || 'Import failed'}`),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) layaStmtMut.mutate(content);
    };
    reader.readAsText(file);
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ width: 40, height: 40, border: '4px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  const telegramLinked = notifSettings?.telegram_linked;
  const chatCount = notifSettings?.telegram_chat_count ?? 0;


  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsIcon style={{ width: 28, height: 28 }} />
          {t('Settings')}
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          {t('Configure notifications and Telegram bot')}
        </p>
      </div>

      {/* Status Flash */}
      {statusMsg && (
        <div style={{
          padding: '12px 16px', borderRadius: 12,
          background: statusMsg.type === 'success' ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
          color: statusMsg.type === 'success' ? '#34c759' : '#ff3b30',
          fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {statusMsg.type === 'success' ? <Check style={{ width: 18, height: 18 }} /> : <Shield style={{ width: 18, height: 18 }} />}
          {statusMsg.text}
        </div>
      )}

      {/* Notification Settings */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bell style={{ width: 18, height: 18, color: '#0071e3' }} /> {t('Notifications')}
        </h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginBottom: 18 }}>
          {t('Control when payment alerts are sent to Telegram')}
        </p>

        {/* Enable/Disable */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>{t('Enable Notifications')}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{t('Master toggle for all alerts')}</p>
          </div>
          <ToggleSwitch
            checked={notifSettings?.notify_enabled === 'true'}
            onChange={(checked) => updateNotifMut.mutate({ notify_enabled: String(checked) })}
          />
        </div>

        {/* Payment Scope */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>{t('Payment Alerts')}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{t('Which payments trigger a notification')}</p>
          </div>
          <select
            value={notifSettings?.notify_payment_scope ?? 'disconnected'}
            onChange={e => updateNotifMut.mutate({ notify_payment_scope: e.target.value })}
            style={{
              padding: '8px 14px', borderRadius: 10, border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            <option value="all">{t('All payments')}</option>
            <option value="disconnected">{t('Disconnected customers only')}</option>
          </select>
        </div>

        {/* Service Scope */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>{t('Service Alerts')}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{t('Which service requests trigger notifications')}</p>
          </div>
          <select
            value={notifSettings?.notify_service_scope ?? 'all'}
            onChange={e => updateNotifMut.mutate({ notify_service_scope: e.target.value })}
            style={{
              padding: '8px 14px', borderRadius: 10, border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            <option value="all">{t('All tickets')}</option>
            <option value="high_priority">{t('High priority only')}</option>
          </select>
        </div>

        {/* Cutoff Date */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>{t('Payment Cutoff Date')}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{t('Day of month after which unpaid connections are disconnected')}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min="1"
              max="28"
              value={cutoffInput || notifSettings?.cutoff_date || '12'}
              onChange={e => {
                setCutoffInput(e.target.value);
                setCutoffSaved(false);
              }}
              style={{
                width: 56, textAlign: 'center', padding: '8px 8px', borderRadius: 10,
                border: cutoffInput && cutoffInput !== (notifSettings?.cutoff_date ?? '12')
                  ? '0.5px solid #0071e3' : '0.5px solid var(--border)',
                background: 'var(--bg-secondary)',
                color: 'var(--text)', fontSize: '0.85rem', fontWeight: 600,
              }}
            />
            {/* Save button — only shows when value changed */}
            {cutoffInput && cutoffInput !== (notifSettings?.cutoff_date ?? '12') && Number(cutoffInput) >= 1 && Number(cutoffInput) <= 28 && !cutoffSaved && (
              <button
                onClick={() => {
                  updateNotifMut.mutate({ cutoff_date: cutoffInput });
                  setCutoffSaved(true);
                }}
                style={{
                  padding: '6px 14px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #5aa2ff 0%, #8b5cff 100%)', color: '#fff',
                  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,113,227,0.3)',
                }}
              >
                {t('Save')}
              </button>
            )}
            {/* Saved confirmation */}
            {cutoffSaved && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: '0.78rem', fontWeight: 500, color: '#34c759',
              }}>
                <Check style={{ width: 14, height: 14 }} /> {t('Saved')}
              </span>
            )}
            {cutoffInput && (Number(cutoffInput) < 1 || Number(cutoffInput) > 28) && (
              <span style={{ fontSize: '0.72rem', color: '#ff3b30' }}>{t('1-28 only')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Telegram Configuration */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Send style={{ width: 18, height: 18, color: '#0071e3' }} /> {t('Telegram Bot')}
        </h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginBottom: 18 }}>
          {t('Link a Telegram bot to receive payment and service alerts')}
        </p>

        {/* Status Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px',
          borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, marginBottom: 16,
          background: telegramLinked ? 'rgba(52,199,89,0.1)' : 'rgba(142,142,147,0.1)',
          color: telegramLinked ? '#34c759' : '#8e8e93',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: telegramLinked ? '#34c759' : '#8e8e93' }} />
          {telegramLinked ? t('Linked ({n} users)', { n: chatCount }) : t('Not linked')}
        </div>

        {telegramLinked ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => detectChatsMut.mutate()}
              disabled={detectChatsMut.isPending}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
                borderRadius: 12, border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
                color: 'var(--text)', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
              }}
            >
              {detectChatsMut.isPending ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <RefreshCw style={{ width: 16, height: 16 }} />}
              {t('Detect Users')}
            </button>
            <button
              onClick={() => {
                if (confirm(t('Unlink Telegram bot? You will stop receiving alerts.'))) {
                  unlinkMut.mutate();
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
                borderRadius: 12, border: '0.5px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.05)',
                color: '#ff3b30', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
              }}
            >
              <Unlink style={{ width: 16, height: 16 }} /> {t('Unlink Bot')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>
                {t('Bot Token (from @BotFather)')}
              </label>
              <input
                type="password"
                value={botToken}
                onChange={e => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
                  color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'monospace',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>
                {t('Chat IDs (optional — leave blank to auto-detect)')}
              </label>
              <input
                type="text"
                value={chatIds}
                onChange={e => setChatIds(e.target.value)}
                placeholder="e.g. 123456789,987654321"
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
                  color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'monospace',
                }}
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 4 }}>
                {t('To auto-detect: send /start to your bot first, then click Verify')}
              </p>
            </div>
            <button
              onClick={() => verifyTelegramMut.mutate()}
              disabled={!botToken || verifyTelegramMut.isPending}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 20px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #5aa2ff 0%, #8b5cff 100%)', color: '#fff', fontSize: '0.88rem', fontWeight: 600,
                cursor: 'pointer', opacity: (!botToken || verifyTelegramMut.isPending) ? 0.5 : 1,
              }}
            >
              {verifyTelegramMut.isPending ? (
                <><Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> {t('Verifying...')}</>
              ) : (
                <><Check style={{ width: 16, height: 16 }} /> {t('Verify & Link')}</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Laya Internet Integration ────────────────────────── */}
      <div className="glass-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Wifi style={{ width: 18, height: 18, color: '#5e5ce6' }} />
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
            {t('Laya Internet')}
          </h2>
        </div>

        {layaMsg && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: layaMsg.startsWith('Error') ? 'rgba(255,59,48,0.08)' : 'rgba(52,199,89,0.08)',
            border: `0.5px solid ${layaMsg.startsWith('Error') ? 'rgba(255,59,48,0.2)' : 'rgba(52,199,89,0.2)'}`,
            color: layaMsg.startsWith('Error') ? '#ff3b30' : '#34c759',
            padding: '10px 14px', borderRadius: 'var(--radius-xs)',
            fontSize: '0.82rem', marginBottom: 12,
          }}>
            {layaMsg}
            <button onClick={() => setLayaMsg('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '1rem' }}>×</button>
          </div>
        )}

        <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginBottom: 14 }}>
          {t('Sync subscribers from Laya CRM and import monthly statements for auto-reconciliation.')}
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => layaSyncMut.mutate()}
            disabled={layaSyncMut.isPending}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 16px', borderRadius: 'var(--radius-xs)',
              border: '0.5px solid rgba(94,92,230,0.3)', background: 'transparent',
              color: '#5e5ce6', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
              opacity: layaSyncMut.isPending ? 0.6 : 1,
            }}
          >
            {layaSyncMut.isPending ? (
              <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> {t('Syncing...')}</>
            ) : (
              <><RefreshCw style={{ width: 14, height: 14 }} /> {t('Sync Subscribers')}</>
            )}
          </button>

          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 16px', borderRadius: 'var(--radius-xs)',
              border: '0.5px solid rgba(0,113,227,0.3)', background: 'transparent',
              color: '#0071e3', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
              opacity: layaStmtMut.isPending ? 0.6 : 1,
            }}
          >
            {layaStmtMut.isPending ? (
              <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> {t('Importing...')}</>
            ) : (
              <><Upload style={{ width: 14, height: 14 }} /> {t('Import Statement')}</>
            )}
            <input
              type="file"
              accept=".xls,.html"
              onChange={handleFileUpload}
              disabled={layaStmtMut.isPending}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {/* ── Branding / White-label Settings ── */}
      <BrandingSection />

      {/* ── Notification Preferences (admin) ── */}
      <NotificationPrefsSection />

    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative', width: 48, height: 28, borderRadius: 14,
        border: 'none', cursor: 'pointer',
        background: checked ? '#34c759' : 'rgba(120,120,128,0.32)',
        transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 22 : 2,
        width: 24, height: 24, borderRadius: '50%', background: '#fff',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

const BRANDING_FIELDS: { key: string; label: string; type: string; hint?: string }[] = [
  { key: 'business_name', label: 'Business Name', type: 'text' },
  { key: 'phone', label: 'Display Phone', type: 'text', hint: 'e.g. +91 77085 51139' },
  { key: 'care_phone', label: 'Care Phone', type: 'text', hint: 'e.g. 7708551139' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'gstin', label: 'GSTIN', type: 'text' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'upi_id', label: 'Monthly UPI ID', type: 'text', hint: 'For regular monthly payments' },
  { key: 'upi_reconnect_id', label: 'Reconnection UPI ID', type: 'text', hint: 'For reconnection & receipt' },
  { key: 'map_lat', label: 'Map Latitude', type: 'number', hint: 'e.g. 11.0974473' },
  { key: 'map_lng', label: 'Map Longitude', type: 'number', hint: 'e.g. 77.2013613' },
  { key: 'map_radius_km', label: 'Map Radius (km)', type: 'number', hint: 'e.g. 3' },
  { key: 'commission_per_rate', label: 'Collection Point Commission (₹/payment)', type: 'number', hint: 'e.g. 5 — paid to shops per successful payment they collect' },
  { key: 'app_name', label: 'App Name', type: 'text', hint: 'e.g. Wasool' },
  {
    key: 'wa_receipt_template',
    label: 'WhatsApp Receipt Message (English)',
    type: 'textarea',
    hint: 'Placeholders: {business} {customer} {customer_id} {amount} {month} {mode} {date} {valid_till} {upi} {phone}',
  },
  {
    key: 'wa_receipt_template_ta',
    label: 'WhatsApp Receipt Message (தமிழ்)',
    type: 'textarea',
    hint: 'Tamil block sent below English. Extra placeholders: {month_ta} {mode_ta} {date_ta} {valid_till_ta}',
  },
];

const CHIME_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: 'System default' },
  { value: 'payment', label: 'Payment chime' },
  { value: 'reconnection', label: 'Reconnection chime' },
  { value: 'chime', label: 'Soft chime' },
  { value: 'ding', label: 'Cash ding' },
  { value: 'beep', label: 'Digital beep' },
  { value: 'bell', label: 'Gentle bell' },
];

function BrandingSection() {
  const queryClient = useQueryClient();
  const { t } = useT();
  const [form, setForm] = useState<Record<string, string | number | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading } = useQuery<Record<string, string | number>>({
    queryKey: ['operator-settings'],
    queryFn: async () => (await api.get('/operator-settings')).data,
  });

  useEffect(() => {
    if (data) setForm({ ...data });
  }, [data]);

  const set = (key: string, v: string) => {
    const field = BRANDING_FIELDS.find(f => f.key === key);
    setForm(p => ({ ...p, [key]: field?.type === 'number' ? Number(v) || 0 : v }));
  };

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (api as any).patch('/operator-settings', { updates: form });
      setMsg({ ok: true, text: t('Branding saved!') });
      queryClient.invalidateQueries({ queryKey: ['operator-settings'] });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || t('Failed to save') });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 4000);
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border)',
    fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: 'var(--bg-secondary)',
    color: 'var(--text)',
  };

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '1.1rem' }}>🎨</span> {t('Branding / White-label')}
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginBottom: 18 }}>
        {t('These appear on the public website, customer portal, staff panels, and WhatsApp messages.')}
      </p>

      {isLoading ? (
        <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{t('Loading…')}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {BRANDING_FIELDS.map(f => (
              <div key={f.key} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                  {t(f.label)}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={String(form[f.key] ?? '')}
                    onChange={e => set(f.key, e.target.value)}
                    rows={f.key.startsWith('wa_receipt_template') ? 10 : 3}
                    style={{ ...inp, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }}
                  />
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : 'text'}
                    step={f.type === 'number' ? 'any' : undefined}
                    value={String(form[f.key] ?? '')}
                    onChange={e => set(f.key, e.target.value)}
                    style={inp}
                  />
                )}
                {f.hint && <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>{t(f.hint)}</div>}
              </div>
            ))}
          </div>

          {/* Prorata toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18, padding: '14px 16px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>{t('Prorata billing')}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
                {t('ON = partial-month charges on reconnection & late-month payments (SSN style).')}<br />
                {t('OFF = always charge full month(s), no day-based splits.')}
              </div>
            </div>
            <button
              onClick={() => setForm(p => ({ ...p, prorata_enabled: !(p.prorata_enabled ?? true) }))}
              style={{
                minWidth: 52, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer',
                background: (form.prorata_enabled ?? true) ? '#22c55e' : '#94a3b8',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
              aria-label={t('Toggle prorata')}
            >
              <span style={{
                position: 'absolute', top: 3, left: (form.prorata_enabled ?? true) ? 27 : 3,
                width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>

          {(form.prorata_enabled ?? true) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
              <div>
                <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                  {t('Billing cycle day')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={String(form.prorata_billing_day ?? 13)}
                  onChange={e => setForm(p => ({ ...p, prorata_billing_day: Number(e.target.value) || 13 }))}
                  style={inp}
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>
                  {t('Reconnect prorata counts days till this − 1. Default 13 (cycle 13th–12th).')}
                </div>
              </div>
              <div>
                <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                  {t('Prorata-until day')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={String(form.prorata_target_day ?? 16)}
                  onChange={e => setForm(p => ({ ...p, prorata_target_day: Number(e.target.value) || 16 }))}
                  style={inp}
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>
                  {t('Late-month payments charge till this day of next month. Default 16.')}
                </div>
              </div>
            </div>
          )}

          {/* Service-request SLA escalation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 20, padding: '14px 16px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>{t('Service request auto-escalation (SLA)')}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
                {t('ON = if a service agent does not acknowledge a ticket within the time below, it is escalated to admins (bell + push).')}
              </div>
            </div>
            <button
              onClick={() => setForm(p => ({ ...p, sr_sla_enabled: !(p.sr_sla_enabled ?? false) }))}
              style={{
                minWidth: 52, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer',
                background: (form.sr_sla_enabled ?? false) ? '#22c55e' : '#94a3b8',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
              aria-label={t('Toggle SLA escalation')}
            >
              <span style={{
                position: 'absolute', top: 3, left: (form.sr_sla_enabled ?? false) ? 27 : 3,
                width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>

          {(form.sr_sla_enabled ?? false) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
              <div>
                <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                  {t('Acknowledge within (minutes)')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={String(form.sr_sla_minutes ?? 15)}
                  onChange={e => setForm(p => ({ ...p, sr_sla_minutes: Number(e.target.value) || 15 }))}
                  style={inp}
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>
                  {t('Escalate if not acknowledged within this many minutes. Default 15.')}
                </div>
              </div>
            </div>
          )}

          {/* WhatsApp ping to customer on escalation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, padding: '14px 16px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>{t('WhatsApp customer ping on escalation')}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
                {t('ON = when a ticket escalates, the customer also gets a WhatsApp message that their issue is being followed up urgently.')}
              </div>
            </div>
            <button
              onClick={() => setForm(p => ({ ...p, sr_escalation_wa: !(p.sr_escalation_wa ?? false) }))}
              style={{
                minWidth: 52, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer',
                background: (form.sr_escalation_wa ?? false) ? '#22c55e' : '#94a3b8',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
              aria-label={t('Toggle WhatsApp escalation ping')}
            >
              <span style={{
                position: 'absolute', top: 3, left: (form.sr_escalation_wa ?? false) ? 27 : 3,
                width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>

          {(form.sr_escalation_wa ?? false) && (
            <div style={{ marginTop: 14 }}>
              <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                {t('Escalation WhatsApp message')}
              </label>
              <textarea
                value={String(form.wa_escalation_template ?? '')}
                onChange={e => setForm(p => ({ ...p, wa_escalation_template: e.target.value }))}
                rows={4}
                style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>
                {t('Placeholders: {business} {customer} {ticket_no} {type} {care_phone}')}
              </div>
            </div>
          )}

          {/* Notification chimes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 18 }}>
            <div>
              <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                {t('Payment chime')}
              </label>
              <select
                value={String(form.notif_sound_payment ?? 'payment')}
                onChange={e => setForm(p => ({ ...p, notif_sound_payment: e.target.value }))}
                style={inp}
              >
                {CHIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </select>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>
                {t('Sound played when a payment is recorded.')}
              </div>
            </div>
            <div>
              <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                {t('Reconnection chime')}
              </label>
              <select
                value={String(form.notif_sound_reconnection ?? 'reconnection')}
                onChange={e => setForm(p => ({ ...p, notif_sound_reconnection: e.target.value }))}
                style={inp}
              >
                {CHIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </select>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>
                {t('Sound played when a connection is reconnected.')}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontWeight: 500, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                {t('General chime')}
              </label>
              <select
                value={String(form.notif_sound_general ?? 'default')}
                onChange={e => setForm(p => ({ ...p, notif_sound_general: e.target.value }))}
                style={inp}
              >
                {CHIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </select>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: 3 }}>
                {t('Sound for all other notifications (reminders, system).')}
              </div>
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving}
            style={{
              marginTop: 20, padding: '12px 24px', borderRadius: 12, border: 'none',
              background: saving ? 'var(--text-light)' : '#2563eb', color: '#fff', fontWeight: 600, fontSize: '0.9rem',
              cursor: saving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {saving ? t('Saving…') : t('Save Branding')}
          </button>

          {msg && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6,
              background: msg.ok ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
              color: msg.ok ? '#34c759' : '#ff3b30', fontSize: '0.82rem', fontWeight: 500,
            }}>
              {msg.ok ? <Check size={16} /> : <Shield size={16} />}
              {msg.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Notification Preferences (admin: which notification types reach which user) ──

function NotificationPrefsSection() {
  const queryClient = useQueryClient();
  const { t } = useT();
  const [drafts, setDrafts] = useState<Record<number, Record<string, boolean>>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['notif-prefs'],
    queryFn: async () => {
      try {
        return (await pushApi.prefs()).data;
      } catch (e: any) {
        if (e?.response?.status === 403) { setForbidden(true); return null; }
        throw e;
      }
    },
    retry: false,
  });

  const users: { id: number; username: string; name: string; role: string; prefs: Record<string, boolean> }[] = data?.users || [];
  const types: Record<string, string> = data?.types || {};

  useEffect(() => {
    if (!users.length) return;
    const d: Record<number, Record<string, boolean>> = {};
    users.forEach(u => { d[u.id] = { ...(u.prefs || {}) }; });
    setDrafts(d);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Missing key in prefs = enabled (backend default). Drafts hold explicit true/false.
  const isOn = (userId: number, type: string) => (drafts[userId]?.[type] ?? true) !== false;

  const toggle = (userId: number, type: string) => {
    setDrafts(prev => {
      const p = { ...(prev[userId] || {}) };
      p[type] = !(p[type] ?? true);
      return { ...prev, [userId]: p };
    });
  };

  async function saveUser(userId: number) {
    setSavingId(userId);
    setMsg(null);
    try {
      await pushApi.updatePrefs(userId, drafts[userId] || {});
      setMsg({ ok: true, text: t('Saved') });
      queryClient.invalidateQueries({ queryKey: ['notif-prefs'] });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || t('Failed to save') });
    }
    setSavingId(null);
    setTimeout(() => setMsg(null), 3500);
  }

  if (forbidden) {
    return (
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bell size={16} /> {t('Notification Preferences')}
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
          {t('Only Admin can manage notification settings.')}
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Bell size={16} /> {t('Notification Preferences')}
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginBottom: 18 }}>
        {t('Choose which notification types each staff member receives on their phone.')}
      </p>

      {isLoading ? (
        <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{t('Loading…')}</div>
      ) : users.length === 0 ? (
        <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{t('No staff users found.')}</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620, fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-light)', fontWeight: 500 }}>
                    {t('Staff')}
                  </th>
                  {Object.entries(types).map(([key, label]) => (
                    <th key={key} style={{ textAlign: 'center', padding: '8px 6px', color: 'var(--text-light)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {t(label)}
                    </th>
                  ))}
                  <th style={{ padding: '8px 10px' }} />
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(94,92,230,0.12)', color: '#5e5ce6', flexShrink: 0,
                        }}>
                          <User size={15} />
                        </span>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{u.name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>{u.username} · {u.role}</div>
                        </div>
                      </div>
                    </td>
                    {Object.keys(types).map(key => (
                      <td key={key} style={{ textAlign: 'center', padding: '10px 6px' }}>
                        <ToggleSwitch checked={isOn(u.id, key)} onChange={() => toggle(u.id, key)} />
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', padding: '10px' }}>
                      <button
                        onClick={() => saveUser(u.id)}
                        disabled={savingId === u.id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 10,
                          border: 'none', background: savingId === u.id ? 'var(--text-light)' : '#2563eb',
                          color: '#fff', fontWeight: 600, fontSize: '0.78rem', cursor: savingId === u.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {savingId === u.id
                          ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                          : <Save size={13} />}
                        {savingId === u.id ? t('Saving…') : t('Save')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 12 }}>
            {t('Regular payments play one sound; reconnection alerts play a different sound on your phone.')}
          </p>

          {msg && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6,
              background: msg.ok ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
              color: msg.ok ? '#34c759' : '#ff3b30', fontSize: '0.82rem', fontWeight: 500,
            }}>
              {msg.ok ? <Check size={16} /> : <Shield size={16} />}
              {msg.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
