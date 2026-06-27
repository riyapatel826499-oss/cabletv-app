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

  // Handle PostgreSQL timestamps with microseconds + timezone:
  // "2026-06-22 15:50:58.284466+00" → strip microseconds + tz, treat as IST
  let cleaned: string;
  const pgMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\.?\d*(?:[+-]\d{2}(?::?\d{2})?|Z)?$/);
  if (pgMatch) {
    // PostgreSQL timestamp — format to "YYYY-MM-DD HH:MM:SS" (already IST from NOW())
    cleaned = pgMatch[1] + 'T' + pgMatch[2];
  } else if (/T.*[Zz]$/.test(raw)) {
    // Paypakka ISO format with Z — strip the Z, time is already IST
    cleaned = raw.replace(/[Zz]$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  } else if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    // Local payment — space-separated, already IST from backend datetime.now(ist)
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
