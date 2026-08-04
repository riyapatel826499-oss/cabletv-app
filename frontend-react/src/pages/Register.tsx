import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, User, Phone, MapPin, AtSign, KeyRound, CheckCircle, ArrowRight, Loader2 } from 'lucide-react';
import api from '../api/client';
import { useT } from '../lib/i18n';

type Step = 'form' | 'success' | 'error';

export default function Register() {
  const navigate = useNavigate();
  const { t } = useT();
  const [step, setStep] = useState<Step>('form');
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [result, setResult] = useState<{ message: string; username: string } | null>(null);

  const [form, setForm] = useState({
    business_name: '',
    owner_name: '',
    phone: '',
    email: '',
    area: '',
    mso: 'GTPL',
    admin_username: '',
    admin_password: '',
  });

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg('');
    setBusy(true);
    try {
      const res = await api.post('/register', form);
      setResult({
        message: res.data.message || t('Registration successful!'),
        username: form.admin_username,
      });
      setStep('success');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrMsg(detail || t('Something went wrong. Try again.'));
      setStep('error');
    } finally {
      setBusy(false);
    }
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: '.95rem', borderRadius: 10,
    border: '1.5px solid #d1d5db', outline: 'none', background: '#fff', color: '#111',
    boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { fontWeight: 600, fontSize: '.85rem', display: 'block', marginBottom: 5, color: '#374151' };
  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 20, padding: '28px 24px',
    boxShadow: '0 4px 24px rgba(0,0,0,.06)', maxWidth: 480, width: '100%',
  };

  if (step === 'success' && result) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f5f7fa' }}>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, background: '#e7f8ee', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <CheckCircle size={28} color="#16a34a" />
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 8 }}>{t('Welcome aboard!')}</div>
          <div style={{ color: '#4b5563', fontSize: '.9rem', lineHeight: 1.6, marginBottom: 16 }}>{result.message}</div>
          <div style={{ background: '#f0fdf4', borderRadius: 12, padding: 14, marginBottom: 20, border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: '.8rem', color: '#6b7280', marginBottom: 4 }}>{t('Your login')}</div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{result.username}</div>
            <div style={{ fontSize: '.75rem', color: '#9ca3af', marginTop: 4 }}>{t('(the password you set)')}</div>
          </div>
          <button onClick={() => navigate('/app/login')}
            style={{
              width: '100%', padding: 12, borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)', color: '#fff',
              fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
            }}>
            {t('Go to Login')} <ArrowRight size={18} style={{ verticalAlign: 'middle', marginLeft: 6 }} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f5f7fa' }}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <Building2 size={32} color="#5aa2ff" style={{ marginBottom: 6 }} />
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{t('Start Your Cable TV Billing')}</div>
          <div style={{ color: '#6b7280', fontSize: '.85rem' }}>{t("Create your account — it's free to try")}</div>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}><Building2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t('Business name')}</label>
            <input style={inp} value={form.business_name} onChange={e => update('business_name', e.target.value)}
              placeholder="SSN Cables" required />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}><User size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t('Owner name')}</label>
            <input style={inp} value={form.owner_name} onChange={e => update('owner_name', e.target.value)}
              placeholder={t('Your name')} required />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}><Phone size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t('Mobile number')}</label>
            <input style={inp} value={form.phone} onChange={e => update('phone', e.target.value)}
              placeholder="9876543210" inputMode="numeric" required />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}><AtSign size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t('Email (optional)')}</label>
            <input style={inp} value={form.email} onChange={e => update('email', e.target.value)}
              placeholder="owner@example.com" type="email" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}><MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t('Service area (optional)')}</label>
            <input style={inp} value={form.area} onChange={e => update('area', e.target.value)}
              placeholder="Coimbatore, Tamil Nadu" />
          </div>
          <div style={{ marginBottom: 18, padding: 14, background: '#f0f5ff', borderRadius: 12, border: '1px solid #dbeafe' }}>
            <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: 10, color: '#1e40af' }}>{t('Admin login credentials')}</div>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}><User size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t('Username')}</label>
              <input style={inp} value={form.admin_username} onChange={e => update('admin_username', e.target.value.toLowerCase())}
                placeholder="mycable" required />
            </div>
            <div>
              <label style={lbl}><KeyRound size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t('Password')}</label>
              <input style={inp} value={form.admin_password} onChange={e => update('admin_password', e.target.value)}
                placeholder={t('Min 4 characters')} type="password" required />
            </div>
          </div>

          {errMsg && (
            <div style={{
              background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
              borderRadius: 10, padding: '10px 14px', fontSize: '.85rem', marginBottom: 14,
            }}>{errMsg}</div>
          )}

          <button type="submit" disabled={busy}
            style={{
              width: '100%', padding: 13, borderRadius: 12, border: 'none',
              background: busy ? '#9ca3af' : 'linear-gradient(135deg, #5aa2ff, #8b5cff)',
              color: '#fff', fontWeight: 700, fontSize: '1rem', cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {busy ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {busy ? t('Creating account…') : t('Create account')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: '.8rem', color: '#6b7280' }}>
          {t('Already have an account?')} <Link to="/login" style={{ color: '#5aa2ff', fontWeight: 700, textDecoration: 'none' }}>{t('Log in')}</Link>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
