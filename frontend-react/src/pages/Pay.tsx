import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';

// Public payment page (no login). Opened from the WhatsApp reminder link:
//   https://wasool.co.in/app/pay?amt=180
// Most reliable path is the QR — the customer scans it with any UPI app. The tap
// buttons are a convenience but some UPI apps restrict app-to-app links to
// personal/collect UPI IDs, so the QR + UPI ID are the dependable fallbacks.

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
    width: '100%', padding: '13px', borderRadius: 12, fontSize: '0.95rem',
    fontWeight: 600, textDecoration: 'none', border: 'none', cursor: 'pointer',
  };

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
        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1d1d1f', lineHeight: 1.4 }}>
          {BUSINESS}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#86868b', margin: '2px 0 16px' }}>Cable TV payment</div>

        {amt && (
          <>
            <div style={{ fontSize: '0.8rem', color: '#86868b' }}>Amount to pay</div>
            <div style={{ fontSize: '2.3rem', fontWeight: 700, color: '#1d1d1f', margin: '2px 0 18px' }}>₹{amt}</div>
          </>
        )}

        {/* QR — most reliable: scan with any UPI app */}
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1d1d1f', marginBottom: 10 }}>
          Scan to pay with any UPI app
        </div>
        <div style={{ display: 'inline-block', padding: 14, background: '#fff', border: '1px solid #e2e6ef', borderRadius: 16 }}>
          <QRCodeSVG value={upi} size={190} level="M" />
        </div>
        <div style={{ fontSize: '0.75rem', color: '#86868b', margin: '10px 0 18px' }}>
          Open GPay / PhonePe / Paytm → Scan any QR → point at this code.
        </div>

        {/* Tap-to-pay buttons (convenience) */}
        <a href={upi} style={{ ...btn, background: 'linear-gradient(135deg, #5aa2ff, #8b5cff)', color: '#fff', marginBottom: 10 }}>
          Pay {amt ? `₹${amt}` : 'now'} in UPI app
        </a>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <a href={gpay} style={{ ...btn, background: '#f1f3f9', color: '#1d1d1f', border: '1px solid #e2e6ef' }}>GPay</a>
          <a href={phonepe} style={{ ...btn, background: '#f1f3f9', color: '#5f259f', border: '1px solid #e2e6ef' }}>PhonePe</a>
        </div>

        <div style={{ padding: '12px 14px', background: '#f6f7fb', borderRadius: 12 }}>
          <div style={{ fontSize: '0.72rem', color: '#86868b' }}>Or pay to this UPI ID</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1d1d1f', wordBreak: 'break-all', margin: '2px 0 8px' }}>
            {VPA}
          </div>
          <button onClick={copy} style={{ ...btn, padding: '10px', background: '#e8eefc', color: '#2563eb' }}>
            {copied ? 'Copied ✓' : 'Copy UPI ID'}
          </button>
        </div>

        <div style={{ fontSize: '0.72rem', color: '#a1a1a6', marginTop: 16 }}>
          If a tap button is blocked by your UPI app, use the QR above or the UPI ID.
        </div>
      </div>
    </div>
  );
}
