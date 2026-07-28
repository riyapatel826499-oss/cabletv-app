import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader2, Tv, AlertCircle } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch {
      setError('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = (name: string): React.CSSProperties => ({
    width: '100%',
    padding: '13px 16px',
    borderRadius: 12,
    fontSize: '0.92rem',
    background: 'rgba(255,255,255,0.06)',
    color: '#f5f6fa',
    border: `1px solid ${focus === name ? '#5aa2ff' : 'rgba(255,255,255,0.14)'}`,
    boxShadow: focus === name ? '0 0 0 3px rgba(90,162,255,0.28)' : 'none',
    outline: 'none',
    transition: 'all 0.2s ease',
  });

  const label: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#aab0c2',
    marginBottom: 8,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 16px',
        background:
          'radial-gradient(1100px 700px at 10% -10%, rgba(79,140,255,0.25), transparent 58%),' +
          'radial-gradient(1000px 700px at 105% 0%, rgba(139,92,255,0.22), transparent 55%),' +
          'radial-gradient(900px 900px at 50% 120%, rgba(45,212,160,0.10), transparent 60%),' +
          '#090b14',
      }}
    >
      <div style={{ width: '100%', maxWidth: 390 }}>
        {/* Brand */}
        <div className="text-center animate-fade-in" style={{ marginBottom: 30 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 74,
              height: 74,
              borderRadius: 22,
              background: 'linear-gradient(135deg, #5aa2ff 0%, #8b5cff 100%)',
              boxShadow: '0 12px 40px rgba(90,162,255,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
              marginBottom: 18,
            }}
          >
            <Tv style={{ width: 36, height: 36, color: '#fff' }} />
          </div>
          <h1 style={{ fontSize: '1.9rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#f5f6fa' }}>
            Wasool
          </h1>
          <p style={{ color: '#aab0c2', marginTop: 4, fontSize: '0.9rem' }}>
            Cable TV Management System
          </p>
        </div>

        {/* Glass card */}
        <div
          className="animate-fade-in"
          style={{
            padding: 30,
            borderRadius: 22,
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 45%), rgba(34,38,54,0.66)',
            backdropFilter: 'saturate(160%) blur(18px)',
            WebkitBackdropFilter: 'saturate(160%) blur(18px)',
            border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10)',
          }}
        >
          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255,59,48,0.12)',
                border: '1px solid rgba(255,59,48,0.3)',
                color: '#ff6b63',
                padding: '12px 16px',
                borderRadius: 12,
                fontSize: '0.85rem',
                marginBottom: 18,
              }}
            >
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 18 }}>
              <label style={label}>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocus('username')}
                onBlur={() => setFocus(null)}
                style={inputStyle('username')}
                placeholder="Enter your username"
                required
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocus('password')}
                onBlur={() => setFocus(null)}
                style={inputStyle('password')}
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #5aa2ff 0%, #8b5cff 100%)',
                color: '#fff',
                fontSize: '0.95rem',
                fontWeight: 600,
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 10px 30px rgba(90,162,255,0.4)',
              }}
            >
              {loading ? (
                <>
                  <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 22, fontSize: '0.78rem', color: '#7e839a' }}>
          New? <a href="/app/register" style={{ color: '#5aa2ff', fontWeight: 700, textDecoration: 'none' }}>Create account</a>
        </p>
        <p style={{ textAlign: 'center', marginTop: 6, fontSize: '0.78rem', color: '#7e839a' }}>
          © {new Date().getFullYear()} Wasool. All rights reserved.
        </p>
      </div>
    </div>
  );
}
