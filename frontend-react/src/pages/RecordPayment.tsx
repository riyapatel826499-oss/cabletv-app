import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StbCopy from '../components/StbCopy';
import { customersApi, paymentsApi, plansApi, settingsApi } from '../api';
import type { CustomerListItem } from '../types';
import { fmtRs } from '../lib/format';
import { calcPayAmount } from '../lib/prorata';
import { Search, Loader2, CheckCircle, AlertCircle, ArrowLeft, Receipt, Info } from 'lucide-react';
import Rs from '../components/Rs';
import { useT, translate } from '../lib/i18n';

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
      gapNote: translate('Last paid till {expStr} ({n} month gap). Reconnecting — 1 month prorata.', { expStr, n: gapMonths }),
    };
  }

  // Not expired — next unpaid billing month = month of expiry date.
  // Expiry 12 Jul means June cycle is paid; next to collect is July (07-2026).
  // NEVER use curMonth+2 (that stored Aug and left customers on not-renewed).
  const curMonth = today.getMonth();
  const curYear = today.getFullYear();
  const expMonth = expiryDate.getMonth();
  const expYear = expiryDate.getFullYear();

  if (expYear > curYear || (expYear === curYear && expMonth >= curMonth)) {
    const nextM = expMonth + 1; // 1-indexed month of expiry = next unpaid month_year
    const nextY = expYear;
    const nextMonthName = new Date(nextY, nextM - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const expStr = expiry.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return {
      isDisconnected: false,
      defaultMonth: `${nextY}-${String(nextM).padStart(2, '0')}`,
      gapNote: translate('Already paid till {expStr}. Month set to {nextMonthName} (next unpaid).', { expStr, nextMonthName }),
    };
  }

  return {
    isDisconnected: false,
    defaultMonth: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
    gapNote: '',
  };
}

