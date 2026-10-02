import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
// `npm run dev` runs no Netlify functions. If DEV_API_ORIGIN (e.g. https://my-site.netlify.app) is set
// in .env, /api/google-token is proxied to the deployed function so Google Calendar works locally.
const devApiOrigin = loadEnv(mode, process.cwd(), '').DEV_API_ORIGIN?.replace(/\/$/, '')
return {
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: 'Habits — Daily Tracker & Weekly Planner',
        short_name: 'Habits',
        description: 'Track habits, reflect daily, and plan your week.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Dev-only stand-in for netlify/functions/kronan.ts (the Krónan API has no CORS headers).
    proxy: {
      '/api/kronan': {
        target: 'https://api.kronan.is',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/kronan\/?/, '/api/v1/'),
      },
      ...(devApiOrigin ? { '/api/google-token': { target: devApiOrigin, changeOrigin: true } } : {}),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'motion'
          if (id.includes('@dnd-kit')) return 'dnd'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
          return 'vendor'
        },
      },
    },
  },
}
})
