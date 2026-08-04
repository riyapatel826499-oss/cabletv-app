import { useT } from '../lib/i18n';

/** Compact EN / தமிழ் pill toggle — reused across admin header, portal, login. */
export default function LangToggle({ dark = false }: { dark?: boolean }) {
  const { lang, toggle } = useT();
  const on = lang === 'ta';
  return (
    <button
      onClick={toggle}
      title={on ? 'Switch to English' : 'தமிழுக்கு மாற்று'}
      aria-label="Language"
      style={{
        border: '1.5px solid var(--border)',
        background: on ? '#0071e3' : 'transparent',
        color: on ? '#fff' : dark ? '#f5f5f7' : 'var(--text)',
        borderRadius: 999,
        padding: '4px 12px',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        transition: 'all 0.15s',
      }}
    >
      {on ? 'தமிழ்' : 'EN'}
    </button>
  );
}