export default function RecordPayment() {
  const { t } = useT();
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
  const [receiptExpiry, setReceiptExpiry] = useState<string | null>(null);
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

  // Operator settings for business name on receipts
  const { data: opSettings } = useQuery<{business_name?: string; upi_reconnect_id?: string; care_phone?: string; phone?: string; wa_receipt_template?: string; wa_receipt_template_ta?: string; prorata_enabled?: boolean; prorata_billing_day?: number; prorata_target_day?: number}>({
    queryKey: ['operator-settings-public'],
    queryFn: async () => {
      const r = await fetch('/api/portal/settings');
      return r.json();
    },
    staleTime: 300_000,
  });

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
    return calcPayAmount(
      selectedPlan.amount,
      months,
      month,
      isDisconnected,
      {
        enabled: opSettings?.prorata_enabled !== false,
        billingDay: opSettings?.prorata_billing_day,
        targetDay: opSettings?.prorata_target_day,
      },
    );
  }, [selectedPlan, months, month, isDisconnected, opSettings?.prorata_enabled, opSettings?.prorata_billing_day, opSettings?.prorata_target_day]);

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
    if (!selectedCustomer) { setError(t('Please select a customer')); return; }
    if (!selectedPlanId) { setError(t('Please select a plan')); return; }
    if (!payCalc || payCalc.netAmount <= 0) { setError(t('Invalid amount')); return; }
    if (discountAmt > 0 && !discountReason) { setError(t('Please select a reason for the discount')); return; }
    if (discountAmt > payCalc.netAmount) { setError(t('Discount cannot exceed total amount')); return; }
    setError('');
    setShowConfirm(true);
  };

  const confirmAndPay = async () => {
    if (!selectedCustomer || !payCalc) return;
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const monthYear = month.split('-').reverse().join('-');
      const resp = await paymentsApi.create({
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
      // Real post-payment expiry from the server (used for "Valid till" on the receipt)
      const newExpiry = (resp as { expiry_date?: string | null }).expiry_date;
      if (newExpiry) setReceiptExpiry(newExpiry);
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['customer', String(selectedCustomer.customer_id)] });
      setSuccess(true);
    } catch {
      setError(t('Failed to record payment. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    const digits = (selectedCustomer?.phone || '').replace(/\D/g, '');
    const waPhone = digits.length === 10 ? '91' + digits : digits;
    let monthLabel = month;
    try {
      monthLabel = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    } catch { /* keep raw */ }
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    // Real validity = post-payment expiry from server, formatted as DD MMM YYYY
    let validityStr = '';
    if (receiptExpiry) {
      try {
        validityStr = new Date(receiptExpiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      } catch { validityStr = receiptExpiry; }
    }
    const payPhone = opSettings?.care_phone || opSettings?.phone || '7708551139';
    const bizName = opSettings?.business_name || 'Sree Selvanaayakki Amman Cables & Internet Services';
    const upi = opSettings?.upi_reconnect_id || 'selvanayakiammancables-3@okhdfcbank';
    // Tamil month names for the Tamil block
    const TA_MONTHS = ['ஜனவரி','பிப்ரவரி','மார்ச்','ஏப்ரல்','மே','ஜூன்','ஜூலை','ஆகஸ்ட்','செப்டம்பர்','அக்டோபர்','நவம்பர்','டிசம்பர்'];
    const TA_MODE: Record<string,string> = { Cash: 'ரொக்கம்', GPay: 'ஜிபே', PhonePe: 'போன்பே', UPI: 'யூபிஐ', Bank: 'வங்கி', Other: 'மற்றவை' };
    const taDate = (d: Date) => `${String(d.getDate()).padStart(2,'0')} ${TA_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const taMonth = (mLabel: string) => {
      try { const d = new Date(month + '-01'); return `${TA_MONTHS[d.getMonth()]} ${d.getFullYear()}`; } catch { return mLabel; }
    };
    const monthTa = taMonth(monthLabel);
    const dateTa = taDate(new Date());
    const validityTa = receiptExpiry ? (() => { try { return taDate(new Date(receiptExpiry)); } catch { return receiptExpiry; } })() : '';
    // Render editable template from Settings (placeholders), falls back to built-in message
    const renderReceipt = (tpl: string) => {
      const vars: Record<string, string> = {
        business: bizName,
        customer: selectedCustomer?.name ?? '',
        customer_id: selectedCustomer?.customer_id ?? '',
        amount: fmtRs(finalAmount),
        month: monthLabel + (months > 1 ? ` (${t('{n} mo', { n: months })})` : ''),
        mode,
        date: dateStr,
        valid_till: validityStr,
        upi,
        phone: payPhone,
        // Tamil placeholders
        month_ta: monthTa,
        mode_ta: TA_MODE[mode] ?? mode,
        date_ta: dateTa,
        valid_till_ta: validityTa,
      };
      return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
    };
    const template = opSettings?.wa_receipt_template?.trim();
    const templateTa = opSettings?.wa_receipt_template_ta?.trim();
    const receiptMsg = template
      ? renderReceipt(template) + (templateTa ? `\n\n${renderReceipt(templateTa)}` : '')
      : // Built-in fallback
        `*${bizName}*\n` +
        `${t('Payment Receipt')}\n` +
        `-----------------------------\n` +
        `${t('Customer: {name} ({id})', { name: selectedCustomer?.name ?? '', id: selectedCustomer?.customer_id ?? '' })}\n` +
        `${t('Amount paid: ₹{amount}', { amount: fmtRs(finalAmount) })}\n` +
        `${t('For: {month}', { month: monthLabel })}${months > 1 ? t(' ({n} months)', { n: months }) : ''}\n` +
        `${t('Mode: {m}', { m: mode })}\n` +
        `${t('Date: {d}', { d: dateStr })}\n` +
        (validityStr ? `${t('Valid till: {d}', { d: validityStr })}\n` : '') +
        `-----------------------------\n` +
        `${t('Thank you for your payment.')}\n` +
        `${t('UPI for next time: {upi}', { upi })}\n` +
        `${t('GPay / PhonePe: {num}', { num: payPhone })}\n\n` +
        `- ${t('Regards, {business}', { business: bizName })}`;
    const waLink = `https://wa.me/${waPhone}?text=${encodeURIComponent(receiptMsg)}`;
    const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85rem', padding: '4px 0' };
    return (
      <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="glass-card" style={{ padding: 26, maxWidth: 380, width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <CheckCircle style={{ width: 44, height: 44, color: '#34c759', margin: '0 auto 10px' }} />
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text)' }}>{t('Payment recorded')}</h2>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '10px 0', margin: '6px 0 16px' }}>
            <div style={row}><span style={{ color: 'var(--text-light)' }}>{t('Customer')}</span><span style={{ color: 'var(--text)', fontWeight: 500, textAlign: 'right' }}>{selectedCustomer?.name}</span></div>
            <div style={row}><span style={{ color: 'var(--text-light)' }}>{t('Amount')}</span><span style={{ color: 'var(--text)', fontWeight: 600 }}>₹{fmtRs(finalAmount)}</span></div>
            <div style={row}><span style={{ color: 'var(--text-light)' }}>{t('For')}</span><span style={{ color: 'var(--text)' }}>{monthLabel}{months > 1 ? ` (${t('{n} mo', { n: months })})` : ''}</span></div>
            <div style={row}><span style={{ color: 'var(--text-light)' }}>{t('Mode')}</span><span style={{ color: 'var(--text)' }}>{mode}</span></div>
            <div style={row}><span style={{ color: 'var(--text-light)' }}>{t('Date')}</span><span style={{ color: 'var(--text)' }}>{dateStr}</span></div>
            {validityStr && <div style={row}><span style={{ color: 'var(--text-light)' }}>{t('Valid till')}</span><span style={{ color: 'var(--text)', fontWeight: 500 }}>{validityStr}</span></div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {waPhone && (
              <a href={waLink} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 'var(--radius-sm)', background: '#25D366', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' }}>
                <Receipt style={{ width: 18, height: 18 }} /> {t('Send receipt on WhatsApp')}
              </a>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => navigate('/')}
                style={{ flex: 1, padding: '11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text)', cursor: 'pointer', fontWeight: 500, fontSize: '0.88rem' }}>
                {t('Done')}
              </button>
              <button onClick={() => window.location.assign('/app/payments/new')}
                style={{ flex: 1, padding: '11px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'linear-gradient(135deg, #5aa2ff 0%, #8b5cff 100%)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
                {t('New payment')}
              </button>
            </div>
          </div>
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
          <ArrowLeft style={{ width: 16, height: 16 }} /> {t('Back')}
        </button>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          {t('Record Payment')}
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
              {t('Customer')}
            </label>
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'var(--text-light)' }} />
              <input
                type="text" value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setSelectedCustomer(null); }}
                className="glass-input"
                style={{ paddingLeft: 40, width: '100%', padding: '12px 16px 12px 40px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}
                placeholder={t('Search customer by name or phone...')}
                disabled={!!selectedCustomer}
              />
              {selectedCustomer && (
                <button type="button" onClick={handleReset}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'var(--bg-secondary)', border: 'none', borderRadius: 'var(--radius-xs)', padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-light)' }}>
                  {t('Change')}
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
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{c.phone || t('No phone')}</span> {c.stb_no && <StbCopy stb={c.stb_no} />}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {c.plan_amount && <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}><Rs amount={c.plan_amount} /></p>}
                        <p style={{ fontSize: '0.7rem', fontWeight: 600, color: ps.color }}>{t(ps.label)}</p>
                        {ps.label === 'Active | Unpaid' && <p style={{ fontSize: '0.62rem', color: 'var(--text-light)' }}>{t('Due by {day}th', { day: cutoffDate })}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!selectedCustomer && searchTerm.length >= 2 && !isFetching && searchResults && searchResults.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: 8, padding: '0 4px' }}>{t('No customers found matching "{query}"', { query: searchTerm })}</p>
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
                    title={t('View customer profile')}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #5aa2ff 0%, #8b5cff 100%)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.95rem', fontWeight: 700, flexShrink: 0,
                    }}>
                      {(selectedCustomer.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0071e3', textDecoration: 'underline', textUnderlineOffset: 2 }}>{selectedCustomer.name}</p>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>{t('ID: {id} · Tap to view profile', { id: selectedCustomer.customer_id })}</p>
                    </div>
                  </div>
                  <button type="button" onClick={handleReset}
                    style={{
                      background: 'var(--bg-secondary)', border: '0.5px solid var(--border)',
                      borderRadius: 'var(--radius-xs)', padding: '4px 12px',
                      fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-light)',
                    }}>
                    {t('Change')}
                  </button>
                </div>
                {/* Details grid */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
                  borderTop: '0.5px solid var(--border)',
                }}>
                  <div style={{ padding: '10px 16px', borderRight: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('Phone')}</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{selectedCustomer.phone || '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('Area')}</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{selectedCustomer.area || '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)', borderRight: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('STB No')}</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.stb_no ? <StbCopy stb={conn.stb_no} prefix="" /> : '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('MSO')}</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.mso || conn?.network || (conn?.stb_no ? detectMSO(conn.stb_no) : '—')}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)', borderRight: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('Package')}</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.plan_name || '—'}</p>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('Expiry')}</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{conn?.expiry_date || '—'}</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Connection selector (if multiple) */}
          {selectedCustomer && connections.length > 1 && !connLoading && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>{t('Connection (STB)')}</label>
              <select value={selectedConnId ?? ''} onChange={(e) => handleConnChange(Number(e.target.value))}
                className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                {connections.map((cn) => (
                  <option key={cn.id} value={cn.id}>
                    {cn.stb_no || t('Connection {id}', { id: cn.id })} — {cn.mso || cn.network || detectMSO(cn.stb_no)} ({cn.status ? t(cn.status) : ''})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Plan selector */}
          {selectedCustomer && selectedConnId && !connLoading && plans.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>{t('Plan')}</label>
              <select value={selectedPlanId ?? ''} onChange={(e) => setSelectedPlanId(e.target.value ? Number(e.target.value) : null)}
                className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                <option value="">{t('Select plan')}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — ₹{fmtRs(p.amount)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Month + Months + Mode */}
          {selectedPlanId && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>{t('Billing Month')}</label>
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                    className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>{t('Months')}</label>
                  <select value={months} onChange={(e) => setMonths(Number(e.target.value))}
                    className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n === 12 ? t('{n} (1 free!)', { n }) : n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>{t('Mode')}</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value)}
                    className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{t(m)}</option>)}
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
                        <span style={{ color: 'var(--text-light)' }}>{t('Full Amount')}</span>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}><Rs amount={payCalc.fullDisplay} /></span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                        <span style={{ color: 'var(--text-light)' }}>{t('Prorata Discount')}</span>
                        <span style={{ color: '#34c759', fontWeight: 500 }}>- <Rs amount={payCalc.discount} /></span>
                      </div>
                    </>
                  )}
                  {discountAmt > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-light)' }}>
                        {t('Discount ({reason})', { reason: t(discountReason) })}
                      </span>
                      <span style={{ color: '#ff9f0a', fontWeight: 500 }}>- <Rs amount={discountAmt} /></span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: (payCalc.discount > 0 || discountAmt > 0) ? 6 : 0, borderTop: (payCalc.discount > 0 || discountAmt > 0) ? '0.5px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{t('Amount to Pay')}</span>
                    <span style={{ display: 'flex', alignItems: 'center', fontSize: '1.3rem', fontWeight: 700, color: '#0071e3' }}>
                      <Rs amount={finalAmount} />
                    </span>
                  </div>
                </div>
              )}

              {/* Discount Input + Reason */}
              {payCalc && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                      {t('Discount')} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({t('Optional')})</span>
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
                        {t('Reason')} <span style={{ color: '#ff3b30' }}>*</span>
                      </label>
                      <select value={discountReason} onChange={(e) => setDiscountReason(e.target.value)}
                        className="glass-input" style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', cursor: 'pointer' }}>
                        <option value="">{t('Select reason')}</option>
                        {DISCOUNT_REASONS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                  {t('Notes')} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({t('Optional')})</span>
                </label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="glass-input"
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', minHeight: 60, resize: 'vertical' }}
                  placeholder={t('Any additional notes...')} />
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
              <><Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} /> {t('Processing...')}</>
            ) : payCalc ? (
              t('Pay ₹{amount}', { amount: fmtRs(finalAmount) })
            ) : t('Pay')}
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
                  <Receipt style={{ width: 24, height: 24, color: '#0071e3' }} />
                </div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>{t('Confirm Payment')}</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: 4 }}>
                  {t('Please verify before proceeding')}
                </p>
              </div>

              {/* Details */}
              <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('Customer')}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{selectedCustomer.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('Customer ID')}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{selectedCustomer.customer_id}</span>
                </div>
                {conn?.stb_no && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('STB No')}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{conn.stb_no ? <StbCopy stb={conn.stb_no} prefix="" /> : '—'}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('Plan')}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{selectedPlan?.name || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('Month')}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{month.split('-').reverse().join('-')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('Mode')}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{mode}</span>
                </div>
                {months > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('Months')}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{months}</span>
                  </div>
                )}
                {discountAmt > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>{t('Discount ({reason})', { reason: t(discountReason) })}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#ff9f0a' }}>- <Rs amount={discountAmt} /></span>
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
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>{t('Amount')}</span>
                  <span style={{ display: 'flex', alignItems: 'center', fontSize: '1.4rem', fontWeight: 700, color: '#0071e3' }}>
                    <Rs amount={finalAmount} />
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
                    {t('Cancel')}
                  </button>
                  <button type="button" onClick={confirmAndPay}
                    style={{
                      flex: 2, padding: '12px', borderRadius: 'var(--radius-sm)',
                      background: '#34c759', color: '#fff',
                      fontSize: '0.88rem', fontWeight: 600, border: 'none',
                      cursor: 'pointer', boxShadow: '0 2px 8px rgba(52,199,89,0.3)',
                    }}>
                    {t('Confirm & Pay')} <Rs amount={finalAmount} />
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
