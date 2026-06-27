import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi } from '../api';
import {
  UserCog, Plus, Phone, X, KeyRound, Ban, Search,
  CheckCircle2, Shield, Eye, EyeOff,
} from 'lucide-react';

interface Employee {
  id: number;
  username: string;
  name: string;
  role: string;
  role_label: string;
  phone?: string;
  status: string;
  created_at?: string;
  payment_count?: number;
  password_hint?: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin: '#0071e3',
  support: '#34c759',
  collection_agent: '#ff9f0a',
  service_agent: '#bf5af2',
  collection_point: '#5856d6',
};

export default function Employees() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [resetTarget, setResetTarget] = useState<Employee | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => (await employeesApi.list()).data as { employees: Employee[]; total: number },
  });

  const deactivateMut = useMutation({
    mutationFn: async (id: number) => (await employeesApi.deactivate(id)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  const toggleStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      (await employeesApi.update(id, { status })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  const employees = data?.employees ?? [];
  const filtered = employees.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.name?.toLowerCase().includes(q) ||
      e.username?.toLowerCase().includes(q) ||
      e.role_label?.toLowerCase().includes(q);
  });

  const activeCount = employees.filter(e => e.status === 'Active').length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserCog style={{ width: 28, height: 28 }} />
            Employees
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            {activeCount} active of {employees.length} total
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
          <Plus style={{ width: 18, height: 18 }} /> Add Employee
        </button>
      </div>

      {/* Search */}
      {employees.length > 0 && (
        <div style={{ position: 'relative', maxWidth: 300 }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--text-light)' }} />
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px 8px 34px', borderRadius: 10,
              border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
              color: 'var(--text)', fontSize: '0.82rem',
            }}
          />
        </div>
      )}

      {/* List */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ width: 32, height: 32, border: '3px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          </div>
        ) : !filtered.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
            <UserCog style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.3 }} />
            {search ? 'No matching employees' : 'No employees found'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Phone</th>
                  <th>Payments</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => {
                  const roleColor = ROLE_COLORS[emp.role] || '#8e8e93';
                  const isActive = emp.status === 'Active';
                  return (
                    <tr key={emp.id}>
                      <td style={{ fontWeight: 500, color: 'var(--text)' }}>{emp.name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-light)' }}>{emp.username}</td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
                          background: `${roleColor}1a`, color: roleColor,
                        }}>{emp.role_label}</span>
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                        {emp.phone ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Phone style={{ width: 12, height: 12 }} />{emp.phone}
                          </span>
                        ) : '--'}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                        {emp.payment_count ? emp.payment_count : '--'}
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
                          background: isActive ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
                          color: isActive ? '#34c759' : '#ff3b30',
                        }}>{emp.status}</span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => setEditTarget(emp)}
                          style={{
                            padding: '5px 10px', borderRadius: 8, border: '0.5px solid var(--border)',
                            background: 'transparent', color: 'var(--text)', fontSize: '0.75rem',
                            fontWeight: 500, cursor: 'pointer', marginRight: 4,
                          }}
                        >Edit</button>
                        <button
                          onClick={() => setResetTarget(emp)}
                          style={{
                            padding: '5px 10px', borderRadius: 8, border: '0.5px solid var(--border)',
                            background: 'transparent', color: 'var(--text)', fontSize: '0.75rem',
                            fontWeight: 500, cursor: 'pointer', marginRight: 4,
                          }}
                        ><KeyRound style={{ width: 12, height: 12, display: 'inline', marginRight: 2 }} />Password</button>
                        {isActive ? (
                          <button
                            onClick={() => {
                              if (emp.role === 'admin') {
                                alert('Cannot deactivate admin. Change role first.');
                                return;
                              }
                              if (confirm(`Deactivate ${emp.name}?`)) deactivateMut.mutate(emp.id);
                            }}
                            style={{
                              padding: '5px 10px', borderRadius: 8,
                              border: '0.5px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.05)',
                              color: '#ff3b30', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer',
                            }}
                          ><Ban style={{ width: 12, height: 12, display: 'inline', marginRight: 2 }} />Deactivate</button>
                        ) : (
                          <button
                            onClick={() => toggleStatusMut.mutate({ id: emp.id, status: 'Active' })}
                            style={{
                              padding: '5px 10px', borderRadius: 8,
                              border: '0.5px solid rgba(52,199,89,0.3)', background: 'rgba(52,199,89,0.05)',
                              color: '#34c759', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer',
                            }}
                          ><CheckCircle2 style={{ width: 12, height: 12, display: 'inline', marginRight: 2 }} />Activate</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewEmployeeModal onClose={() => setShowNew(false)} />}
      {editTarget && <EditEmployeeModal employee={editTarget} onClose={() => setEditTarget(null)} />}
      {resetTarget && <ResetPasswordModal employee={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  );
}

function NewEmployeeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '', role: 'collection_agent' });
  const [error, setError] = useState('');

  const createMut = useMutation({
    mutationFn: async () => (await employeesApi.create(form)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => setError(err?.response?.data?.detail || 'Failed to create employee'),
  });

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
    color: 'var(--text)', fontSize: '0.85rem',
  } as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 440, width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus style={{ width: 20, height: 20, color: '#0071e3' }} /> New Employee
          </h3>
          <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Full Name *</label>
            <input style={inputStyle} value={form.name} onChange={e => update('name', e.target.value)} placeholder="Ravi Kumar" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Username *</label>
              <input style={{ ...inputStyle, fontFamily: 'monospace' }} value={form.username} onChange={e => update('username', e.target.value.toLowerCase())} placeholder="ravi" />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Password *</label>
              <input type="text" style={inputStyle} value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min 4 chars" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Phone</label>
              <input style={inputStyle} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="9876543210" />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Role</label>
              <select style={inputStyle} value={form.role} onChange={e => update('role', e.target.value)}>
                <option value="admin">Admin</option>
                <option value="support">Support</option>
                <option value="collection_agent">Collection Agent</option>
                <option value="service_agent">Service Agent</option>
                <option value="collection_point">Collection Point</option>
              </select>
            </div>
          </div>
          {error && <p style={{ fontSize: '0.78rem', color: '#ff3b30' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.name || !form.username || !form.password || createMut.isPending}
              style={{
                padding: '10px 20px', borderRadius: 12, border: 'none', background: '#0071e3',
                color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
                opacity: (!form.name || !form.username || !form.password || createMut.isPending) ? 0.5 : 1,
              }}
            >
              {createMut.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditEmployeeModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(employee.name);
  const [phone, setPhone] = useState(employee.phone || '');
  const [role, setRole] = useState(employee.role);
  const [error, setError] = useState('');

  const updateMut = useMutation({
    mutationFn: async () => (await employeesApi.update(employee.id, { name, phone, role })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => setError(err?.response?.data?.detail || 'Update failed'),
  });

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
    color: 'var(--text)', fontSize: '0.85rem',
  } as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 400, width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserCog style={{ width: 20, height: 20, color: '#0071e3' }} /> Edit Employee
          </h3>
          <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Name</label>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Phone</label>
            <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Role</label>
            <select style={inputStyle} value={role} onChange={e => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="support">Support</option>
              <option value="collection_agent">Collection Agent</option>
              <option value="service_agent">Service Agent</option>
              <option value="collection_point">Collection Point</option>
            </select>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Shield style={{ width: 12, height: 12 }} /> Username: <strong style={{ fontFamily: 'monospace' }}>{employee.username}</strong> (cannot change)
          </p>
          {error && <p style={{ fontSize: '0.78rem', color: '#ff3b30' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={() => updateMut.mutate()}
              disabled={updateMut.isPending}
              style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: '#0071e3', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', opacity: updateMut.isPending ? 0.5 : 1 }}
            >
              {updateMut.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);

  const resetMut = useMutation({
    mutationFn: async () => (await employeesApi.resetPassword(employee.id, password)).data,
    onSuccess: () => onClose(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => setError(err?.response?.data?.detail || 'Reset failed'),
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 380, width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound style={{ width: 18, height: 18, color: '#ff9f0a' }} /> Password
          </h3>
          <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
          </button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>{employee.name}</strong> ({employee.username})
        </p>

        {/* Current Password */}
        {employee.password_hint && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 14,
            background: 'rgba(0,113,227,0.06)', border: '0.5px solid rgba(0,113,227,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Current Password
              </span>
              <button
                onClick={() => setShowCurrent(!showCurrent)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#0071e3' }}
              >
                {showCurrent ? <><EyeOff style={{ width: 13, height: 13 }} />Hide</> : <><Eye style={{ width: 13, height: 13 }} />Show</>}
              </button>
            </div>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, fontFamily: 'monospace', color: 'var(--text)', marginTop: 4, letterSpacing: '0.5px' }}>
              {showCurrent ? employee.password_hint : '••••••••'}
            </p>
          </div>
        )}

        {/* New Password Input */}
        <label style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>
          Set New Password
        </label>
        <input
          type="text"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="New password (min 4 chars)"
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
            color: 'var(--text)', fontSize: '0.88rem',
          }}
        />
        {error && <p style={{ fontSize: '0.78rem', color: '#ff3b30', marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={() => resetMut.mutate()}
            disabled={password.length < 4 || resetMut.isPending}
            style={{
              padding: '10px 20px', borderRadius: 12, border: 'none', background: '#ff9f0a',
              color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
              opacity: (password.length < 4 || resetMut.isPending) ? 0.5 : 1,
            }}
          >
            {resetMut.isPending ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
