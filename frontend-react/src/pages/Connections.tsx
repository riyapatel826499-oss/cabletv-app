import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { connectionsApi, customersApi, dashboardApi } from '../api';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, Power, RefreshCw, Search, Phone, Users, X } from 'lucide-react';

interface TempDisconnectedCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  area?: string;
  reclaimed_stb?: string | null;
  connection_id?: number | null;
  mso?: string | null;
  disconnect_date?: string | null;
}

export default function Connections() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [reconnectCustomer, setReconnectCustomer] = useState<TempDisconnectedCustomer | null>(null);
  const [reconnectStb, setReconnectStb] = useState('');

  const { data: stats } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await dashboardApi.stats()).data,
  });

  const { data: tdData, isLoading } = useQuery({
    queryKey: ['temp-disconnected'],
    queryFn: async () => (await customersApi.tempDisconnected()).data as { customers: TempDisconnectedCustomer[] },
    refetchInterval: 30000,
  });

  const reconnectMut = useMutation({
    mutationFn: async (data: { customer_id: string; stb_no: string; connection_id?: number }) =>
      (await connectionsApi.reconnect(data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['temp-disconnected'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setReconnectCustomer(null);
      setReconnectStb('');
    },
  });

  const filtered = (tdData?.customers ?? []).filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.customer_id?.toLowerCase().includes(q) ||
      c.reclaimed_stb?.includes(q);
  });

  const tdCount = tdData?.customers?.length ?? 0;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wifi style={{ width: 28, height: 28 }} />
          Connections
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 2 }}>
          Manage connection statuses, temp disconnects, and reconnections
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
        <StatBox icon={Wifi} label="Active" value={stats?.total_connections ?? '--'} color="#34c759" />
        <StatBox icon={WifiOff} label="Temp Disconnected" value={tdCount} color="#ff9f0a" />
        <StatBox icon={Users} label="Total Customers" value={stats?.total_customers ?? '--'} color="#0071e3" />
      </div>

      {/* Temp Disconnected Table */}
      <div className="glass-card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <WifiOff style={{ width: 18, height: 18, color: '#ff9f0a' }} />
            Temp Disconnected Customers ({tdCount})
          </h2>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--text-light)' }} />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '8px 10px 8px 34px', borderRadius: 10, border: '0.5px solid var(--border)',
                background: 'var(--bg-secondary)', color: 'var(--text)', fontSize: '0.82rem', width: 220,
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
            <Power style={{ width: 32, height: 32, margin: '0 auto 8px', opacity: 0.3 }} />
            {search ? 'No matching customers' : 'No temp disconnected customers'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="glass-table" style={{ boxShadow: 'none', borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Area</th>
                  <th>MSO</th>
                  <th>Reclaimed STB</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.customer_id}>
                    <td>
                      <span
                        style={{ fontWeight: 500, color: '#0071e3', cursor: 'pointer' }}
                        onClick={() => navigate(`/customers/${c.customer_id}`)}
                      >
                        {c.name || '--'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Phone style={{ width: 12, height: 12 }} />{c.phone || '--'}
                      </span>
                    </td>
                    <td>{c.area || '--'}</td>
                    <td>
                      {c.mso ? (
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 500,
                          background: c.mso === 'GTPL' ? 'rgba(0,113,227,0.08)' : c.mso === 'TACTV' ? 'rgba(255,159,10,0.08)' : 'rgba(52,199,89,0.08)',
                          color: c.mso === 'GTPL' ? '#0071e3' : c.mso === 'TACTV' ? '#ff9f0a' : '#34c759',
                        }}>{c.mso}</span>
                      ) : '--'}
                    </td>
                    <td style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>{c.reclaimed_stb || '--'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => {
                          setReconnectCustomer(c);
                          setReconnectStb(c.reclaimed_stb || '');
                        }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 14px',
                          borderRadius: 8, border: 'none', background: '#34c759', color: '#fff',
                          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <RefreshCw style={{ width: 14, height: 14 }} /> Reconnect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reconnect Modal */}
      {reconnectCustomer && (
        <div onClick={() => { setReconnectCustomer(null); setReconnectStb(''); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div onClick={e => e.stopPropagation()} className="glass-card animate-fade-in" style={{ padding: 28, borderRadius: 16, maxWidth: 400, width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <RefreshCw style={{ width: 20, height: 20, color: '#34c759' }} /> Reconnect Customer
              </h3>
              <button onClick={() => { setReconnectCustomer(null); setReconnectStb(''); }} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X style={{ width: 20, height: 20, color: 'var(--text-light)' }} />
              </button>
            </div>
            <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, background: 'var(--bg-secondary)' }}>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{reconnectCustomer.name}</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: 2 }}>{reconnectCustomer.customer_id} &middot; {reconnectCustomer.phone || 'No phone'}</p>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-light)', marginBottom: 6, display: 'block' }}>STB Number</label>
              <input
                type="text"
                value={reconnectStb}
                onChange={e => setReconnectStb(e.target.value)}
                placeholder="Enter STB number"
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: '0.5px solid var(--border)', background: 'var(--bg-secondary)',
                  color: 'var(--text)', fontSize: '0.88rem', fontFamily: 'monospace',
                }}
              />
              {reconnectCustomer.reclaimed_stb && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: 4 }}>
                  Original STB: {reconnectCustomer.reclaimed_stb} (pre-filled)
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setReconnectCustomer(null); setReconnectStb(''); }} style={{ padding: '10px 20px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: '0.88rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => reconnectMut.mutate({
                  customer_id: reconnectCustomer.customer_id,
                  stb_no: reconnectStb,
                  connection_id: reconnectCustomer.connection_id ?? undefined,
                })}
                disabled={!reconnectStb || reconnectMut.isPending}
                style={{
                  padding: '10px 20px', borderRadius: 12, border: 'none', background: '#34c759',
                  color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
                  opacity: (!reconnectStb || reconnectMut.isPending) ? 0.5 : 1,
                }}
              >
                {reconnectMut.isPending ? 'Reconnecting...' : 'Reconnect'}
              </button>
            </div>
            {reconnectMut.isError && (
              <p style={{ fontSize: '0.78rem', color: '#ff3b30', marginTop: 10, textAlign: 'center' }}>
                {String(reconnectMut.error?.message || 'Reconnect failed')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color: string }) {
  return (
    <div className="glass-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ padding: 12, borderRadius: 10, background: `${color}1a` }}>
        <Icon style={{ width: 22, height: 22, color }} />
      </div>
      <div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
        <p style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{value}</p>
      </div>
    </div>
  );
}
