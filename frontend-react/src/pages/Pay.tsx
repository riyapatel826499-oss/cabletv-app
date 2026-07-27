import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';

// Public payment page (no login). Opened from the WhatsApp reminder link:
//   https://wasool.co.in/app/pay?amt=180
// Primary method is Razorpay Standard Checkout (cards/UPI/GPay/PhonePe, no payee
// restrictions). QR + UPI ID are kept as fallbacks.

const VPA = 'selvanayakiammancables-3@okhdfcbank';
const BUSINESS = 'Sree Selvanaayakki Amman Cables & Internet Services';

type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};
interface RazorpayInstance {
  open(): void;
  on(event: string, cb: (resp: unknown) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

function loadCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load payment gateway'));
    document.body.appendChild(s);
  });
}

type PayStatus = 'idle' | 'success' | 'failed' | 'cancelled' | 'error';

export default function Pay() {
  const [sp] = useSearchParams();
  const amt = (sp.get('amt') || '').replace(/[^\d.]/g, '');
  const cid = sp.get('cid') || undefined; // customer id (for auto-confirmation)
  const payMonth = sp.get('month') || undefined; // YYYY-MM
  const paise = amt ? Math.round(Number(amt) * 100) : 0;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PayStatus>('idle');

  const pn = encodeURIComponent(BUSINESS);
  const am = amt ? `&am=${encodeURIComponent(amt)}` : '';
  const upi = `upi://pay?pa=${VPA}&pn=${pn}${am}&cu=INR`;

  const copy = () => {
    navigator.clipboard?.writeText(VPA).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  async function payNow() {
    if (!amt || paise < 100) {
      alert('Invalid amount.');
      return;
    }
    setBusy(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: paise, receipt: 'wasool-' + Date.now(), customer_id: cid, month: payMonth }),
      });
      if (!res.ok) throw new Error('order');
      const order = await res.json();

      await loadCheckout();
      const Rz = window.Razorpay;
      if (!Rz) throw new Error('script');

      const rzp = new Rz({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: BUSINESS,
        description: 'Cable TV payment',
        theme: { color: '#5aa2ff' },
        handler: async (resp: RazorpayResponse) => {
          try {
            const v = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resp),
            });
            setStatus(v.ok ? 'success' : 'failed');
          } catch {
            setStatus('error');
          }
        },
        modal: {
          ondismiss: () => {
            setStatus('cancelled');
            setBusy(false);
          },
        },
      });
      rzp.on('payment.failed', () => setStatus('failed'));
      rzp.open();
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', padding: '14px', borderRadius: 12, fontSize: '1rem',
    fontWeight: 600, textDecoration: 'none', border: 'none', cursor: 'pointer',
  };

  const banner = (bg: string, color: string, text: string) => (
    <div style={{ background: bg, color, borderRadius: 12, padding: '12px 14px', fontSize: '0.9rem', marginBottom: 14 }}>
      {text}
    </div>
  );

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px', background: 'linear-gradient(135deg, #eef2ff 0%, #f6f7fb 100%)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 400, background: '#fff', borderRadius: 20,
          boxShadow: '0 16px 50px rgba(0,0,0,0.12)', padding: 26, textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1d1d1f', lineHeight: 1.4 }}>{BUSINESS}</div>
        <div style={{ fontSize: '0.8rem', color: '#86868b', margin: '2px 0 16px' }}>Cable TV payment</div>

        {amt && (
          <>
            <div style={{ fontSize: '0.8rem', color: '#86868b' }}>Amount to pay</div>
            <div style={{ fontSize: '2.3rem', fontWeight: 700, color: '#1d1d1f', margin: '2px 0 16px' }}>₹{amt}</div>
          </>
        )}

        {status === 'success' && banner('#e7f8ee', '#137a3f', 'Payment successful. Thank you!')}
        {status === 'failed' && banner('#fdeaea', '#b91c1c', 'Payment failed. Please try again.')}
        {status === 'cancelled' && banner('#fef6e7', '#92600a', 'Payment cancelled.')}
        {status === 'error' && banner('#fdeaea', '#b91c1c', 'Something went wrong. Try the QR or UPI ID below.')}

        {/* Primary — Razorpay secure checkout */}
        {amt && status !== 'success' && (
          <button
            onClick={payNow}
            disabled={busy}
            style={{ ...btn, background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)', color: '#fff', opacity: busy ? 0.7 : 1, marginBottom: 16 }}
          >
            {busy ? 'Please wait\u2026' : `Pay \u20b9${amt} securely`}
          </button>
        )}

        {/* Fallback — scan QR with any UPI app */}
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1d1d1f', marginBottom: 10 }}>Or scan to pay</div>
        <div style={{ display: 'inline-block', padding: 12, background: '#fff', border: '1px solid #e2e6ef', borderRadius: 16 }}>
          <QRCodeSVG value={upi} size={170} level="M" />
        </div>

        <div style={{ marginTop: 16, padding: '12px 14px', background: '#f6f7fb', borderRadius: 12 }}>
          <div style={{ fontSize: '0.72rem', color: '#86868b' }}>Or pay to this UPI ID</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1d1d1f', wordBreak: 'break-all', margin: '2px 0 8px' }}>{VPA}</div>
          <button onClick={copy} style={{ ...btn, padding: '10px', background: '#e8eefc', color: '#2563eb' }}>
            {copied ? 'Copied \u2713' : 'Copy UPI ID'}
          </button>
        </div>
      </div>
    </div>
  );
}
