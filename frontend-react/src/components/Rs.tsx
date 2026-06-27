import { IndianRupee } from 'lucide-react';

/**
 * Rupee symbol + formatted amount.
 * Uses lucide IndianRupee SVG icon instead of Unicode ₹
 * to ensure consistent rendering across all devices/fonts.
 *
 * The `bare` prop returns the amount WITHOUT the symbol (for CSV/template use).
 */
export function Rs({
  amount,
  iconStyle,
  bare = false,
}: {
  amount: number | string | null | undefined;
  iconStyle?: React.CSSProperties;
  bare?: boolean;
}) {
  const v = Number(amount || 0);
  const formatted = v.toLocaleString('en-IN');
  if (bare) return <>{formatted}</>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.05em' }}>
      <IndianRupee style={{ width: '0.82em', height: '0.82em', flexShrink: 0, ...iconStyle }} />
      {formatted}
    </span>
  );
}

export default Rs;
