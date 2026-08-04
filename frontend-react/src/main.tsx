import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './lib/i18n'

// ── Service Worker self-healing ────────────────────────────────
// Problem: Old SW precaches old index.html which loads old JS.
// Old JS doesn't have the update mechanism, so it's stuck forever.
// Fix: On every load, check if our SW version matches the server's.
// If not, unregister ALL SWs + clear ALL caches, then reload fresh.
//
// This runs BEFORE React mounts, in the main HTML thread (not SW).
// It can't be intercepted by the old SW because it's a JS import,
// not a navigation request.
// Bundled native app (Capacitor): no server origin — skip SW entirely.
const IS_NATIVE = typeof (window as any).Capacitor !== 'undefined';

if ('serviceWorker' in navigator && !IS_NATIVE) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })
      .then((reg) => {
        console.log('SW registered:', reg.scope)
        // If new SW is waiting, force it to activate immediately
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
        // Listen for new SW taking control → reload
        let refreshing = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return
          refreshing = true
          window.location.reload()
        })
      })
      .catch((err) => console.error('SW registration failed:', err))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
