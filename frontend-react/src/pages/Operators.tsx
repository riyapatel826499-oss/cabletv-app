import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { operatorsApi } from '../api';
import {
  Building2, Plus, Users, Wifi, Wallet, X,
  KeyRound, Ban, Search,
} from 'lucide-react';
import Rs from '../components/Rs';

interface OperatorData {
  id: number;
  business_name: string;
  owner_name: string;
  phone: string;
  email?: string;
  area?: string;
  mso?: string;
  status: string;
  license_type?: string;
  customer_prefix: string;
  customer_count?: number;
  active_count?: number;
  connection_count?: number;
  staff_count?: number;
  month_collection?: number;
  admin_username?: string;
  admin_name?: string;
  admin_phone?: string;
  notes?: string;
}

export default function Operators() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [resetTarget, setResetTarget] = useState<OperatorData | null>(null);

  const { data: operators = [], isLoading, isError, error } = useQuery({
    queryKey: ['operators'],
    queryFn: async () => (await operatorsApi.list()).data as OperatorData[],
  });

  const suspendMut = useMutation({
    mutationFn: async (id: number) => (await operatorsApi.suspend(id)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operators'] }),
  });

  const filtered = operators.filter(op => {
    if (!search) return true;
    const q = search.toLowerCase();
    return op.business_name?.toLowerCase().includes(q) ||
      op.owner_name?.toLowerCase().includes(q) ||
      op.customer_prefix?.toLowerCase().includes(q);
  });

  if (isError) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail = (error as any)?.response?.data?.detail || '';
    if (detail.includes('Master admin')) {
      return (
        <div className="glass-card animate-fade-in" style={{ padding: 40, textAlign: 'center' }}>
          <Ban style={{ width: 32, height: 32, margin: '0 auto 8px', color: '#8e8e93' }} />
          <p style={{ color: 'var(--text-light)', fontSize: '0.88rem' }}>Operator management is available to master admin only.</p>
        </div>
      );
    }
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 style={{ width: 28, height: 28 }} />
            Operators
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            Multi-operator management ({operators.length} operator{operators.length !== 1 ? 's' : ''})
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
            borderRadius: 12, border: 'none', background: '#0071e3', color: '#fff',
            fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
          }}
        >
          <Plus style={{ width: 18, height: 18 }} /> Add Operator
        </button>
      </div>

      {/* Search */}
      {operators.length > 0 && (
        <div style={{ position: 'relative', maxWidth: 300 }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--text-light)' }} />
          <input
            type="text"
            placeholder="Search operators..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px 8px 34px', borderRadius: 10, border: '0.5px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem',
            }}
          />
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '3px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        </div>
      ) : !filtered.length ? (
        <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
          <Building2 style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.3 }} />
          {search ? 'No matching operators' : 'No operators found'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {filtered.map(op => {
            const suspended = op.status === 'suspended';
            return (
              <div key={op.id} className="glass-card" style={{ padding: 20, opacity: suspended ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>{op.business_name}</h3>
                      <span style={{
                        padding: '2px 8px', borderRadius: 20, fontSize: '0.68rem', fontWeight: 600,
                        background: suspended ? 'rgba(255,59,48,0.1)' : 'rgba(52,199,89,0.1)',
                        color: suspended ? '#ff3b30' : '#34c759',
                      }}>{suspended ? 'Suspended' : 'Active'}</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 2 }}>
                      {op.owner_name} &middot; Prefix: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{op.customer_prefix}</span>
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <Stat icon={Users} label="Customers" value={op.customer_count ?? 0} />
                  <Stat icon={Wifi} label="Connections" value={op.connection_count ?? 0} />
                  <Stat icon={Wallet} label="This Month" value={<Rs amount={op.month_collection ?? 0} />} />
                  <Stat icon={Building2} label="Staff" value={op.staff_count ?? 0} />
                </div>

                {op.admin_username && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', marginBottom: 12, fontSize: '0.78rem' }}>
                    <span style={{ color: 'var(--text-light)' }}>Admin: </span>
                    <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{op.admin_username}</span>
                    {op.admin_phone && <span style={{ color: 'var(--text-light)', marginLeft: 8 }}>{op.admin_phone}</span>}
                  </div>
                )}

                {!suspended && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setResetTarget(op)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
                        borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent',
                        color: 'var(--text)', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      <KeyRound style={{ width: 14, height: 14 }} /> Reset Password
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Suspend ${op.business_name}? All staff will be deactivated.`)) {
                          suspendMut.mutate(op.id);
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
                        borderRadius: 8, border: '0.5px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.05)',
                        color: '#ff3b30', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      <Ban style={{ width: 14, height: 14 }} /> Suspend
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showNew && <NewOperatorModal onClose={() => setShowNew(false)} />}
      {resetTarget && <ResetPasswordModal operator={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon style={{ width: 14, height: 14, color: 'var(--text-light)' }} />
      <div>
        <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>{label}</p>
        <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>{value}</p>
      </div>
    </div>
  );
}

function NewOperatorModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    business_name: '', owner_name: '', phone: '', area: '', mso: 'GTPL',
    customer_prefix: '', admin_username: '', admin_password: '', admin_name: '',
  });
  const [error, setError] = useState('');

  const createMut = useMutation({
    mutationFn: async () => (await operatorsApi.create(form)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      onClose();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => setError(err?.response?.data?.detail || 'Failed to create operator'),
  });

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
    color: 'var(--text)', fontSize: '0.85rem',
  } as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 500, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus style={{ width: 20, height: 20, color: '#0071e3' }} /> New Operator
          </h3>
          <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Business Name *</label>
              <input style={inputStyle} value={form.business_name} onChange={e => update('business_name', e.target.value)} placeholder="SSNA Cables" />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Owner Name *</label>
              <input style={inputStyle} value={form.owner_name} onChange={e => update('owner_name', e.target.value)} placeholder="Prabhu" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Phone *</label>
              <input style={inputStyle} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="9876543210" />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Area</label>
              <input style={inputStyle} value={form.area} onChange={e => update('area', e.target.value)} placeholder="Tirupur" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Customer Prefix *</label>
              <input style={{ ...inputStyle, fontFamily: 'monospace', textTransform: 'uppercase' }} value={form.customer_prefix} onChange={e => update('customer_prefix', e.target.value.toUpperCase())} placeholder="SSA" maxLength={5} />
              <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', marginTop: 2 }}>2-5 uppercase letters</p>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>MSO</label>
              <select style={inputStyle} value={form.mso} onChange={e => update('mso', e.target.value)}>
                <option value="GTPL">GTPL</option>
                <option value="TACTV">TACTV</option>
              </select>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-light)' }}>Admin Login</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Username *</label>
              <input style={{ ...inputStyle, fontFamily: 'monospace' }} value={form.admin_username} onChange={e => update('admin_username', e.target.value)} placeholder="admin" />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Password *</label>
              <input type="password" style={inputStyle} value={form.admin_password} onChange={e => update('admin_password', e.target.value)} placeholder="••••••••" />
            </div>
          </div>

          {error && <p style={{ fontSize: '0.78rem', color: '#ff3b30' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.business_name || !form.owner_name || !form.phone || !form.customer_prefix || !form.admin_username || !form.admin_password || createMut.isPending}
              style={{
                padding: '10px 20px', borderRadius: 12, border: 'none', background: '#0071e3',
                color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
                opacity: createMut.isPending ? 0.5 : 1,
              }}
            >
              {createMut.isPending ? 'Creating...' : 'Create Operator'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ operator, onClose }: { operator: OperatorData; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const resetMut = useMutation({
    mutationFn: async () => (await operatorsApi.resetPassword(operator.id, newPassword)).data,
    onSuccess: () => onClose(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => setError(err?.response?.data?.detail || 'Reset failed'),
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 400, width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound style={{ width: 18, height: 18, color: '#ff9f0a' }} /> Reset Password
          </h3>
          <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
          </button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginBottom: 14 }}>
          Reset admin password for <strong style={{ color: 'var(--text)' }}>{operator.business_name}</strong>
          ({operator.admin_username})
        </p>
        <input
          type="text"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          placeholder="New password"
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
            color: 'var(--text)', fontSize: '0.88rem',
          }}
        />
        {error && <p style={{ fontSize: '0.78rem', color: '#ff3b30', marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => resetMut.mutate()}
            disabled={!newPassword || resetMut.isPending}
            style={{
              padding: '10px 20px', borderRadius: 12, border: 'none', background: '#ff9f0a',
              color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
              opacity: (!newPassword || resetMut.isPending) ? 0.5 : 1,
            }}
          >
            {resetMut.isPending ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
