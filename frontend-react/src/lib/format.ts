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
  // DB timestamps may have 'Z' suffix (marked UTC) but are actually local IST.
  // Strip timezone markers to prevent browser from adding offset.
  const cleaned = String(d).replace(/[Zz]$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  const dt = new Date(cleaned);
  if (isNaN(dt.getTime())) return String(d);
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr}, ${timeStr}`;
}
