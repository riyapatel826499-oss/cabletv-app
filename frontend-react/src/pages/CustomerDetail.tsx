import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi, paymentsApi } from '../api';
import { fmtRs, fmtDate } from '../lib/format';
import {
  ArrowLeft,
  Phone,
  MapPin,
  Wifi,
  IndianRupee,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';

interface CustomerDetail {
  id: number;
  customer_id: string;
  name: string;
  phone: string;
  phone2?: string;
  address?: string;
  area?: string;
  city: string;
  status: string;
  plan_amount?: number;
  stb_no?: string;
  connections?: Array<{
    id: number;
    stb_no: string;
    type: string;
    status: string;
    package_name?: string;
    amount?: number;
  }>;
  payments?: Array<{
    id: number;
    amount: number;
    payment_mode: string;
    month_year: string;
    collected_at: string;
  }>;
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '0.5px solid var(--border)',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius-xs)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon style={{ width: 18, height: 18, color: 'var(--text-light)' }} />
      </div>
      <div style={{ flex: 1 }}>
        <p
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-light)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontWeight: 500,
          }}
        >
          {label}
        </p>
        <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text)', marginTop: 2 }}>
          {value || '--'}
        </p>
      </div>
    </div>
  );
}

const STATUSES = ['Active', 'Inactive', 'Surrendered'];

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPhone2, setEditPhone2] = useState('');
  const [editArea, setEditArea] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editStatus, setEditStatus] = useState('Active');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePaymentId, setDeletePaymentId] = useState<number | null>(null);
  const [deletePaymentReason, setDeletePaymentReason] = useState('');
  const [paymentDeleteMsg, setPaymentDeleteMsg] = useState('');

  const { data: customer, isLoading, isError } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await customersApi.get(String(id))).data as CustomerDetail,
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await customersApi.update(String(id), data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setEditMode(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => (await customersApi.delete(String(id))).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/customers');
    },
  });

  const deletePaymentMut = useMutation({
    mutationFn: async ({ payId, reason }: { payId: number; reason?: string }) =>
      (await paymentsApi.delete(payId, reason)).data as {
        old_expiry?: string;
        new_expiry?: string;
        message?: string;
      },
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const msg =
        resp.old_expiry && resp.new_expiry
          ? `Expiry updated: ${fmtDate(resp.old_expiry)} → ${fmtDate(resp.new_expiry)}`
          : resp.message || 'Payment deleted';
      setPaymentDeleteMsg(msg);
      setDeletePaymentId(null);
      setDeletePaymentReason('');
    },
  });

  function enterEdit() {
    if (!customer) return;
    setEditName(customer.name || '');
    setEditPhone(customer.phone || '');
    setEditPhone2(customer.phone2 || '');
    setEditArea(customer.area || '');
    setEditAddress(customer.address || '');
    setEditStatus(customer.status || 'Active');
    setEditMode(true);
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    updateMut.mutate({
      name: editName.trim(),
      phone: editPhone.trim(),
      phone2: editPhone2.trim() || undefined,
      area: editArea.trim(),
      address: editAddress.trim() || undefined,
      status: editStatus,
    });
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div
          style={{
            width: 40,
            height: 40,
            border: '4px solid rgba(0,113,227,0.2)',
            borderTopColor: '#0071e3',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (isError || !customer) {
    return (
      <div
        className="glass-card animate-fade-in"
        style={{ padding: 48, textAlign: 'center', color: 'var(--text-light)' }}
      >
        <p>Customer not found</p>
        <Link to="/customers" style={{ color: '#0071e3', marginTop: 8, display: 'inline-block' }}>
          Back to Customers
        </Link>
      </div>
    );
  }

  const active = (customer.status || '').toLowerCase() === 'active';

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 'var(--radius-xs)',
    border: '0.5px solid var(--border)',
    background: 'var(--bg-secondary)',
    color: 'var(--text)',
    fontSize: '0.88rem',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.72rem',
    fontWeight: 500,
    color: 'var(--text-light)',
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Payment delete result banner */}
      {paymentDeleteMsg && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(255,159,10,0.08)',
            border: '0.5px solid rgba(255,159,10,0.2)',
            color: '#ff9f0a',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
          }}
        >
          <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
          {paymentDeleteMsg}
          <button
            onClick={() => setPaymentDeleteMsg('')}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              fontSize: '1rem',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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
            transition: 'var(--transition)',
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            {customer.name}
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 2 }}>
            STB: {customer.stb_no || 'N/A'} &middot; ID: {customer.customer_id}
          </p>
        </div>
        <span
          style={{
            padding: '5px 14px',
            borderRadius: 20,
            fontSize: '0.78rem',
            fontWeight: 600,
            background: active ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
            color: active ? '#34c759' : '#ff3b30',
          }}
        >
          {customer.status || 'Unknown'}
        </span>
        <button
          onClick={enterEdit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '0.5px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text)',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'var(--transition)',
          }}
        >
          <Pencil style={{ width: 14, height: 14 }} /> Edit
        </button>
        <button
          onClick={() => setDeleteOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '0.5px solid rgba(255,59,48,0.3)',
            background: 'transparent',
            color: '#ff3b30',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'var(--transition)',
          }}
        >
          <Trash2 style={{ width: 14, height: 14 }} /> Delete
        </button>
        <Link
          to="/payments/new"
          state={{ customerId: customer.customer_id, customerName: customer.name }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 18px',
            borderRadius: 'var(--radius-sm)',
            background: '#0071e3',
            color: '#fff',
            fontSize: '0.85rem',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
            transition: 'var(--transition)',
          }}
        >
          <Plus style={{ width: 16, height: 16 }} /> Add Payment
        </Link>
      </div>

      {/* Inline Edit Form */}
      {editMode && (
        <form onSubmit={saveEdit} className="glass-card animate-fade-in" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>Edit Customer</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setEditMode(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '7px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: '0.5px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                <X style={{ width: 14, height: 14 }} /> Cancel
              </button>
              <button
                type="submit"
                disabled={updateMut.isPending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '7px 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: '#0071e3',
                  color: '#fff',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: updateMut.isPending ? 0.6 : 1,
                }}
              >
                <Check style={{ width: 14, height: 14 }} /> {updateMut.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Phone 2</label>
              <input value={editPhone2} onChange={(e) => setEditPhone2(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Area</label>
              <input value={editArea} onChange={(e) => setEditArea(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Address</label>
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        {/* Left: Info */}
        <div className="glass-card" style={{ padding: '20px 24px' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
            Customer Info
          </h2>
          <InfoRow icon={Phone} label="Phone" value={customer.phone} />
          {customer.phone2 && <InfoRow icon={Phone} label="Phone 2" value={customer.phone2} />}
          <InfoRow icon={MapPin} label="Area" value={customer.area} />
          <InfoRow icon={MapPin} label="Address" value={customer.address} />
          <InfoRow
            icon={IndianRupee}
            label="Plan Amount"
            value={customer.plan_amount ? `\u20B9${customer.plan_amount}/mo` : null}
          />
        </div>

        {/* Right: Connections + Payments */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Connections */}
          {customer.connections && customer.connections.length > 0 && (
            <div className="glass-card" style={{ padding: '20px 24px' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                Connections ({customer.connections.length})
              </h2>
              {customer.connections.map((conn, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom:
                      i < customer.connections!.length - 1 ? '0.5px solid var(--border)' : 'none',
                  }}
                >
                  <Wifi style={{ width: 16, height: 16, color: '#0071e3' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>
                      {conn.type || conn.package_name || 'Connection'}
                    </p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
                      {conn.stb_no} &middot; {conn.status}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
                    {conn.amount ? `\u20B9${conn.amount}` : '--'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Payment History */}
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>Payment History</h2>
            </div>
            {customer.payments && customer.payments.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <th>Amount</th>
                      <th>Mode</th>
                      <th>Month</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.payments.slice(0, 25).map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600, color: '#34c759' }}>{fmtRs(p.amount)}</td>
                        <td>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: 20,
                              fontSize: '0.72rem',
                              fontWeight: 500,
                              background: 'rgba(0,113,227,0.08)',
                              color: '#0071e3',
                            }}
                          >
                            {p.payment_mode || '--'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-light)' }}>{p.month_year || '--'}</td>
                        <td style={{ color: 'var(--text-light)', fontSize: '0.82rem' }}>
                          {fmtDate(p.collected_at)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => {
                              setDeletePaymentId(p.id);
                              setDeletePaymentReason('');
                            }}
                            title="Delete payment"
                            style={{
                              padding: 5,
                              borderRadius: 8,
                              border: '0.5px solid rgba(255,59,48,0.3)',
                              background: 'transparent',
                              cursor: 'pointer',
                              display: 'inline-flex',
                            }}
                          >
                            <Trash2 style={{ width: 13, height: 13, color: '#ff3b30' }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-light)' }}>
                <Clock style={{ width: 28, height: 28, margin: '0 auto 8px', opacity: 0.4 }} />
                No payment history
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Customer Modal */}
      {deleteOpen && (
        <div
          onClick={() => setDeleteOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card"
            style={{ padding: 28, borderRadius: 16, maxWidth: 380, width: '90%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ padding: 10, borderRadius: 12, background: 'rgba(255,59,48,0.1)' }}>
                <AlertCircle style={{ width: 24, height: 24, color: '#ff3b30' }} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>Delete Customer?</h3>
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginBottom: 20 }}>
              This will permanently delete <strong style={{ color: 'var(--text)' }}>{customer.name}</strong> and all
              related records. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteOpen(false)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  border: '0.5px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#ff3b30',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: deleteMut.isPending ? 0.6 : 1,
                }}
              >
                {deleteMut.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Payment Modal */}
      {deletePaymentId !== null && (
        <div
          onClick={() => setDeletePaymentId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card"
            style={{ padding: 28, borderRadius: 16, maxWidth: 380, width: '90%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ padding: 10, borderRadius: 12, background: 'rgba(255,59,48,0.1)' }}>
                <Trash2 style={{ width: 24, height: 24, color: '#ff3b30' }} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>Delete Payment?</h3>
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginBottom: 14 }}>
              Deleting this payment will recompute the customer's expiry date. This cannot be undone.
            </p>
            <input
              type="text"
              value={deletePaymentReason}
              onChange={(e) => setDeletePaymentReason(e.target.value)}
              className="glass-input"
              placeholder="Reason (optional)"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.85rem',
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeletePaymentId(null)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  border: '0.5px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deletePaymentMut.mutate({
                    payId: deletePaymentId,
                    reason: deletePaymentReason.trim() || undefined,
                  })
                }
                disabled={deletePaymentMut.isPending}
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#ff3b30',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: deletePaymentMut.isPending ? 0.6 : 1,
                }}
              >
                {deletePaymentMut.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
