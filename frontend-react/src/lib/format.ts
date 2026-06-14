// Shared display formatters.

export function fmtRs(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return '₹' + v.toLocaleString('en-IN');
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '--';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '--';
  const raw = String(d).trim();

  // Two timestamp sources, both already in IST:
  // 1. Paypakka: "2026-04-27T10:21:34.000Z" — actually IST time but tagged as UTC (Z).
  //    Strip Z so JS treats the time as-is (local IST).
  // 2. Local payments: "2026-06-13 08:30:00" — IST from backend datetime.now(ist).
  //    Convert to T format without Z so browser treats as local (IST for Indian users).
  let cleaned: string;
  if (/T.*[Zz]$/.test(raw)) {
    // Paypakka ISO format with Z — strip the Z, time is already IST
    cleaned = raw.replace(/[Zz]$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  } else if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    // Local payment — space-separated, already IST from backend
    cleaned = raw.replace(' ', 'T');
  } else if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) {
    // ISO without Z — already IST, keep as-is
    cleaned = raw;
  } else {
    cleaned = raw;
  }

  const dt = new Date(cleaned);
  if (isNaN(dt.getTime())) return String(d);
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr}, ${timeStr}`;
}
