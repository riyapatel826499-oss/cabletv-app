import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { setToken } from './portalApi';

const BUSINESS = 'Sree Selvanaayakki Amman Cables & Internet Services';

const btn: React.CSSProperties = {
  width: '100%', padding: '14px', borderRadius: 12, fontSize: '1rem',
  fontWeight: 600, border: 'none', cursor: 'pointer', color: '#fff',
  background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)',
};

type Lang = 'en' | 'ta';
const T: Record<string, { en: string; ta: string }> = {
  title:     { en: 'Customer Portal', ta: '\u0bb5\u0bbe\u0b9f\u0bbf\u0b95\u0bcd\u0b95\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd \u0ba8\u0bc1\u0bb4\u0bc8\u0bb5\u0bbe\u0baf\u0bcd' },
  subtitle:  { en: 'Enter your STB number (or Customer ID) and registered mobile number to log in.', ta: '\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd STB \u0b8e\u0ba3\u0bcd (\u0b85) \u0bb5\u0bbe\u0b9f\u0bbf\u0b95\u0bcd\u0b95\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd ID \u0bae\u0bb1\u0bcd\u0bb1\u0bc1\u0bae\u0bcd \u0baa\u0ba4\u0bbf\u0bb5\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd\u0ba4 \u0bae\u0bca\u0baa\u0bc8\u0bb2\u0bcd \u0b8e\u0ba3\u0bcd\u0ba3\u0bc8 \u0b89\u0bb3\u0bcd\u0bb3\u0bbf\u0b9f\u0bb5\u0bc1\u0bae\u0bcd.' },
  noOtp:     { en: 'No password or OTP needed.', ta: '\u0b95\u0b9f\u0bb5\u0bc1\u0b9a\u0bcd\u0b9a\u0bca\u0bb2\u0bcd \u0b85\u0bb2\u0bcd\u0bb2\u0ba4\u0bc1 OTP \u0ba4\u0bc7\u0bb5\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8.' },
  idPlace:   { en: 'STB number / Customer ID (e.g. SSA-000176)', ta: 'STB \u0b8e\u0ba3\u0bcd / \u0bb5\u0bbe\u0b9f\u0bbf\u0b95\u0bcd\u0b95\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd ID (\u0b89\u0ba4\u0bbe: SSA-000176)' },
  phonePlace:{ en: 'Registered mobile number', ta: '\u0baa\u0ba4\u0bbf\u0bb5\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd\u0ba4 \u0bae\u0bca\u0baa\u0bc8\u0bb2\u0bcd \u0b8e\u0ba3\u0bcd' },
  login:     { en: 'Log in', ta: '\u0b89\u0bb3\u0bcd\u0ba8\u0bc1\u0bb4\u0bc8\u0baf\u0bb5\u0bc1\u0bae\u0bcd' },
  wait:      { en: 'Please wait\u2026', ta: '\u0ba4\u0baf\u0bb5\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd\u0ba4\u0bc1 \u0b95\u0bbe\u0ba4\u0bcd\u0ba4\u0bbf\u0bb0\u0bc1\u0b95\u0bcd\u0b95\u0bb5\u0bc1\u0bae\u0bcd\u2026' },
  trouble:   { en: 'Having trouble? Call', ta: '\u0b9a\u0bbf\u0bb0\u0bae\u0bae\u0bcd? \u0b85\u0bb4\u0bc8\u0b95\u0bcd\u0b95\u0bb5\u0bc1\u0bae\u0bcd' },
};

export default function PortalLogin() {
  const [lang, setLang] = useState<Lang>('en');
  const [cid, setCid] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const t = (k: string) => T[k]?.[lang] ?? k;

  async function login() {
    const c = cid.trim().toUpperCase();
    const p = phone.trim().replace(/\D/g, '');
    if (!c || !p) { setErr('Please fill in both fields.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/customer/quick-login', { customer_id: c, phone: p });
      setToken(res.data.token);
      navigate('/app/portal/home');
    } catch {
      setErr('STB / Customer ID and phone do not match. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px', background: 'linear-gradient(135deg, #eef2ff, #f6f7fb)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 380, background: '#fff', borderRadius: 20,
          boxShadow: '0 16px 50px rgba(0,0,0,0.12)', padding: 28, textAlign: 'center',
          position: 'relative',
        }}
      >
        {/* Language toggle */}
        <div style={{ position: 'absolute', top: 12, right: 16, display: 'flex', gap: 4 }}>
          {(['en', 'ta'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600, border: 'none',
                cursor: 'pointer',
                background: lang === l ? '#2563eb' : 'transparent',
                color: lang === l ? '#fff' : '#6b7280',
              }}
            >
              {l === 'en' ? 'EN' : '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd'}
            </button>
          ))}
        </div>

        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0b1020', marginBottom: 4 }}>{BUSINESS}</div>
        <div style={{ fontSize: '0.85rem', color: '#86868b', marginBottom: 20 }}>{t('title')}</div>

        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 16 }}>
          {t('subtitle')}
          <div style={{ fontSize: '0.72rem', marginTop: 4, color: '#9ca3af' }}>{t('noOtp')}</div>
        </div>

        <input
          placeholder={t('idPlace')}
          value={cid}
          onChange={(e) => setCid(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12, fontSize: '0.9rem',
            border: '1px solid #e2e6ef', outline: 'none', marginBottom: 12, boxSizing: 'border-box',
          }}
        />
        <input
          type="tel"
          placeholder={t('phonePlace')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12, fontSize: '0.9rem',
            border: '1px solid #e2e6ef', outline: 'none', marginBottom: 16, boxSizing: 'border-box',
          }}
        />

        {err && (
          <div style={{ background: '#fdeaea', color: '#b91c1c', borderRadius: 12, padding: '10px 12px', fontSize: '0.85rem', marginBottom: 12 }}>
            {lang === 'ta' ? 'STB / \u0bb5\u0bbe\u0b9f\u0bbf\u0b95\u0bcd\u0b95\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd ID \u0bae\u0bb1\u0bcd\u0bb1\u0bc1\u0bae\u0bcd \u0bae\u0bca\u0baa\u0bc8\u0bb2\u0bcd \u0b8e\u0ba3\u0bcd \u0b92\u0ba4\u0bcd\u0ba4\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8. \u0bae\u0bc0\u0ba3\u0bcd\u0b9f\u0bc1\u0bae\u0bcd \u0bae\u0bc1\u0baf\u0bb1\u0bcd\u0b9a\u0bbf\u0b95\u0bcd\u0b95\u0bb5\u0bc1\u0bae\u0bcd.' : err}
          </div>
        )}

        <button onClick={login} disabled={busy} style={{ ...btn, opacity: busy ? 0.7 : 1, marginBottom: 12 }}>
          {busy ? t('wait') : t('login')}
        </button>

        <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
          {t('trouble')} <b>77085 51139</b>
        </div>
      </div>
    </div>
  );
}
