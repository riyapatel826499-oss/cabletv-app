import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  // Web: served under /app so the React app coexists with the legacy vanilla-JS app
  // (which keeps the root, /login, /dashboard). Assets emit under /app/.
  // Native (Capacitor APK): relative './' base — the WebView serves from
  // https://localhost/ where '/app/' does not exist (white screen without this).
  base: process.env.VITE_NATIVE ? './' : '/app/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        id: '/app/',
        name: 'Wasool — Cable TV Management',
        short_name: 'Wasool',
        description: 'Cable TV customer management, payments & collections',
        theme_color: '#0071e3',
        background_color: '#f5f5f7',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/app/',
        start_url: '/app/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Force immediate activation — don't wait for old SW to release
        skipWaiting: true,
        clientsClaim: true,
        // Cache app shell for offline use
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Don't cache API calls — always hit network for fresh data
        navigateFallbackDenylist: [/^\/api\//],
        // Purge old caches on activation
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Web build → backend/static (Railway serves under /app).
    // Native build (VITE_NATIVE=1) → ../capacitor-www, synced into the APK
    // by `npx cap sync android`. Kept separate so the web bundle is untouched.
    outDir: process.env.VITE_NATIVE ? '../capacitor-www' : '../backend/static',
    emptyOutDir: true,
  },
})
