import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { stbApi } from '../api';
import { fmtDate } from '../lib/format';
import { Package, Plus, Trash2, AlertCircle, Edit2 } from 'lucide-react';
import StbCopy from '../components/StbCopy';

interface InventoryItem {
  id: number;
  stb_no: string;
  status: string;
  notes: string | null;
  added_at: string;
  added_by: string;
}

export default function Inventory() {
  const [statusFilter, setStatusFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStb, setNewStb] = useState({ stb_no: '', status: 'spare', notes: '' });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role || "agent";
  const isLcoAdmin = ["master", "admin"].includes(role);
  const canAdd = ["master", "admin", "support"].includes(role);
  const canDelete = isLcoAdmin;
  const canUpdate = isLcoAdmin;

  const updateMut = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => (await stbApi.update(id, status)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stb-inventory'] });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['stb-inventory', statusFilter],
    queryFn: async () => {
      const params = statusFilter ? { status: statusFilter } : undefined;
      const res = await stbApi.listInventory(params);
      return res.data as { inventory: InventoryItem[]; total: number };
    },
  });

  const inventory = data?.inventory ?? [];

  const addMut = useMutation({
    mutationFn: async (data: { stb_no: string; status: string; notes?: string }) => (await stbApi.add(data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stb-inventory'] });
      setShowAddModal(false);
      setNewStb({ stb_no: '', status: 'spare', notes: '' });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await stbApi.remove(id)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stb-inventory'] });
      setDeleteId(null);
    },
  });

  const handleAdd = () => {
    if (!newStb.stb_no.trim()) return;
    addMut.mutate({
      stb_no: newStb.stb_no.trim(),
      status: newStb.status,
      notes: newStb.notes.trim() || undefined,
    });
  };

  const statusOptions = ['spare', 'faulty', 'with_mso'];

  // ── Status colour mapping ──────────────────────────────────────────────────
  const statusStyle = (status: string): { bg: string; color: string; label: string } => {
    switch (status) {
      case 'spare':
      case 'available':
        return { bg: '#34c75920', color: '#34c759', label: status === 'spare' ? 'Spare' : 'Available' };
      case 'faulty':
        return { bg: '#ff3b3020', color: '#ff3b30', label: 'Faulty' };
      case 'with_mso':
        return { bg: '#ff9f0a20', color: '#ff9f0a', label: 'With MSO' };
      case 'assigned':
        return { bg: '#8e8e9320', color: '#8e8e93', label: 'Assigned' };
      default:
        return { bg: '#8e8e9320', color: '#8e8e93', label: status };
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package style={{ width: 28, height: 28 }} />
            STB Inventory
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            Manage spare, faulty and returned STBs
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)} disabled={!canAdd}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 12,
            border: 'none', background: '#0071e3', color: '#fff', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus style={{ width: 18, height: 18 }} /> Add STB to Inventory
        </button>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>Status:</span>
        {['', ...statusOptions].map(s => {
          const sc = s ? statusStyle(s) : null;
          const isActive = statusFilter === s;
          return (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '6px 14px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 500,
                border: isActive ? `1px solid ${sc?.color || '#0071e3'}` : '1px solid var(--border)',
                background: isActive ? (sc ? sc.bg : '#0071e320') : 'transparent',
                color: isActive ? (sc?.color || '#0071e3') : 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {s ? sc?.label : 'All'}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Loading inventory...</div>
        ) : inventory.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
            <AlertCircle style={{ width: 32, height: 32, margin: '0 auto 12px' }} />
            No STBs found in inventory
          </div>
        ) : (
          <table className="glass-table">
            <thead>
              <tr>
                <th>STB No</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Added</th>
                <th>Added By</th>
                <th style={{ width: 60 }}>{canDelete ? "" : null}</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map(item => (
                <tr key={item.id}>
                  <td>
                    <StbCopy stb={item.stb_no} prefix="" />
                  </td>
                  <td>
                    {canUpdate ? (
                      <select
                        value={item.status}
                        onChange={e => updateMut.mutate({ id: item.id, status: e.target.value })}
                        disabled={updateMut.isPending}
                        style={{
                          padding: '4px 10px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600,
                          background: statusStyle(item.status).bg,
                          border: `1px solid ${statusStyle(item.status).color}40`,
                          color: statusStyle(item.status).color,
                          cursor: 'pointer', outline: 'none',
                        }}
                      >
                        {['spare', 'faulty', 'available', 'with_mso'].map(s => (
                          <option key={s} value={s}>{statusStyle(s).label}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{
                        padding: '3px 10px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600,
                        background: statusStyle(item.status).bg,
                        color: statusStyle(item.status).color,
                      }}>
                        {statusStyle(item.status).label}
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{item.notes || '—'}</td>
                  <td style={{ fontSize: '0.85rem' }}>{fmtDate(item.added_at)}</td>
                  <td style={{ fontSize: '0.85rem' }}>{item.added_by}</td>
                  <td>
                    {canUpdate && (
                      <span title="Edit status" style={{ cursor: 'pointer', marginRight: 8 }}>
                        <Edit2 size={16} style={{ color: '#0071e3' }} />
                      </span>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setDeleteId(item.id)}
                        style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer' }}
                        title="Remove from inventory"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 420, padding: 24 }}>
            <h3 style={{ marginBottom: 16 }}>Add STB to Inventory</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>STB Number</label>
                <input
                  type="text"
                  value={newStb.stb_no}
                  onChange={e => setNewStb({ ...newStb, stb_no: e.target.value })}
                  placeholder="e.g. GTPL123456"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Status</label>
                <select
                  value={newStb.status}
                  onChange={e => setNewStb({ ...newStb, status: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text)' }}
                >
                  {statusOptions.map(s => <option key={s} value={s}>{statusStyle(s).label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Notes (optional)</label>
                <input
                  type="text"
                  value={newStb.notes}
                  onChange={e => setNewStb({ ...newStb, notes: e.target.value })}
                  placeholder="Reason or remarks"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text)' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAddModal(false)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }}>Cancel</button>
              <button onClick={handleAdd} disabled={addMut.isPending || !newStb.stb_no.trim()} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#0071e3', color: '#fff', fontWeight: 600 }}>
                {addMut.isPending ? 'Adding...' : 'Add to Inventory'}
              </button>
            </div>
            {addMut.isError && <p style={{ color: '#ff3b30', fontSize: '0.8rem', marginTop: 8 }}>Failed to add STB</p>}
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-card" style={{ padding: 24, maxWidth: 380 }}>
            <p style={{ marginBottom: 16 }}>Remove this STB from inventory?</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteId(null)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent' }}>Cancel</button>
              <button onClick={() => deleteMut.mutate(deleteId)} disabled={deleteMut.isPending} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#ff3b30', color: '#fff', fontWeight: 600 }}>
                {deleteMut.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
