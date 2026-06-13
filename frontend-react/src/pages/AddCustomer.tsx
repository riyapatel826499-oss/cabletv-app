import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { plansApi, customersApi } from '../api';
import { fmtRs } from '../lib/format';
import {
  UserPlus,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  Tv,
  IndianRupee,
} from 'lucide-react';

interface Plan {
  id: number;
  name: string;
  amount: number;
  network: string;
  status: string;
}

const MSOS = ['GTPL', 'TACTV', 'SCV'] as const;
type MSO = (typeof MSOS)[number];

// Detect MSO from STB number prefix.
function detectMso(stb: string): MSO {
  const s = stb.trim();
  if (!s) return 'GTPL';
  if (/^17[23]/.test(s)) return 'TACTV';
  if (/^5000/.test(s)) return 'SCV';
  return 'GTPL';
}

export default function AddCustomer() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [stbNumber, setStbNumber] = useState('');
  const [mso, setMso] = useState<MSO>('GTPL');
  const [planId, setPlanId] = useState('');
  const [activationDate, setActivationDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [connectionFee, setConnectionFee] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ customerId: string; name: string } | null>(null);

  // Auto-detect MSO when STB is typed.
  const detectedMso = useMemo(() => detectMso(stbNumber), [stbNumber]);

  // Plans filtered by selected MSO.
  const { data: plansData } = useQuery({
    queryKey: ['plans', mso],
    queryFn: async () =>
      (await plansApi.list({ status: 'Active', network: mso })).data as { plans: Plan[] },
  });
  const plans = plansData?.plans ?? [];

  const createMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await customersApi.create(payload)).data as { customer_id: string; message?: string },
    onSuccess: (resp) => {
      setSuccess({ customerId: resp.customer_id, name });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to create customer. Please try again.';
      setError(msg);
    },
  });

  function applyDetectedMso() {
    if (stbNumber.trim()) setMso(detectedMso);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) return setError('Name is required');
    if (!phone.trim()) return setError('Phone is required');
    if (!area.trim()) return setError('Area is required');

    const payload: Record<string, unknown> = {
      name: name.trim(),
      phone: phone.trim(),
      area: area.trim(),
      address: address.trim() || undefined,
      stb_number: stbNumber.trim() || undefined,
      activation_date: activationDate,
    };
    if (planId) payload.plan_id = Number(planId);
    if (connectionFee) payload.connection_fee = Number(connectionFee);

    createMut.mutate(payload);
  }

  if (success) {
    return (
      <div
        className="animate-fade-in"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}
      >
        <div className="glass-card" style={{ padding: 48, textAlign: 'center', maxWidth: 380 }}>
          <CheckCircle style={{ width: 48, height: 48, color: '#34c759', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text)' }}>
            Customer Created!
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 8 }}>
            {success.name} has been added successfully.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
            <button
              onClick={() => navigate(`/customers/${success.customerId}`)}
              style={{
                padding: '10px 20px',
                borderRadius: 12,
                border: 'none',
                background: '#0071e3',
                color: '#fff',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              View Customer
            </button>
            <button
              onClick={() => {
                setName('');
                setPhone('');
                setArea('');
                setAddress('');
                setStbNumber('');
                setPlanId('');
                setConnectionFee('');
                setSuccess(null);
              }}
              style={{
                padding: '10px 20px',
                borderRadius: 12,
                border: '0.5px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
                fontSize: '0.88rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Add Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '0.5px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text)',
    fontSize: '0.9rem',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--text)',
    marginBottom: 6,
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 680 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '0.5px solid var(--border)',
            background: 'var(--bg-secondary)',
            cursor: 'pointer',
            color: 'var(--text)',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </button>
        <div>
          <h1
            style={{
              fontSize: '1.4rem',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <UserPlus style={{ width: 26, height: 26 }} />
            Add Customer
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 2 }}>
            Create a new customer record and connection
          </p>
        </div>
      </div>

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
          }}
        >
          <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          className="glass-card"
          style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          {/* Required Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>
                Name <span style={{ color: '#ff3b30' }}>*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
                placeholder="Full name"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>
                Phone <span style={{ color: '#ff3b30' }}>*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={inputStyle}
                placeholder="9876543210"
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>
                Area <span style={{ color: '#ff3b30' }}>*</span>
              </label>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                style={inputStyle}
                placeholder="Area / locality"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>
                Address <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                style={inputStyle}
                placeholder="Door no, street"
              />
            </div>
          </div>

          {/* STB + MSO */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>
                STB Number <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                value={stbNumber}
                onChange={(e) => setStbNumber(e.target.value)}
                onBlur={applyDetectedMso}
                style={inputStyle}
                placeholder="e.g. 5000123456"
              />
              {stbNumber.trim() && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 4 }}>
                  Detected MSO: <strong style={{ color: 'var(--text)' }}>{detectedMso}</strong>
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>MSO</label>
              <select
                value={mso}
                onChange={(e) => {
                  setMso(e.target.value as MSO);
                  setPlanId('');
                }}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {MSOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 4 }}>
                Used to filter plans only
              </p>
            </div>
          </div>

          {/* Plan + Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>
                Plan <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
              </label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">No plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {fmtRs(p.amount)}
                  </option>
                ))}
              </select>
              {plans.length === 0 && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 4 }}>
                  No active plans for {mso}
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>Activation Date</label>
              <input
                type="date"
                value={activationDate}
                onChange={(e) => setActivationDate(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Connection Fee */}
          <div>
            <label style={labelStyle}>
              Connection Fee <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
            </label>
            <div style={{ position: 'relative' }}>
              <IndianRupee
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 18,
                  height: 18,
                  color: 'var(--text-light)',
                }}
              />
              <input
                type="number"
                value={connectionFee}
                onChange={(e) => setConnectionFee(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 40 }}
                placeholder="0 (one-time new connection charge)"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={createMut.isPending}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: 'var(--radius-sm)',
              background: createMut.isPending ? '#005bb5' : '#0071e3',
              color: '#fff',
              fontSize: '0.92rem',
              fontWeight: 600,
              border: 'none',
              cursor: createMut.isPending ? 'not-allowed' : 'pointer',
              transition: 'var(--transition)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
            }}
          >
            {createMut.isPending ? (
              <>
                <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />
                Creating...
              </>
            ) : (
              <>
                <Tv style={{ width: 18, height: 18 }} />
                Create Customer
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
