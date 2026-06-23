import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi, paymentsApi, plansApi, settingsApi } from '../api';
import type { CustomerListItem } from '../types';
import { fmtRs } from '../lib/format';
import { Search, Loader2, CheckCircle, AlertCircle, ArrowLeft, IndianRupee, Info } from 'lucide-react';

type CustomerSearchResult = CustomerListItem;

interface PlanOption {
  id: number;
  name: string;
  amount: number;
  network?: string;
}

interface ConnectionInfo {
  id: number;
  stb_no?: string;
  mso?: string;
  network?: string;
  status?: string;
  expiry_date?: string;
  plan_name?: string;
  plan_amount?: number;
}

const PAYMENT_MODES = ['Cash', 'GPay', 'PhonePe', 'UPI', 'Bank Transfer', 'Cheque'];

// ── Status badge for search results ──────────────────────────────────────
function getPaymentStatus(c: CustomerSearchResult, cutoffDay: number): { label: string; color: string } {
  const isPaid = c.is_paid === true || c.is_paid === 1;
  const connStatus = (c.conn_status || c.status || '').toLowerCase();
  const isDisconnected = connStatus.includes('disconnected') || connStatus === 'inactive';

  if (isPaid) return { label: 'Active | Paid', color: '#34c759' };

  // Not paid — check if past cutoff date
  const today = new Date();
  const todayDate = today.getDate();
  const isOverdue = todayDate > cutoffDay;

  if (isDisconnected) return { label: 'Inactive | Unpaid', color: '#ff3b30' };
  if (isOverdue) return { label: 'Inactive | Unpaid', color: '#ff3b30' };
  return { label: 'Active | Unpaid', color: '#ffcc00' };
}

function detectMSO(stbNo?: string): string {
  if (!stbNo) return 'GTPL';
  const s = stbNo.toString();
  if (s.startsWith('172') || s.startsWith('173')) return 'TACTV';
  if (s.startsWith('5000')) return 'SCV';
  return 'GTPL';
}

// ── Prorata calculation (ported from vanilla) ────────────────────────────
interface PayCalc {
  netAmount: number;
  fullDisplay: number;
  discount: number;
  note: string;
}

function calcPayAmount(
  planAmount: number,
  months: number,
  monthVal: string,       // YYYY-MM
  isDisconnected: boolean,
): PayCalc {
  const fullAmt = planAmount || 0;
  const today = new Date();
  const payDay = today.getDate();
  const payMonth = today.getMonth();   // 0-indexed
  const payYear = today.getFullYear();

  let netAmt = fullAmt * months;
  let discount = 0;
  let fullDisplay = fullAmt * months;
  let note = '';

  if (months === 12) {
    // Yearly: 12 months, pay for 11
    discount = fullAmt;
    netAmt = fullAmt * 11;
    note = `Yearly Pack: 12 months, pay for 11 — 1 month FREE! (${fmtRs(fullAmt)} saved)`;
  } else if (isDisconnected && payDay <= 12) {
    // Reconnecting between 1st-12th: prorata remaining days + 1 full month
    const daysInMonth = new Date(payYear, payMonth + 1, 0).getDate();
    const prorataDays = 13 - payDay;
    const prorataAmt = (prorataDays / daysInMonth) * fullAmt;
    const roundedProrata = Math.round(prorataAmt / 10) * 10;
    netAmt = roundedProrata + fullAmt;
    fullDisplay = netAmt;
    note = `Reconnect: ${prorataDays} days prorata (${fmtRs(roundedProrata)}) + 1 full month (${fmtRs(fullAmt)}) = ${fmtRs(netAmt)}`;
  } else if (payDay > 20 && months >= 1) {
    // After 20th: current month prorata
    const selDate = new Date(monthVal + '-01');
    const selMonth = selDate.getMonth();
    const selYear = selDate.getFullYear();
    const isCurrentMonth = payYear === selYear && payMonth === selMonth;

    if (isCurrentMonth && months === 1) {
      // Single current month after 20th: prorata for remaining days
      const nextMonth = payMonth === 11 ? 0 : payMonth + 1;
      const nextYear = payMonth === 11 ? payYear + 1 : payYear;
      const targetDate = new Date(nextYear, nextMonth, 16);
      const remainingDays = Math.ceil((targetDate.getTime() - today.getTime()) / 86400000);
      const daysInMonth = new Date(payYear, payMonth + 1, 0).getDate();
      const prorataAmt = (remainingDays / daysInMonth) * fullAmt;
      const roundedAmt = Math.round(prorataAmt / 10) * 10;
      discount = fullAmt - roundedAmt;
      netAmt = roundedAmt;
      fullDisplay = fullAmt;
      const targetStr = targetDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      note = `Prorata: ${remainingDays} days (today → ${targetStr}) × ${fmtRs(fullAmt)} ÷ ${daysInMonth} = ${fmtRs(roundedAmt)}`;
    } else if (isCurrentMonth && months > 1) {
      // Gap payment: past months full + current month prorata
      const nextMonth = payMonth === 11 ? 0 : payMonth + 1;
      const nextYear = payMonth === 11 ? payYear + 1 : payYear;
      const targetDate = new Date(nextYear, nextMonth, 16);
      const remainingDays = Math.ceil((targetDate.getTime() - today.getTime()) / 86400000);
      const daysInMonth = new Date(payYear, payMonth + 1, 0).getDate();
      const prorataAmt = (remainingDays / daysInMonth) * fullAmt;
      const roundedProrata = Math.round(prorataAmt / 10) * 10;
      const fullMonths = months - 1;
      netAmt = fullAmt * fullMonths + roundedProrata;
      fullDisplay = fullAmt * months;
      discount = fullDisplay - netAmt;
      note = `${fullMonths} month(s) full (${fmtRs(fullAmt * fullMonths)}) + current month prorata ${remainingDays} days (${fmtRs(roundedProrata)}) = ${fmtRs(netAmt)}`;
    }
  } else if (months === 1) {
    const selDate = new Date(monthVal + '-01');
    const selMonth = selDate.getMonth();
    const selYear = selDate.getFullYear();
    const isFutureMonth = selYear > payYear || (selYear === payYear && selMonth > payMonth);

    if (isDisconnected && payDay > 12 && payDay <= 20) {
      note = `Reconnect: Full month (${fmtRs(fullAmt)}). Billing cycle 13th–12th.`;
    } else if (isFutureMonth) {
      const monthName = selDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      note = `Full month payment for ${monthName}`;
    } else {
      note = `Full month payment`;
    }
  }

  return { netAmount: netAmt, fullDisplay, discount, note };
}

