// Native detection + URL helpers for the bundled Android app (Capacitor).
// Web serves under /app/* with BrowserRouter; the native WebView uses
// hash routing (#/...) so absolute navigations must be hash-aware.
export const IS_NATIVE = typeof (window as any).Capacitor !== 'undefined';

/** Absolute URL for an app route — works in both web and native. */
export function appUrl(path: string): string {
  return IS_NATIVE ? `#${path}` : `/app${path}`;
}

/** In-app route path for React Router <Link>/<Navigate> — basename handles web. */
export function appRoute(path: string): string {
  return path;
}
