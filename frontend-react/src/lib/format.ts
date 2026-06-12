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
