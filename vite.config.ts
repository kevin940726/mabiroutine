import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Silent-fresh: navigations grab from the network (NetworkFirst +
      // preload), so every online load IS the latest build — nothing flashes,
      // nothing reloads, nothing toasts. SW updates only refresh caches in
      // the background (prompt mode acknowledged silently, no reload).
      // Offline loads fall back to cache via navigateFallback.
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: false, // hand-owned public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico}'],
        // index.html excluded on purpose (with npc-raw source art), and the
        // fallback disabled below: TWO generateSW defaults would otherwise
        // shadow the NetworkFirst navigate route and pin every load to the
        // active SW's shell (proven by E2E: reload-after-deploy rendered the
        // old rev) — (1) a navigateFallback NavigationRoute registers before
        // runtime routes, and (2) the precache route maps "/" → precached
        // index.html via its directoryIndex default. Worse, (1) with (2)
        // removed throws at SW startup (createHandlerBoundToURL on a
        // non-precached URL), killing every route after it. navigateFallback
        // must be "" (not omitted: the plugin defaults it back to
        // index.html; not undefined: a ??-merge would resurrect the default).
        // Without both, "/" falls through to NetworkFirst. Offline
        // navigations fall back to the runtime 'pages' cache (populated on
        // every online visit) — only a first-visit-while-offline has nothing
        // to show.
        globIgnores: ['**/npc-raw/**', 'index.html'],
        navigateFallback: "",
        navigationPreload: true, // fetch starts during SW boot, hides the RTT
        // Prompt mode owns activation timing (updateSW(false) on waiting):
        // in-SW skipWaiting would race workbox-window's 200ms
        // waiting-detection, making the armed absence-reload flaky (waiting
        // sometimes never fires). With false, updates park in waiting
        // deterministically until we ack them — silently, or with a reload
        // when a long-absence return armed one.
        skipWaiting: false,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // HTML navigations: network first (4s timeout → cache), so a
            // deploy renders fresh on next load instead of stale-then-reload.
            // fetchOptions reload: revalidate even when host/CDN headers
            // would allow a cached copy (304 when unchanged, so ~free).
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pages', networkTimeoutSeconds: 4, fetchOptions: { cache: "reload" } },
          },
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
