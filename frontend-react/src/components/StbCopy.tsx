import { useState } from 'react';

/**
 * STB number badge with click-to-copy functionality.
 * Usage: <StbCopy stb="3381298100" />
 * Or:   <StbCopy stb={c.stb_no} small />
 */
export default function StbCopy({ 
  stb, 
  small = false, 
  prefix = 'STB: '
}: { 
  stb?: string | null; 
  small?: boolean;
  prefix?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!stb) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(stb).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = stb;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const fontSize = small ? '0.68rem' : '0.72rem';

  return (
    <span
      onClick={handleCopy}
      style={{
        fontFamily: 'monospace',
        fontSize,
        fontWeight: 600,
        background: copied ? '#34c75915' : 'var(--bg-secondary, #f0f0f3)',
        color: copied ? '#34c759' : 'var(--text-light)',
        padding: '2px 8px',
        borderRadius: 6,
        border: copied ? '1px solid #34c75940' : '1px solid var(--border)',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'all 0.15s',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        touchAction: 'manipulation',
      }}
      title="Tap to copy"
    >
      {prefix && <span style={{ opacity: 0.6 }}>{prefix}</span>}
      {stb}
      {copied && '✓'}
    </span>
  );
}
