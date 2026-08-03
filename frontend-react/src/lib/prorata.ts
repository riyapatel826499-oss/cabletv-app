import { fmtRs } from './format';

// Shared prorata / reconnection calculation — used by BOTH the Record Payment
// screen and the Collection Map's reconnection WhatsApp reminder, so the amount
// shown to the customer always matches what they will actually pay.

export interface PayCalc {
  netAmount: number;
  fullDisplay: number;
  discount: number;
  note: string;
}

export function calcPayAmount(
  planAmount: number,
  months: number,
  monthVal: string, // YYYY-MM
  isDisconnected: boolean,
  prorataEnabled = true,
): PayCalc {
  const fullAmt = planAmount || 0;
  const today = new Date();
  const payDay = today.getDate();
  const payMonth = today.getMonth(); // 0-indexed
  const payYear = today.getFullYear();

  let netAmt = fullAmt * months;
  let discount = 0;
  let fullDisplay = fullAmt * months;
  let note = '';

  if (months === 12) {
    discount = fullAmt;
    netAmt = fullAmt * 11;
    note = `Yearly Pack: 12 months, pay for 11 — 1 month FREE! (₹${fmtRs(fullAmt)} saved)`;
  } else if (prorataEnabled && isDisconnected && payDay <= 12) {
    const daysInMonth = new Date(payYear, payMonth + 1, 0).getDate();
    const prorataDays = 13 - payDay;
    const prorataAmt = (prorataDays / daysInMonth) * fullAmt;
    const roundedProrata = Math.round(prorataAmt / 10) * 10;
    netAmt = roundedProrata + fullAmt;
    fullDisplay = netAmt;
    note = `Reconnect: ${prorataDays} days prorata (₹${fmtRs(roundedProrata)}) + 1 full month (₹${fmtRs(fullAmt)}) = ₹${fmtRs(netAmt)}`;
  } else if (prorataEnabled && payDay > 20 && months >= 1) {
    const selDate = new Date(monthVal + '-01');
    const selMonth = selDate.getMonth();
    const selYear = selDate.getFullYear();
    const isCurrentMonth = payYear === selYear && payMonth === selMonth;

    if (isCurrentMonth && months === 1) {
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
      note = `Prorata: ${remainingDays} days (today → ${targetStr}) × ₹${fmtRs(fullAmt)} ÷ ${daysInMonth} = ₹${fmtRs(roundedAmt)}`;
    } else if (isCurrentMonth && months > 1) {
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
      note = `${fullMonths} month(s) full (₹${fmtRs(fullAmt * fullMonths)}) + current month prorata ${remainingDays} days (₹${fmtRs(roundedProrata)}) = ₹${fmtRs(netAmt)}`;
    }
  } else if (months === 1) {
    const selDate = new Date(monthVal + '-01');
    const selMonth = selDate.getMonth();
    const selYear = selDate.getFullYear();
    const isFutureMonth = selYear > payYear || (selYear === payYear && selMonth > payMonth);

    if (isDisconnected && payDay > 12 && payDay <= 20) {
      note = `Reconnect: Full month (₹${fmtRs(fullAmt)}). Billing cycle 13th–12th.`;
    } else if (isFutureMonth) {
      const monthName = selDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      note = `Full month payment for ${monthName}`;
    } else {
      note = `Full month payment`;
    }
  }

  return { netAmount: netAmt, fullDisplay, discount, note };
}
