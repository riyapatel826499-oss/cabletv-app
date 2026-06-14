import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serviceRequestsApi, customersApi } from '../api';
import { fmtDate } from '../lib/format';
import { useNavigate } from 'react-router-dom';
import {
  Ticket, Plus, Search, Phone, X, AlertCircle,
  CheckCircle2, Activity, Inbox,
} from 'lucide-react';

type SRStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'cancelled';
type SRPriority = 'low' | 'medium' | 'high';

interface ServiceRequest {
  id: number;
  ticket_no: string;
  customer_id: string;
  customer_name?: string;
  customer_phone?: string;
  customer_area?: string;
  type: string;
  category: string;
  priority: SRPriority;
  description: string;
  status: SRStatus;
  source: string;
  assigned_to_name?: string;
  created_at: string;
  updated_at?: string;
  acknowledged_at?: string;
  resolved_at?: string;
}

const STATUS_CONFIG: Record<SRStatus, { label: string; color: string; bg: string }> = {
  open:          { label: 'Open',        color: '#ff3b30', bg: 'rgba(255,59,48,0.1)' },
  assigned:      { label: 'Assigned',    color: '#ff9f0a', bg: 'rgba(255,159,10,0.1)' },
  in_progress:   { label: 'In Progress', color: '#0071e3', bg: 'rgba(0,113,227,0.1)' },
  resolved:      { label: 'Resolved',    color: '#34c759', bg: 'rgba(52,199,89,0.1)' },
  closed:        { label: 'Closed',      color: '#8e8e93', bg: 'rgba(142,142,147,0.1)' },
  cancelled:     { label: 'Cancelled',   color: '#8e8e93', bg: 'rgba(142,142,147,0.1)' },
};

const SR_TYPES = ['complaint', 'reconnection', 'new_connection', 'plan_change', 'stb_swap', 'address_shift'];
const SR_CATEGORIES = ['signal', 'internet', 'billing', 'hardware', 'misc'];

