import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tv, ArrowRight, Loader2 } from 'lucide-react';
import portalApi, { setPortalSession, getPortalToken, isValidToken } from './portalApi';
import { PortalStyle } from './PortalLayout';

// Customer login — the only thing to remember is the STB number (printed on the
// set-top box) and the registered mobile number. No password, no OTP.
// Customer ID also works as fallback.

export default function PortalLogin() {
  const navigate = useNavigate();
  const [stbNo, setStbNo] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<{business_name?: string; phone?: string; care_phone?: string}>({});

  useEffect(() => {
    fetch('/api/portal/settings')
      .then(r => r.json())
      .then(d => setSettings(d))
      .catch(() => {});
  }, []);

  // Redirect if already logged in
  const existing = getPortalToken();
  if (existing && isValidToken(existing)) {
    navigate('/portal/home', { replace: true });
    return null;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const stb = stbNo.trim();
    const ph = phone.replace(/\D/g, '');
    if (!stb) { setError('STB எண்ணை உள்ளிடவும் · Enter your STB number'); return; }
    if (ph.length < 10) { setError('சரியான 10 இலக்க மொபைல் எண் · Enter a valid 10-digit mobile number'); return; }
    setBusy(true);
    try {
      const res = await portalApi.post('/customer/quick-login', { stb_no: stb, phone: ph });
      const token = res.data?.access_token || res.data?.token;
      if (!isValidToken(token)) {
        setError('சேவை தற்காலிகமாக கிடைக்கவில்லை. பின்னர் முயற்சிக்கவும் · Login service unavailable. Please try again later or call us.');
        return;
      }
      setPortalSession(token, res.data.customer);
      navigate('/portal/home', { replace: true });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'பொருந்தவில்லை. எண்களை சரிபார்க்கவும் · Not matching. Please check your details.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '15px 14px', fontSize: '1.05rem', borderRadius: 12,
    border: '1.5px solid var(--wp-line)', outline: 'none', background: '#fff', color: 'var(--wp-ink)',
  };
  const labelStyle: React.CSSProperties = { fontWeight: 700, fontSize: '.95rem', display: 'block', marginBottom: 6 };

  return (
    <div className="wp" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <PortalStyle />
      <div className="wp-card" style={{ width: '100%', maxWidth: 420, padding: '28px 22px' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: '#e8eefc',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--wp-accent)', marginBottom: 10,
          }}><Tv size={28} /></div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{settings.business_name?.split(' ').slice(0, 2).join(' ') || 'Sree Selvanaayakki Amman'}</div>
          <div style={{ color: 'var(--wp-muted)', fontSize: '.85rem' }}>Cable TV · Internet</div>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>STB எண் <span className="wp-en">STB number</span></label>
            <input
              value={stbNo}
              onChange={(e) => setStbNo(e.target.value)}
              placeholder="0293 8471 5566"
              inputMode="numeric"
              style={inputStyle}
            />
            <div style={{ fontSize: '.75rem', color: 'var(--wp-muted)', marginTop: 5 }}>
              செட்-டாப் பாக்ஸ் / ரசீதில் உள்ளது · on your set-top box or bill
            </div>
          </div>

          <div style={{ marginBottom: 22 }}>
            <label style={labelStyle}>மொபைல் எண் <span className="wp-en">Mobile number</span></label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
              inputMode="numeric"
              type="tel"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{
              background: '#fef2f2', color: 'var(--wp-red)', border: '1px solid #fecaca',
              borderRadius: 12, padding: '12px 14px', fontSize: '.85rem', marginBottom: 16, lineHeight: 1.5,
            }}>{error}</div>
          )}

          <button type="submit" disabled={busy} className="wp-btn"
            style={{ background: 'var(--wp-accent)', color: '#fff', opacity: busy ? 0.7 : 1 }}>
            {busy ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={20} />}
            {busy ? 'சரிபார்க்கிறது…' : 'என் கணக்கைப் பார்க்க'}
            {!busy && <span className="wp-en" style={{ color: '#fff' }}>View my account</span>}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: '.78rem', color: 'var(--wp-muted)', lineHeight: 1.6 }}>
          உதவி தேவையா? <a href={`tel:+91${settings.care_phone || '7708551139'}`} style={{ color: 'var(--wp-accent)', fontWeight: 700 }}>{settings.phone || '77085 51139'}</a>
          <br /><span className="wp-en">Need help? Call us</span>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
