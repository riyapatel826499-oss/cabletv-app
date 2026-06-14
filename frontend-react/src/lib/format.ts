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

  // Two timestamp sources with different timezone bugs:
  // 1. Paypakka: "2026-04-27T10:21:34.000Z" — actually IST time but tagged as UTC (Z).
  //    Strip Z so JS treats the time as-is (local IST).
  // 2. Local payments: "2026-06-13 08:30:00" — actually UTC from Railway datetime.now().
  //    Add T and Z so JS converts UTC→IST correctly.
  let cleaned: string;
  if (/T.*[Zz]$/.test(raw)) {
    // Paypakka ISO format with Z — strip the Z, time is already IST
    cleaned = raw.replace(/[Zz]$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  } else if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    // Local payment — space-separated, no timezone = UTC from Railway
    cleaned = raw.replace(' ', 'T') + 'Z';
  } else if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) {
    // ISO without Z — could be local payment from PG, treat as UTC
    cleaned = raw + 'Z';
  } else {
    cleaned = raw;
  }

  const dt = new Date(cleaned);
  if (isNaN(dt.getTime())) return String(d);
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr}, ${timeStr}`;
}
