import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { setToken } from './portalApi';

const BUSINESS = 'Sree Selvanaayakki Amman Cables & Internet Services';

const btn: React.CSSProperties = {
  width: '100%', padding: '14px', borderRadius: 12, fontSize: '1rem',
  fontWeight: 600, border: 'none', cursor: 'pointer', color: '#fff',
  background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)',
};

export default function PortalLogin() {
  const [cid, setCid] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function login() {
    const c = cid.trim().toUpperCase();
    const p = phone.trim().replace(/\D/g, '');
    if (!c || !p) { setErr('Enter your Customer ID and registered mobile number.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/customer/quick-login', { customer_id: c, phone: p });
      setToken(res.data.token);
      navigate('/app/portal/home');
    } catch {
      setErr('Customer ID and phone do not match. Try again.');
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
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0b1020', marginBottom: 4 }}>{BUSINESS}</div>
        <div style={{ fontSize: '0.85rem', color: '#86868b', marginBottom: 20 }}>Customer Portal</div>

        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 16 }}>
          Enter your Customer ID and registered mobile number to log in.
          <div style={{ fontSize: '0.72rem', marginTop: 4, color: '#9ca3af' }}>No password or OTP needed.</div>
        </div>

        <input
          placeholder="Customer ID (e.g. SSA-000176)"
          value={cid}
          onChange={(e) => setCid(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12, fontSize: '0.9rem',
            border: '1px solid #e2e6ef', outline: 'none', marginBottom: 12, boxSizing: 'border-box',
          }}
        />
        <input
          type="tel"
          placeholder="Registered mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12, fontSize: '0.9rem',
            border: '1px solid #e2e6ef', outline: 'none', marginBottom: 16, boxSizing: 'border-box',
          }}
        />

        {err && (
          <div style={{ background: '#fdeaea', color: '#b91c1c', borderRadius: 12, padding: '10px 12px', fontSize: '0.85rem', marginBottom: 12 }}>
            {err}
          </div>
        )}

        <button onClick={login} disabled={busy} style={{ ...btn, opacity: busy ? 0.7 : 1, marginBottom: 12 }}>
          {busy ? 'Please wait\u2026' : 'Log in'}
        </button>

        <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
          Having trouble? Call {BUSINESS} at <b>77085 51139</b>
        </div>
      </div>
    </div>
  );
}
