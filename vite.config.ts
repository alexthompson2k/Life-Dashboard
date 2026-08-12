import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': swapping the bundle underneath
      // someone mid-edit is worse than asking. The banner is in PwaStatus.tsx.
      registerType: 'prompt',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Life Dashboard',
        short_name: 'Dashboard',
        description:
          'Money, tasks, weather, news, fitness and habits — one page for the day.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#fcfcfb',
        theme_color: '#2a78d6',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: "Today's tasks", url: '/tasks', short_name: 'Tasks' },
          { name: 'Log a workout', url: '/fitness', short_name: 'Fitness' },
          { name: 'Financials', url: '/financials', short_name: 'Money' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // SPA routing: unknown paths serve the shell, but never swallow /api.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Push and notification-click handling lives in its own plain script
        // so the rest of the service worker stays generated.
        importScripts: ['/push-sw.js'],
        runtimeCaching: [
          {
            // Weather is cheap to refetch and fine slightly stale.
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'weather',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/geocoding-api\.open-meteo\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'geocoding',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\/news.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'news',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /*
             * Supabase reads: NetworkFirst, so a live result always wins and
             * the cache is only a fallback when offline. Never
             * StaleWhileRevalidate here — showing a stale account balance as
             * if it were current is worse than showing nothing.
             *
             * Writes are untouched: Workbox routes are GET-only by default,
             * so POST/PATCH/DELETE go straight to the network and fail loudly
             * when offline rather than appearing to succeed.
             */
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/,
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-reads',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Keep the service worker out of the way during development.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        // Recharts and Supabase dominate the bundle and change rarely; keeping
        // them in their own chunks means app edits do not bust their cache.
        manualChunks: {
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The API server holds Plaid secrets and proxies news feeds (CORS).
      '/api': {
        target: process.env.API_ORIGIN || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
