import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../api';
import {
  Settings as SettingsIcon, Bell, Send, Check, Unlink,
  Shield, Loader2, RefreshCw,
} from 'lucide-react';

export default function Settings() {
  const queryClient = useQueryClient();
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
      flash('success', 'Settings updated');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => flash('error', err?.response?.data?.detail || 'Update failed'),
  });

  const verifyTelegramMut = useMutation({
    mutationFn: async () => {
      const data: { bot_token: string; chat_ids?: string } = { bot_token: botToken };
      if (chatIds) data.chat_ids = chatIds;
      return (await settingsApi.verifyTelegram(data)).data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings-notifications'] });
      flash('success', data.message || 'Telegram bot linked');
      setBotToken('');
      setChatIds('');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => flash('error', err?.response?.data?.detail || 'Verification failed'),
  });

  const detectChatsMut = useMutation({
    mutationFn: async () => (await settingsApi.detectChats()).data,
    onSuccess: (data) => flash('success', data.message || `Detected ${data.chat_count} users`),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => flash('error', err?.response?.data?.detail || 'Detection failed'),
  });

  const unlinkMut = useMutation({
    mutationFn: async () => (await settingsApi.unlinkTelegram()).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-notifications'] });
      flash('success', 'Telegram bot unlinked');
    },
  });

  function flash(type: 'success' | 'error', text: string) {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 4000);
  }

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
          Settings
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          Configure notifications and Telegram bot
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
          <Bell style={{ width: 18, height: 18, color: '#0071e3' }} /> Notifications
        </h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginBottom: 18 }}>
          Control when payment alerts are sent to Telegram
        </p>

        {/* Enable/Disable */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>Enable Notifications</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Master toggle for all alerts</p>
          </div>
          <ToggleSwitch
            checked={notifSettings?.notify_enabled === 'true'}
            onChange={(checked) => updateNotifMut.mutate({ notify_enabled: String(checked) })}
          />
        </div>

        {/* Payment Scope */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>Payment Alerts</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Which payments trigger a notification</p>
          </div>
          <select
            value={notifSettings?.notify_payment_scope ?? 'disconnected'}
            onChange={e => updateNotifMut.mutate({ notify_payment_scope: e.target.value })}
            style={{
              padding: '8px 14px', borderRadius: 10, border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            <option value="all">All payments</option>
            <option value="disconnected">Disconnected customers only</option>
          </select>
        </div>

        {/* Service Scope */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>Service Alerts</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Which service requests trigger notifications</p>
          </div>
          <select
            value={notifSettings?.notify_service_scope ?? 'all'}
            onChange={e => updateNotifMut.mutate({ notify_service_scope: e.target.value })}
            style={{
              padding: '8px 14px', borderRadius: 10, border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            <option value="all">All tickets</option>
            <option value="high_priority">High priority only</option>
          </select>
        </div>

        {/* Cutoff Date */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)' }}>Payment Cutoff Date</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Day of month after which unpaid connections are disconnected</p>
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
                  background: '#0071e3', color: '#fff',
                  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,113,227,0.3)',
                }}
              >
                Save
              </button>
            )}
            {/* Saved confirmation */}
            {cutoffSaved && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: '0.78rem', fontWeight: 500, color: '#34c759',
              }}>
                <Check style={{ width: 14, height: 14 }} /> Saved
              </span>
            )}
            {cutoffInput && (Number(cutoffInput) < 1 || Number(cutoffInput) > 28) && (
              <span style={{ fontSize: '0.72rem', color: '#ff3b30' }}>1-28 only</span>
            )}
          </div>
        </div>
      </div>

      {/* Telegram Configuration */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Send style={{ width: 18, height: 18, color: '#0071e3' }} /> Telegram Bot
        </h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginBottom: 18 }}>
          Link a Telegram bot to receive payment and service alerts
        </p>

        {/* Status Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px',
          borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, marginBottom: 16,
          background: telegramLinked ? 'rgba(52,199,89,0.1)' : 'rgba(142,142,147,0.1)',
          color: telegramLinked ? '#34c759' : '#8e8e93',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: telegramLinked ? '#34c759' : '#8e8e93' }} />
          {telegramLinked ? `Linked (${chatCount} user${chatCount !== 1 ? 's' : ''})` : 'Not linked'}
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
              Detect Users
            </button>
            <button
              onClick={() => {
                if (confirm('Unlink Telegram bot? You will stop receiving alerts.')) {
                  unlinkMut.mutate();
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
                borderRadius: 12, border: '0.5px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.05)',
                color: '#ff3b30', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
              }}
            >
              <Unlink style={{ width: 16, height: 16 }} /> Unlink Bot
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>
                Bot Token (from @BotFather)
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
                Chat IDs (optional — leave blank to auto-detect)
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
                To auto-detect: send /start to your bot first, then click Verify
              </p>
            </div>
            <button
              onClick={() => verifyTelegramMut.mutate()}
              disabled={!botToken || verifyTelegramMut.isPending}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 20px', borderRadius: 12, border: 'none',
                background: '#0071e3', color: '#fff', fontSize: '0.88rem', fontWeight: 600,
                cursor: 'pointer', opacity: (!botToken || verifyTelegramMut.isPending) ? 0.5 : 1,
              }}
            >
              {verifyTelegramMut.isPending ? (
                <><Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Verifying...</>
              ) : (
                <><Check style={{ width: 16, height: 16 }} /> Verify & Link</>
              )}
            </button>
          </div>
        )}
      </div>
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
