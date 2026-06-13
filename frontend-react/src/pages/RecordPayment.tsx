import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi, paymentsApi, settingsApi } from '../api';
import type { CustomerListItem } from '../types';
import { fmtRs } from '../lib/format';
import { Search, Loader2, CheckCircle, AlertCircle, ArrowLeft, IndianRupee } from 'lucide-react';

interface CustomerSearchResult extends CustomerListItem {}

const PAYMENT_MODES = ['Cash', 'GPay', 'PhonePe', 'UPI', 'Bank Transfer', 'Cheque'];

// Compute the payment status badge for a customer
function getPaymentStatus(c: CustomerSearchResult): { label: string; color: string } {
  const isPaid = c.is_paid === true || c.is_paid === 1;
  const connStatus = (c.conn_status || c.status || '').toLowerCase();
  const isDisconnected = connStatus.includes('disconnected') || connStatus === 'inactive';

  if (isPaid) return { label: 'Active | Paid', color: '#34c759' };
  if (isDisconnected) return { label: 'Inactive | Unpaid', color: '#ff3b30' };
  return { label: 'Active | Unpaid', color: '#ffcc00' };
}

export default function RecordPayment() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Pre-fill from navigation state (coming from Customer Detail)
  const prefill = (location.state as { customerId?: number; customerName?: string }) || {};

  const [searchTerm, setSearchTerm] = useState(prefill.customerName || '');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(
    null
  );
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('Cash');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Fetch cutoff date from settings (used to show due date hint for unpaid customers)
  const { data: notifSettings } = useQuery({
    queryKey: ['settings-notifications'],
    queryFn: async () => (await settingsApi.getNotifications()).data,
  });
  const cutoffDate = notifSettings?.cutoff_date ?? '12';

  // Search customers
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ['customer-search', searchTerm],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) return [];
      return (await customersApi.search(searchTerm)).data as CustomerSearchResult[];
    },
    enabled: searchTerm.length >= 2 && !selectedCustomer,
  });

  // Auto-select if prefill
  useEffect(() => {
    if (prefill.customerId && !selectedCustomer) {
      customersApi.get(String(prefill.customerId)).then((res) => {
        setSelectedCustomer(res.data as unknown as CustomerSearchResult);
      });
    }
  }, [prefill.customerId]);

  const handleCustomerSelect = (c: CustomerSearchResult) => {
    setSelectedCustomer(c);
    setSearchTerm(c.name);
    if (c.plan_amount) setAmount(String(c.plan_amount));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      setError('Please select a customer');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await paymentsApi.create({
        customer_id: selectedCustomer.customer_id,
        amount: Number(amount),
        payment_mode: mode,
        month_year: month,
        notes: notes || undefined,
      });
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['customer', String(selectedCustomer.customer_id)] });
      setSuccess(true);
      setTimeout(() => navigate('/payments'), 2000);
    } catch {
      setError('Failed to record payment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div
        className="animate-fade-in"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}
      >
        <div className="glass-card" style={{ padding: 48, textAlign: 'center', maxWidth: 360 }}>
          <CheckCircle style={{ width: 48, height: 48, color: '#34c759', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text)' }}>
            Payment Recorded!
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 8 }}>
            {fmtRs(Number(amount))} from {selectedCustomer?.name} via {mode}
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: 12 }}>
            Redirecting to payments...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
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
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Record Payment
        </h1>
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
        <div className="glass-card" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Customer Search */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
              Customer
            </label>
            <div style={{ position: 'relative' }}>
              <Search
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
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setSelectedCustomer(null);
                }}
                className="glass-input"
                style={{ paddingLeft: 40, width: '100%', padding: '12px 16px 12px 40px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}
                placeholder="Search customer by name or phone..."
                disabled={!!selectedCustomer}
              />
              {selectedCustomer && (
                <button
                  type="button"
                  onClick={() => { setSelectedCustomer(null); setSearchTerm(''); }}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'var(--bg-secondary)',
                    border: 'none',
                    borderRadius: 'var(--radius-xs)',
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    color: 'var(--text-light)',
                  }}
                >
                  Change
                </button>
              )}
            </div>

            {/* Search Results Dropdown */}
            {!selectedCustomer && searchResults && searchResults.length > 0 && (
              <div
                className="glass-card animate-fade-in"
                style={{
                  marginTop: 4,
                  padding: 0,
                  overflow: 'hidden',
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {searchResults.map((c) => (
                  <div
                    key={c.customer_id}
                    onClick={() => handleCustomerSelect(c)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      cursor: 'pointer',
                      borderBottom: '0.5px solid var(--border)',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0,113,227,0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div>
                      <p style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text)' }}>{c.name}</p>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
                        {c.phone || 'No phone'} {c.stb_no ? `| STB: ${c.stb_no}` : ''}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {c.plan_amount && (
                        <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>
                          {fmtRs(c.plan_amount)}
                        </p>
                      )}
                      {(() => {
                        const ps = getPaymentStatus(c);
                        return (
                          <>
                            <p style={{ fontSize: '0.7rem', fontWeight: 600, color: ps.color }}>
                              {ps.label}
                            </p>
                            {ps.label === 'Active | Unpaid' && (
                              <p style={{ fontSize: '0.62rem', color: 'var(--text-light)' }}>
                                Due by {cutoffDate}th
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!selectedCustomer && searchTerm.length >= 2 && !isFetching && searchResults && searchResults.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: 8, padding: '0 4px' }}>
                No customers found matching "{searchTerm}"
              </p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
              Amount
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
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="glass-input"
                style={{ paddingLeft: 40, width: '100%', padding: '12px 16px 12px 40px', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: 600 }}
                placeholder="0"
                required
              />
            </div>
          </div>

          {/* Mode + Month */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                Payment Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="glass-input"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                Billing Month
              </label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="glass-input"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
              Notes <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="glass-input"
              style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', minHeight: 70, resize: 'vertical' }}
              placeholder="Any additional notes..."
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !selectedCustomer}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: 'var(--radius-sm)',
              background: submitting ? '#005bb5' : '#0071e3',
              color: '#fff',
              fontSize: '0.92rem',
              fontWeight: 600,
              border: 'none',
              cursor: submitting || !selectedCustomer ? 'not-allowed' : 'pointer',
              transition: 'var(--transition)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: !selectedCustomer ? 0.5 : 1,
              boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
            }}
          >
            {submitting ? (
              <>
                <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />
                Recording...
              </>
            ) : (
              'Record Payment'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}


