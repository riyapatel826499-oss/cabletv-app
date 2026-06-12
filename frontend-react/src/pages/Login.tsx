import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader2, Tv, AlertCircle } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'linear-gradient(135deg, #e8f2ff 0%, #f5f5f7 40%, #f0f0f3 100%)',
        padding: '0 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Brand */}
        <div className="text-center animate-fade-in" style={{ marginBottom: 32 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 20,
              background: 'linear-gradient(135deg, #0071e3, #64d2ff)',
              boxShadow: '0 8px 32px rgba(0,113,227,0.25)',
              marginBottom: 16,
            }}
          >
            <Tv style={{ width: 36, height: 36, color: '#fff' }} />
          </div>
          <h1
            style={{
              fontSize: '1.8rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#1d1d1f',
            }}
          >
            Wasool
          </h1>
          <p style={{ color: '#86868b', marginTop: 4, fontSize: '0.9rem' }}>
            Cable TV Management System
          </p>
        </div>

        {/* Glass Card */}
        <div
          className="glass-card animate-fade-in"
          style={{
            padding: 32,
            borderRadius: 'var(--radius)',
          }}
        >
          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255,59,48,0.08)',
                border: '0.5px solid rgba(255,59,48,0.2)',
                color: '#ff3b30',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                marginBottom: 16,
              }}
            >
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: 8,
                }}
              >
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="glass-input"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.9rem',
                }}
                placeholder="Enter your username"
                required
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: 8,
                }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="glass-input"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.9rem',
                }}
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px',
                borderRadius: 'var(--radius-sm)',
                background: loading ? '#005bb5' : '#0071e3',
                color: '#fff',
                fontSize: '0.92rem',
                fontWeight: 600,
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'var(--transition)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
              }}
            >
              {loading ? (
                <>
                  <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p
          style={{
            textAlign: 'center',
            marginTop: 24,
            fontSize: '0.78rem',
            color: '#86868b',
          }}
        >
          © {new Date().getFullYear()} Wasool. All rights reserved.
        </p>
      </div>
    </div>
  );
}
