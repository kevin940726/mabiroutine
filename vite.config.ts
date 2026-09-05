import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Build stamp for the "已更新到新版本" toast (compared in App on boot).
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // generateSW default: navigations serve the precached shell first,
      // then skipWaiting + clientsClaim + autoUpdate take over and reload to
      // the fresh build within seconds (self-healing, no user action).
      // Hand-written NetworkFirst SW was evaluated and dropped — same offline
      // behavior, less owned code; the only delta is one briefly-stale render
      // on the very first load after a deploy.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false, // hand-owned public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico}'],
        globIgnores: ['**/npc-raw/**'], // source art, never requested at runtime
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Hashed build assets: cache-first. Safe by construction — a new
            // build mints new filenames, so stale entries are unreachable.
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'hashed-assets' },
          },
          {
            // NPC art: big, immutable-ish — instant render, refresh behind.
            urlPattern: ({ url }) => url.pathname.startsWith('/npc/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'npc',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      // SW disabled in dev (dev:api serves API routes; app shell stays live).
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
})
