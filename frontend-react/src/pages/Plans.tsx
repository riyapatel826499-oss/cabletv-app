import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { plansApi } from '../api';
import { Tv, Plus, Pencil, Trash2, X, AlertCircle } from 'lucide-react';
import Rs from '../components/Rs';

interface Plan {
  id: number;
  name: string;
  amount: number;
  validity_days: number;
  description?: string;
  status: 'Active' | 'Inactive';
  network: string;
  mso_cost?: number;
  mso_cost_late?: number;
  active_customers?: number;
}

const MSOS = ['GTPL', 'TACTV', 'SCV'];

export default function Plans() {
  const [msoFilter, setMsoFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['plans', msoFilter],
    queryFn: async () => (await plansApi.list(msoFilter ? { status: 'Active', network: msoFilter } : { status: 'Active' })).data as { plans: Plan[] },
  });

  const plans = data?.plans ?? [];

  const createMut = useMutation({
    mutationFn: async (p: Partial<Plan>) => (await plansApi.create(p)).data,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['plans'] }); setShowModal(false); setEditPlan(null); },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Plan> }) => (await plansApi.update(id, data)).data,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['plans'] }); setShowModal(false); setEditPlan(null); },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await plansApi.delete(id)).data,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['plans'] }); setDeleteId(null); },
  });

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tv style={{ width: 28, height: 28 }} />
            Plans
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            Manage pricing plans per MSO
          </p>
        </div>
        <button
          onClick={() => { setEditPlan(null); setShowModal(true); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 12,
            border: 'none', background: '#0071e3', color: '#fff', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
          }}
        >
          <Plus style={{ width: 18, height: 18 }} /> Add Plan
        </button>
      </div>

      {/* MSO Filter */}
      <div style={{ display: 'flex', gap: 8 }}>
        {['', ...MSOS].map(m => {
          const active = msoFilter === m;
          const label = m || 'All MSOs';
          return (
            <button
              key={label}
              onClick={() => setMsoFilter(m)}
              style={{
                padding: '6px 16px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 500,
                border: active ? 'none' : '0.5px solid var(--border)',
                background: active ? '#0071e3' : 'transparent',
                color: active ? '#fff' : 'var(--text-light)',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="glass-card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ width: 32, height: 32, border: '3px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          </div>
        ) : !plans.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>No plans found</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Plan Name</th>
                  <th>MSO</th>
                  <th>Price</th>
                  <th>MSO Cost</th>
                  <th>Validity</th>
                  <th>Customers</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 500,
                        background: p.network === 'GTPL' ? 'rgba(0,113,227,0.08)' : p.network === 'TACTV' ? 'rgba(255,159,10,0.08)' : 'rgba(52,199,89,0.08)',
                        color: p.network === 'GTPL' ? '#0071e3' : p.network === 'TACTV' ? '#ff9f0a' : '#34c759',
                      }}>
                        {p.network}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: '#34c759' }}><Rs amount={p.amount} /></td>
                    <td style={{ color: 'var(--text-light)' }}>{p.mso_cost ? <Rs amount={p.mso_cost} /> : '--'}</td>
                    <td style={{ color: 'var(--text-light)' }}>{p.validity_days || 30} days</td>
                    <td>{p.active_customers ?? 0}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => { setEditPlan(p); setShowModal(true); }}
                        style={{ padding: 6, borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', cursor: 'pointer', marginRight: 4, display: 'inline-flex' }}
                      >
                        <Pencil style={{ width: 14, height: 14, color: 'var(--text-light)' }} />
                      </button>
                      <button
                        onClick={() => setDeleteId(p.id)}
                        style={{ padding: 6, borderRadius: 8, border: '0.5px solid rgba(255,59,48,0.3)', background: 'transparent', cursor: 'pointer', display: 'inline-flex' }}
                      >
                        <Trash2 style={{ width: 14, height: 14, color: '#ff3b30' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <PlanModal
          plan={editPlan}
          onClose={() => { setShowModal(false); setEditPlan(null); }}
          onSave={(formData) => {
            if (editPlan) {
              updateMut.mutate({ id: editPlan.id, data: formData });
            } else {
              createMut.mutate(formData);
            }
          }}
          saving={createMut.isPending || updateMut.isPending}
        />
      )}

      {/* Delete confirmation */}
      {deleteId !== null && (
        <div onClick={() => setDeleteId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div onClick={e => e.stopPropagation()} className="glass-card" style={{ padding: 28, borderRadius: 16, maxWidth: 360, width: '90%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ padding: 10, borderRadius: 12, background: 'rgba(255,59,48,0.1)' }}>
                <AlertCircle style={{ width: 24, height: 24, color: '#ff3b30' }} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>Delete Plan?</h3>
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginBottom: 20 }}>This will deactivate the plan. Existing customers will not be affected immediately.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteId(null)} style={{ padding: '8px 18px', borderRadius: 10, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.85rem', cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleteId)}
                disabled={deleteMut.isPending}
                style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: '#ff3b30', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', opacity: deleteMut.isPending ? 0.6 : 1 }}
              >
                {deleteMut.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanModal({ plan, onClose, onSave, saving }: {
  plan: Plan | null;
  onClose: () => void;
  onSave: (data: Partial<Plan>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(plan?.name ?? '');
  const [network, setNetwork] = useState(plan?.network ?? 'GTPL');
  const [amount, setAmount] = useState(String(plan?.amount ?? ''));
  const [msoCost, setMsoCost] = useState(String(plan?.mso_cost ?? ''));
  const [validity, setValidity] = useState(String(plan?.validity_days ?? 30));
  const [description, setDescription] = useState(plan?.description ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      name,
      network,
      amount: Number(amount) || 0,
      mso_cost: Number(msoCost) || 0,
      validity_days: Number(validity) || 30,
      description,
      status: 'Active',
    });
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '0.5px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text)',
    fontSize: '0.88rem',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 440, width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>{plan ? 'Edit Plan' : 'Add Plan'}</h3>
          <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Plan Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. TAMIL PRIME" required style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>MSO</label>
              <select value={network} onChange={e => setNetwork(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {MSOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Price (₹)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="250" required style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>MSO Cost (₹)</label>
              <input type="number" value={msoCost} onChange={e => setMsoCost(e.target.value)} placeholder="78" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Validity (days)</label>
              <input type="number" value={validity} onChange={e => setValidity(e.target.value)} placeholder="30" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 4, display: 'block' }}>Description</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes" style={inputStyle} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: '#0071e3', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving...' : plan ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
