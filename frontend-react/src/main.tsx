import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Register service worker IMMEDIATELY at app entry — before React even mounts.
// Chrome requires an active SW to fire beforeinstallprompt (PWA install prompt).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })
      .then((reg) => console.log('SW registered:', reg.scope))
      .catch((err) => console.error('SW registration failed:', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
