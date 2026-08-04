import { createContext, useContext, useEffect, useState } from 'react';
import { TA } from './ta';

// ── Lightweight i18n: English-as-key + Tamil dictionary ────────────────────
// t('Save') → Tamil (TA[key]) if available, else the English string itself.
// Persisted in localStorage; default English (auto-detect ta browser).

export type Lang = 'en' | 'ta';

export type Vars = Record<string, string | number | undefined>;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string, vars?: Vars) => string;
}

const Ctx = createContext<I18nCtx>({
  lang: 'en',
  setLang: () => {},
  toggle: () => {},
  t: (k) => k,
});

export function translate(key: string, vars?: Vars): string {
  let out = TA[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(String(v));
    }
  }
  return out;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('wasool_lang');
      if (saved === 'ta' || saved === 'en') return saved;
      return navigator.language?.toLowerCase().startsWith('ta') ? 'ta' : 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    try { localStorage.setItem('wasool_lang', lang); } catch { /* ignore */ }
    document.documentElement.lang = lang === 'ta' ? 'ta' : 'en';
  }, [lang]);

  const t = (key: string, vars?: Vars) =>
    lang === 'ta' ? translate(key, vars) : vars
      ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v ?? '')), key)
      : key;

  return (
    <Ctx.Provider value={{ lang, setLang, toggle: () => setLang(lang === 'ta' ? 'en' : 'ta'), t }}>
      {children}
    </Ctx.Provider>
  );
}

export function useT() {
  return useContext(Ctx);
}