export default function ServiceRequests() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SRStatus | ''>('');
  const [showNew, setShowNew] = useState(false);

  const { data: srs = [], isLoading } = useQuery({
    queryKey: ['service-requests', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      return (await serviceRequestsApi.list(params)).data as ServiceRequest[];
    },
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ['sr-stats'],
    queryFn: async () => (await serviceRequestsApi.stats()).data,
  });

  const updateStatusMut = useMutation({
    mutationFn: async ({ ticketNo, status }: { ticketNo: string; status: string }) =>
      (await serviceRequestsApi.updateStatus(ticketNo, status)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      queryClient.invalidateQueries({ queryKey: ['sr-stats'] });
    },
  });

  const filtered = srs.filter(sr => {
    if (!search) return true;
    const q = search.toLowerCase();
    return sr.ticket_no?.toLowerCase().includes(q) ||
      sr.customer_name?.toLowerCase().includes(q) ||
      sr.customer_phone?.includes(q) ||
      sr.description?.toLowerCase().includes(q);
  });

  const openCount = stats?.open_count ?? 0;
  const inProgressCount = (stats?.assigned_count ?? 0) + (stats?.in_progress_count ?? 0);
  const resolvedCount = stats?.resolved_count ?? 0;
  const totalCount = stats?.total ?? 0;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ticket style={{ width: 28, height: 28 }} />
            Service Requests
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
            Track and manage customer complaints and service tickets
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
          <Plus style={{ width: 18, height: 18 }} /> New Ticket
        </button>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
        <StatBox icon={AlertCircle} label="Open" value={openCount} color="#ff3b30" onClick={() => setStatusFilter(statusFilter === 'open' ? '' : 'open')} active={statusFilter === 'open'} />
        <StatBox icon={Activity} label="In Progress" value={inProgressCount} color="#0071e3" onClick={() => setStatusFilter(statusFilter === 'in_progress' ? '' : 'in_progress')} active={statusFilter === 'in_progress'} />
        <StatBox icon={CheckCircle2} label="Resolved" value={resolvedCount} color="#34c759" onClick={() => setStatusFilter(statusFilter === 'resolved' ? '' : 'resolved')} active={statusFilter === 'resolved'} />
        <StatBox icon={Inbox} label="Total" value={totalCount} color="#8e8e93" onClick={() => setStatusFilter('')} active={statusFilter === ''} />
      </div>

      {/* List */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
            Tickets ({filtered.length})
            {statusFilter && (
              <button onClick={() => setStatusFilter('')} style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-light)', fontSize: '0.72rem', cursor: 'pointer' }}>
                Clear filter
              </button>
            )}
          </h2>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--text-light)' }} />
            <input
              type="text"
              placeholder="Search tickets..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '8px 10px 8px 34px', borderRadius: 10, border: '0.5px solid var(--border)',
                background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem', width: 240,
              }}
            />
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ width: 32, height: 32, border: '3px solid rgba(0,113,227,0.2)', borderTopColor: '#0071e3', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          </div>
        ) : !filtered.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
            <Inbox style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.3 }} />
            {search ? 'No matching tickets' : 'No service requests found'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sr => {
                  const cfg = STATUS_CONFIG[sr.status as SRStatus] || STATUS_CONFIG.open;
                  const priorityColor = sr.priority === 'high' ? '#ff3b30' : sr.priority === 'medium' ? '#ff9f0a' : '#8e8e93';
                  return (
                    <tr key={sr.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 600, color: '#0071e3' }}>{sr.ticket_no}</td>
                      <td>
                        <div>
                          <span
                            style={{ fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}
                            onClick={() => navigate(`/customers/${sr.customer_id}`)}
                          >
                            {sr.customer_name || sr.customer_id}
                          </span>
                          {sr.customer_phone && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Phone style={{ width: 10, height: 10 }} />{sr.customer_phone}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.78rem', textTransform: 'capitalize' }}>{sr.type?.replace(/_/g, ' ')}</span>
                        {sr.category && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-light)', display: 'block' }}>{sr.category}</span>
                        )}
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600,
                          background: `${priorityColor}1a`, color: priorityColor, textTransform: 'capitalize',
                        }}>{sr.priority}</span>
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
                          background: cfg.bg, color: cfg.color,
                        }}>{cfg.label}</span>
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{fmtDate(sr.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <select
                          value={sr.status}
                          onChange={e => updateStatusMut.mutate({ ticketNo: sr.ticket_no, status: e.target.value })}
                          disabled={sr.status === 'closed' || sr.status === 'cancelled'}
                          style={{
                            padding: '4px 8px', borderRadius: 8, border: '0.5px solid var(--border)',
                            background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.75rem', cursor: 'pointer',
                          }}
                        >
                          <option value="open">Open</option>
                          <option value="assigned">Assigned</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewTicketModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewTicketModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [type, setType] = useState('complaint');
  const [category, setCategory] = useState('signal');
  const [priority, setPriority] = useState<SRPriority>('medium');
  const [description, setDescription] = useState('');

  const { data: searchResults = [] } = useQuery({
    queryKey: ['customer-search', customerSearch],
    queryFn: async () => {
      if (customerSearch.length < 2) return [];
      return (await customersApi.search(customerSearch)).data?.customers ?? (await customersApi.search(customerSearch)).data ?? [];
    },
    enabled: customerSearch.length >= 2,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const ticketNo = `SR-${new Date().toISOString().slice(8,10)}${new Date().getMonth()+1}-${Date.now().toString().slice(-4)}`;
      return (await serviceRequestsApi.create({
        ticket_no: ticketNo,
        customer_id: customerId,
        type, category, priority, description,
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      queryClient.invalidateQueries({ queryKey: ['sr-stats'] });
      onClose();
    },
  });

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
    color: 'var(--text)', fontSize: '0.88rem',
  } as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 480, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus style={{ width: 20, height: 20, color: '#0071e3' }} /> New Service Ticket
          </h3>
          <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
          </button>
        </div>

        {/* Customer search */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>Customer</label>
          {customerId ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'var(--bg-secondary)', border: '0.5px solid var(--border)' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{customerId}</span>
              <button onClick={() => setCustomerId('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ff3b30' }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search by name or phone..."
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                style={inputStyle}
              />
              {searchResults.length > 0 && (
                <div style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto', borderRadius: 10, border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {searchResults.slice(0, 6).map((c: any) => (
                    <div
                      key={c.customer_id}
                      onClick={() => { setCustomerId(c.customer_id); setCustomerSearch(''); }}
                      style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '0.5px solid var(--border)', fontSize: '0.82rem' }}
                    >
                      <span style={{ fontWeight: 500 }}>{c.name}</span>
                      <span style={{ color: 'var(--text-light)', marginLeft: 8 }}>{c.customer_id}</span>
                      {c.phone && <span style={{ color: 'var(--text-light)', marginLeft: 8 }}>{c.phone}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>Type</label>
            <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
              {SR_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
              {SR_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>Priority</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['low', 'medium', 'high'] as SRPriority[]).map(p => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 10, fontSize: '0.82rem', fontWeight: 600,
                  cursor: 'pointer', textTransform: 'capitalize',
                  border: priority === p ? 'none' : '0.5px solid var(--border)',
                  background: priority === p ? (p === 'high' ? '#ff3b30' : p === 'medium' ? '#ff9f0a' : '#8e8e93') : 'transparent',
                  color: priority === p ? '#fff' : 'var(--text)',
                }}
              >{p}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the issue..."
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!customerId || !description || createMut.isPending}
            style={{
              padding: '10px 20px', borderRadius: 12, border: 'none', background: '#0071e3',
              color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
              opacity: (!customerId || !description || createMut.isPending) ? 0.5 : 1,
            }}
          >
            {createMut.isPending ? 'Creating...' : 'Create Ticket'}
          </button>
        </div>
        {createMut.isError && (
          <p style={{ fontSize: '0.78rem', color: '#ff3b30', marginTop: 10, textAlign: 'center' }}>
            {String(createMut.error?.message || 'Failed to create ticket')}
          </p>
        )}
      </div>
    </div>
  );
}

function StatBox({ icon: Icon, label, value, color, onClick, active }: { icon: React.ElementType; label: string; value: number; color: string; onClick?: () => void; active?: boolean }) {
  return (
    <div
      onClick={onClick}
      className="glass-card"
      style={{
        padding: 16, display: 'flex', alignItems: 'center', gap: 12,
        cursor: onClick ? 'pointer' : 'default',
        border: active ? `2px solid ${color}` : undefined,
        transition: 'var(--transition)',
      }}
    >
      <div style={{ padding: 10, borderRadius: 10, background: `${color}1a` }}>
        <Icon style={{ width: 20, height: 20, color }} />
      </div>
      <div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
        <p style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{value}</p>
      </div>
    </div>
  );
}
