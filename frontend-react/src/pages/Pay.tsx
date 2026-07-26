import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// Public payment page (no login). Opened from the WhatsApp reminder link:
//   https://wasool.co.in/app/pay?amt=180
// Tapping "Pay" launches the phone's UPI app chooser (GPay / PhonePe / Paytm)
// with the amount and business UPI ID pre-filled.

const VPA = 'selvanayakiammancables-3@okhdfcbank';
const BUSINESS = 'Sree Selvanaayakki Amman Cables & Internet Services';

export default function Pay() {
  const [sp] = useSearchParams();
  const amt = (sp.get('amt') || '').replace(/[^\d.]/g, '');
  const [copied, setCopied] = useState(false);

  const pn = encodeURIComponent(BUSINESS);
  const am = amt ? `&am=${encodeURIComponent(amt)}` : '';
  const upi = `upi://pay?pa=${VPA}&pn=${pn}${am}&cu=INR`;
  const gpay = `tez://upi/pay?pa=${VPA}&pn=${pn}${am}&cu=INR`;
  const phonepe = `phonepe://pay?pa=${VPA}&pn=${pn}${am}&cu=INR`;

  const copy = () => {
    navigator.clipboard?.writeText(VPA).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', padding: '15px', borderRadius: 12, fontSize: '1rem',
    fontWeight: 600, textDecoration: 'none', marginBottom: 10, border: 'none', cursor: 'pointer',
  };

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 16px', background: 'linear-gradient(135deg, #eef2ff 0%, #f6f7fb 100%)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 400, background: '#fff', borderRadius: 20,
          boxShadow: '0 16px 50px rgba(0,0,0,0.12)', padding: 26, textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1d1d1f', lineHeight: 1.4 }}>
          {BUSINESS}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#86868b', margin: '2px 0 18px' }}>Cable TV payment</div>

        {amt ? (
          <>
            <div style={{ fontSize: '0.8rem', color: '#86868b' }}>Amount to pay</div>
            <div style={{ fontSize: '2.4rem', fontWeight: 700, color: '#1d1d1f', margin: '2px 0 20px' }}>₹{amt}</div>
          </>
        ) : (
          <div style={{ fontSize: '1rem', color: '#1d1d1f', margin: '10px 0 20px' }}>Pay using any UPI app</div>
        )}

        <a href={upi} style={{ ...btn, background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)', color: '#fff' }}>
          Pay {amt ? `₹${amt}` : 'now'} via UPI
        </a>

        <div style={{ display: 'flex', gap: 10 }}>
          <a href={gpay} style={{ ...btn, background: '#f1f3f9', color: '#1d1d1f', border: '1px solid #e2e6ef' }}>
            GPay
          </a>
          <a href={phonepe} style={{ ...btn, background: '#f1f3f9', color: '#5f259f', border: '1px solid #e2e6ef' }}>
            PhonePe
          </a>
        </div>

        <div style={{ marginTop: 16, padding: '12px 14px', background: '#f6f7fb', borderRadius: 12 }}>
          <div style={{ fontSize: '0.72rem', color: '#86868b' }}>Or pay to this UPI ID</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1d1d1f', wordBreak: 'break-all', margin: '2px 0 8px' }}>
            {VPA}
          </div>
          <button onClick={copy} style={{ ...btn, marginBottom: 0, padding: '10px', background: '#e8eefc', color: '#2563eb' }}>
            {copied ? 'Copied ✓' : 'Copy UPI ID'}
          </button>
        </div>

        <div style={{ fontSize: '0.72rem', color: '#a1a1a6', marginTop: 16 }}>
          If the buttons don't open an app, copy the UPI ID and pay from your GPay / PhonePe app.
        </div>
      </div>
    </div>
  );
}