// ── Auto-detect gap and set defaults ─────────────────────────────────────
function detectGap(conn: ConnectionInfo): { isDisconnected: boolean; defaultMonth: string; gapNote: string } {
  const today = new Date();
  const expiryStr = conn?.expiry_date;
  const status = (conn?.status || '').toLowerCase();

  if (!expiryStr) {
    const now = new Date();
    return {
      isDisconnected: false,
      defaultMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      gapNote: '',
    };
  }

  const expiry = new Date(expiryStr + 'T23:59:59');
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expiryDate = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const isExpired = expiryDate < todayDate || status === 'disconnected' || status === 'inactive' || status === 'temp disconnected';

  if (isExpired) {
    const curMonth = today.getMonth();
    const curYear = today.getFullYear();
    const expMonth = expiry.getMonth();
    const expYear = expiry.getFullYear();
    const gapMonths = (curYear - expYear) * 12 + (curMonth - expMonth) + 1;
    const expStr = expiry.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return {
      isDisconnected: true,
      defaultMonth: `${curYear}-${String(curMonth + 1).padStart(2, '0')}`,
      gapNote: `Last paid till ${expStr} (${gapMonths} month gap). Reconnecting — 1 month prorata.`,
    };
  }

  // Not expired — check if already paid for current month
  const curMonth = today.getMonth();
  const curYear = today.getFullYear();
  const expMonth = expiryDate.getMonth();
  const expYear = expiryDate.getFullYear();

  if (expYear > curYear || (expYear === curYear && expMonth >= curMonth)) {
    let nextM = curMonth + 2;
    let nextY = curYear;
    if (nextM > 12) { nextM -= 12; nextY++; }
    const nextMonthName = new Date(nextY, nextM - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const expStr = expiry.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return {
      isDisconnected: false,
      defaultMonth: `${nextY}-${String(nextM).padStart(2, '0')}`,
      gapNote: `Already paid till ${expStr}. Month set to ${nextMonthName}.`,
    };
  }

  return {
    isDisconnected: false,
    defaultMonth: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
    gapNote: '',
  };
}

export default function RecordPayment() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const prefill = (location.state as { customerId?: number; customerName?: string }) || {};

  const [searchTerm, setSearchTerm] = useState(prefill.customerName || '');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [mode, setMode] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  // Connection + plan state
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [months, setMonths] = useState(1);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [gapNote, setGapNote] = useState('');
  const [connLoading, setConnLoading] = useState(false);

  // Discount state
  const [discountInput, setDiscountInput] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const DISCOUNT_REASONS = ['Node', 'Injector', 'Others'];

  // Cutoff date from settings
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

  // Auto-select if prefill — also load connections + plans + amounts
  useEffect(() => {
    if (prefill.customerId && !selectedCustomer) {
      customersApi.get(String(prefill.customerId)).then((res) => {
        const c = res.data as unknown as CustomerSearchResult;
        setSelectedCustomer(c);
        setSearchTerm(c.name);
        loadCustomerDetail(c);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.customerId]);

  // When customer is selected, fetch full detail + connections + plans
  const loadCustomerDetail = async (customer: CustomerSearchResult) => {
    setConnLoading(true);
    try {
      const res = await customersApi.get(customer.customer_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;
      const conns: ConnectionInfo[] = data.connections || [];
      setConnections(conns);

      // Auto-select active connection
      const activeConn = conns.find(c => c.status === 'Active') || conns[0];
      if (activeConn) {
        setSelectedConnId(activeConn.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const net = (activeConn as any).network || detectMSO(activeConn.stb_no);

        // Detect gap + set month
        const gap = detectGap(activeConn);
        setIsDisconnected(gap.isDisconnected);
        setGapNote(gap.gapNote);
        setMonth(gap.defaultMonth);
        setMonths(1);

        // Load plans filtered by MSO
        try {
          const planRes = await plansApi.list({ status: 'Active', network: net });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const planData = (planRes.data as any).plans || (planRes.data as any).items || planRes.data || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const planOpts: PlanOption[] = planData.map((p: any) => ({
            id: p.id,
            name: p.name,
            amount: p.amount || p.price || 0,
            network: p.network || net,
          }));
          setPlans(planOpts);

          // Auto-select customer's current plan
          const currentPlanName = activeConn.plan_name;
          if (currentPlanName) {
            const exact = planOpts.find(p => p.name?.toLowerCase() === currentPlanName.toLowerCase());
            if (exact) { setSelectedPlanId(exact.id); }
            else {
              const partial = planOpts.find(p =>
                p.name?.toLowerCase().includes(currentPlanName.toLowerCase()) ||
                currentPlanName.toLowerCase().includes(p.name.toLowerCase())
              );
              if (partial) { setSelectedPlanId(partial.id); }
              else { setSelectedPlanId(null); }
            }
          } else {
            setSelectedPlanId(null);
          }
        } catch { setPlans([]); }
      }
    } catch { /* ignore */ }
    setConnLoading(false);
  };

  const handleCustomerSelect = (c: CustomerSearchResult) => {
    setSelectedCustomer(c);
    setSearchTerm(c.name);
    loadCustomerDetail(c);
  };

  // When connection changes
  const handleConnChange = (connId: number) => {
    setSelectedConnId(connId);
    const conn = connections.find(c => c.id === connId);
    if (conn) {
      const gap = detectGap(conn);
      setIsDisconnected(gap.isDisconnected);
      setGapNote(gap.gapNote);
      setMonth(gap.defaultMonth);
      setMonths(1);
    }
  };

  // Selected plan object
  const selectedPlan = useMemo(
    () => plans.find(p => p.id === selectedPlanId) || null,
    [plans, selectedPlanId],
  );

  // Calculate amount via prorata
  const payCalc = useMemo(() => {
    if (!selectedPlan) return null;
    return calcPayAmount(selectedPlan.amount, months, month, isDisconnected);
  }, [selectedPlan, months, month, isDisconnected]);

  // Discount amount (parsed from input)
  const discountAmt = useMemo(() => {
    const v = parseFloat(discountInput);
    return isNaN(v) || v <= 0 ? 0 : v;
  }, [discountInput]);

  // Final amount after discount
  const finalAmount = useMemo(() => {
    if (!payCalc) return 0;
    return Math.max(0, payCalc.netAmount - discountAmt);
  }, [payCalc, discountAmt]);

  // Also reload plans when connection changes
  useEffect(() => {
    if (selectedConnId && connections.length) {
      const conn = connections.find(c => c.id === selectedConnId);
      if (conn) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const net = (conn as any).network || detectMSO(conn.stb_no);
        plansApi.list({ status: 'Active', network: net }).then((res) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const planData = (res.data as any).plans || (res.data as any).items || res.data || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const planOpts: PlanOption[] = planData.map((p: any) => ({
            id: p.id, name: p.name, amount: p.amount || p.price || 0, network: p.network || net,
          }));
          setPlans(planOpts);
          // Try to keep current plan if same MSO
          if (conn.plan_name) {
            const m = planOpts.find(p => p.name?.toLowerCase() === conn.plan_name!.toLowerCase());
            if (m) setSelectedPlanId(m.id);
          }
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnId]);

  const handleReset = () => {
    setSelectedCustomer(null);
    setSearchTerm('');
    setConnections([]);
    setSelectedConnId(null);
    setPlans([]);
    setSelectedPlanId(null);
    setMonths(1);
    setGapNote('');
    setIsDisconnected(false);
    setDiscountInput('');
    setDiscountReason('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) { setError('Please select a customer'); return; }
    if (!selectedPlanId) { setError('Please select a plan'); return; }
    if (!payCalc || payCalc.netAmount <= 0) { setError('Invalid amount'); return; }
    if (discountAmt > 0 && !discountReason) { setError('Please select a reason for the discount'); return; }
    if (discountAmt > payCalc.netAmount) { setError('Discount cannot exceed total amount'); return; }
    setError('');
    setShowConfirm(true);
  };

  const confirmAndPay = async () => {
    if (!selectedCustomer || !payCalc) return;
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const monthYear = month.split('-').reverse().join('-');
      await paymentsApi.create({
        customer_id: selectedCustomer.customer_id,
        connection_id: selectedConnId || undefined,
        plan_id: selectedPlanId || undefined,
        amount: finalAmount,
        payment_mode: mode,
        month_year: monthYear,
        months_paid: months,
        notes: notes || undefined,
        discount: discountAmt || undefined,
        discount_reason: discountReason || undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['customer', String(selectedCustomer.customer_id)] });
      setSuccess(true);
      setTimeout(() => navigate('/'), 2000);
    } catch {
      setError('Failed to record payment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="glass-card" style={{ padding: 48, textAlign: 'center', maxWidth: 360 }}>
          <CheckCircle style={{ width: 48, height: 48, color: '#34c759', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text)' }}>Payment Recorded!</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: 8 }}>
            {selectedPlan && payCalc ? `${fmtRs(finalAmount)} from ${selectedCustomer?.name} via ${mode}` : ''}
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: 12 }}>Redirecting to dashboard...</p>
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
            display: 'flex', alignItems: 'center', gap: 4, padding: '8px 14px',
            borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)',
            background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text)',
            fontSize: '0.85rem', fontWeight: 500,
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </button>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Record Payment
        </h1>
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,59,48,0.08)', border: '0.5px solid rgba(255,59,48,0.2)',
          color: '#ff3b30', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem',
        }}>
          <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />{error}
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
              <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'var(--text-light)' }} />
              <input
                type="text" value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setSelectedCustomer(null); }}
                className="glass-input"
                style={{ paddingLeft: 40, width: '100%', padding: '12px 16px 12px 40px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}
                placeholder="Search customer by name or phone..."
                disabled={!!selectedCustomer}
              />
              {selectedCustomer && (
                <button type="button" onClick={handleReset}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'var(--bg-secondary)', border: 'none', borderRadius: 'var(--radius-xs)', padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-light)' }}>
                  Change
                </button>
              )}
            </div>

            {/* Search Results Dropdown */}
            {!selectedCustomer && searchResults && searchResults.length > 0 && (
              <div className="glass-card animate-fade-in" style={{ marginTop: 4, padding: 0, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                {searchResults.map((c) => {
                  const ps = getPaymentStatus(c, Number(cutoffDate));
                  return (
                    <div key={c.customer_id} onClick={() => handleCustomerSelect(c)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', borderBottom: '0.5px solid var(--border)', transition: 'background 0.15s ease' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,113,227,0.05)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <div>
                        <p style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text)' }}>{c.name}</p>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
                          {c.phone || 'No phone'} {c.stb_no ? `| STB: ${c.stb_no}` : ''}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {c.plan_amount && <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>{fmtRs(c.plan_amount)}</p>}
                        <p style={{ fontSize: '0.7rem', fontWeight: 600, color: ps.color }}>{ps.label}</p>
                        {ps.label === 'Active | Unpaid' && <p style={{ fontSize: '0.62rem', color: 'var(--text-light)' }}>Due by {cutoffDate}th</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!selectedCustomer && searchTerm.length >= 2 && !isFetching && searchResults && searchResults.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: 8, padding: '0 4px' }}>No customers found matching "{searchTerm}"</p>
            )}
          </div>

          {/* Loading spinner for connection/plan load */}
          {connLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: 'var(--text-light)' }} />
            </div>
          )}

          {/* Customer verification card */}
          {selectedCustomer && !connLoading && (() => {
            const conn = connections.find(c => c.id === selectedConnId) || connections[0];
            return (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 0,
                borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                border: '0.5px solid var(--border)',
              }}>
                {/* Header row */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', background: 'var(--bg-secondary)',
                }}>
                  <div
                    onClick={() => navigate(`/customers/${selectedCustomer.customer_id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    title="View customer profile"
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: '#0071e3', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.95rem', fontWeight: 700, flexShrink: 0,
                    }}>
                      {(selectedCustomer.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0071e3', textDecoration: 'underline', textUnderlineOffset: 2 }}>{selectedCustomer.name}</p>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>ID: {selectedCustomer.customer_id} · Tap to view profile</p>
                    </div>
                  </div>
                  <button type="button" onClick={handleReset}
                    style={{
                      background: 'var(--bg-secondary)', border: '0.5px solid var(--border)',
                      borderRadius: 'var(--radius-xs)', padding: '4px 12px',
                      fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-light)',
                    }}>
                    Change
                  </button>
                </div>
                {/* Details grid */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
                  borderTop: '0.5px solid var(--border)',
                }}>
                  <div style={{ padding: '10px 16px', borderRight: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Phone</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{selectedCustomer.phone || '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Area</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{selectedCustomer.area || '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)', borderRight: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>STB No</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.stb_no || '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>MSO</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.mso || conn?.network || (conn?.stb_no ? detectMSO(conn.stb_no) : '—')}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)', borderRight: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Package</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.plan_name || '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Expiry</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.expiry_date || '—'}</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Connection selector (if multiple) */}
          {selectedCustomer && connections.length > 1 && !connLoading && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Connection (STB)</label>
              <select value={selectedConnId ?? ''} onChange={(e) => handleConnChange(Number(e.target.value))}
                className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                {connections.map((cn) => (
                  <option key={cn.id} value={cn.id}>
                    {cn.stb_no || `Connection ${cn.id}`} — {cn.mso || cn.network || detectMSO(cn.stb_no)} ({cn.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Plan selector */}
          {selectedCustomer && selectedConnId && !connLoading && plans.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Plan</label>
              <select value={selectedPlanId ?? ''} onChange={(e) => setSelectedPlanId(e.target.value ? Number(e.target.value) : null)}
                className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                <option value="">Select plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {fmtRs(p.amount)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Month + Months + Mode */}
          {selectedPlanId && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Billing Month</label>
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                    className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Months</label>
                  <select value={months} onChange={(e) => setMonths(Number(e.target.value))}
                    className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n}{n === 12 ? ' (1 free!)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Mode</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value)}
                    className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {/* Gap note */}
              {gapNote && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  background: 'rgba(255,204,0,0.08)', border: '0.5px solid rgba(255,204,0,0.2)',
                  padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                }}>
                  <Info style={{ width: 16, height: 16, color: '#ffcc00', flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: '0.8rem', color: 'var(--text)' }}>{gapNote}</p>
                </div>
              )}

              {/* Prorata note */}
              {payCalc?.note && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  background: 'rgba(0,113,227,0.06)', border: '0.5px solid rgba(0,113,227,0.15)',
                  padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                }}>
                  <Info style={{ width: 16, height: 16, color: '#0071e3', flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: '0.8rem', color: 'var(--text)' }}>{payCalc.note}</p>
                </div>
              )}

              {/* Amount breakdown */}
              {payCalc && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 6,
                  padding: '16px 20px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)', border: '0.5px solid var(--border)',
                }}>
                  {payCalc.discount > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                        <span style={{ color: 'var(--text-light)' }}>Full Amount</span>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{fmtRs(payCalc.fullDisplay)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                        <span style={{ color: 'var(--text-light)' }}>Prorata Discount</span>
                        <span style={{ color: '#34c759', fontWeight: 500 }}>- {fmtRs(payCalc.discount)}</span>
                      </div>
                    </>
                  )}
                  {discountAmt > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-light)' }}>
                        Discount ({discountReason})
                      </span>
                      <span style={{ color: '#ff9f0a', fontWeight: 500 }}>- {fmtRs(discountAmt)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: (payCalc.discount > 0 || discountAmt > 0) ? 6 : 0, borderTop: (payCalc.discount > 0 || discountAmt > 0) ? '0.5px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>Amount to Pay</span>
                    <span style={{ display: 'flex', alignItems: 'center', fontSize: '1.3rem', fontWeight: 700, color: '#0071e3' }}>
                      <IndianRupee style={{ width: 18, height: 18 }} />{finalAmount}
                    </span>
                  </div>
                </div>
              )}

              {/* Discount Input + Reason */}
              {payCalc && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                      Discount <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input
                      type="number" min="0" step="1" value={discountInput}
                      onChange={(e) => { setDiscountInput(e.target.value); if (!e.target.value) setDiscountReason(''); }}
                      className="glass-input"
                      style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}
                      placeholder="0"
                    />
                  </div>
                  {discountAmt > 0 && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                        Reason <span style={{ color: '#ff3b30' }}>*</span>
                      </label>
                      <select value={discountReason} onChange={(e) => setDiscountReason(e.target.value)}
                        className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                        <option value="">Select reason</option>
                        {DISCOUNT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                  Notes <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="glass-input"
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', minHeight: 60, resize: 'vertical' }}
                  placeholder="Any additional notes..." />
              </div>
            </>
          )}

          {/* Submit */}
          <button type="submit" disabled={submitting || !selectedCustomer || !selectedPlanId || !payCalc}
            style={{
              width: '100%', padding: '13px', borderRadius: 'var(--radius-sm)',
              background: submitting ? '#005bb5' : '#0071e3', color: '#fff',
              fontSize: '0.92rem', fontWeight: 600, border: 'none',
              cursor: submitting || !selectedCustomer || !selectedPlanId ? 'not-allowed' : 'pointer',
              transition: 'var(--transition)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: !selectedCustomer || !selectedPlanId ? 0.5 : 1,
              boxShadow: '0 2px 8px rgba(0,113,227,0.2)',
            }}>
            {submitting ? (
              <><Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} /> Processing...</>
            ) : payCalc ? (
              `Pay ${fmtRs(finalAmount)}`
            ) : 'Pay'}
          </button>
        </div>
      </form>

      {/* Confirmation Modal */}
      {showConfirm && selectedCustomer && payCalc && (() => {
        const conn = connections.find(c => c.id === selectedConnId) || connections[0];
        return (
          <div onClick={() => setShowConfirm(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20,
            }}>
            <div onClick={(e) => e.stopPropagation()}
              className="glass-card animate-fade-in"
              style={{
                maxWidth: 380, width: '100%', padding: 0, overflow: 'hidden',
                borderRadius: 16,
              }}>
              {/* Header */}
              <div style={{ padding: '20px 24px 16px', textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: 'rgba(0,113,227,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px',
                }}>
                  <IndianRupee style={{ width: 24, height: 24, color: '#0071e3' }} />
                </div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Confirm Payment</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: 4 }}>
                  Please verify before proceeding
                </p>
              </div>

              {/* Details */}
              <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Customer</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{selectedCustomer.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Customer ID</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{selectedCustomer.customer_id}</span>
                </div>
                {conn?.stb_no && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>STB No</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{conn.stb_no}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Plan</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{selectedPlan?.name || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Month</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{month.split('-').reverse().join('-')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Mode</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{mode}</span>
                </div>
                {months > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Months</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{months}</span>
                  </div>
                )}
                {discountAmt > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>Discount ({discountReason})</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#ff9f0a' }}>- {fmtRs(discountAmt)}</span>
                  </div>
                )}
              </div>

              {/* Amount + Actions */}
              <div style={{ padding: '16px 24px 20px' }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)', marginBottom: 16,
                }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>Amount</span>
                  <span style={{ display: 'flex', alignItems: 'center', fontSize: '1.4rem', fontWeight: 700, color: '#0071e3' }}>
                    <IndianRupee style={{ width: 20, height: 20 }} />{finalAmount}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button type="button" onClick={() => setShowConfirm(false)}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-secondary)', color: 'var(--text)',
                      fontSize: '0.88rem', fontWeight: 500, border: '0.5px solid var(--border)',
                      cursor: 'pointer',
                    }}>
                    Cancel
                  </button>
                  <button type="button" onClick={confirmAndPay}
                    style={{
                      flex: 2, padding: '12px', borderRadius: 'var(--radius-sm)',
                      background: '#34c759', color: '#fff',
                      fontSize: '0.88rem', fontWeight: 600, border: 'none',
                      cursor: 'pointer', boxShadow: '0 2px 8px rgba(52,199,89,0.3)',
                    }}>
                    Confirm & Pay {fmtRs(finalAmount)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
