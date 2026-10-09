import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'DONDOK_DEV_')
  const apiTarget = env.DONDOK_DEV_API_TARGET || 'http://localhost:8080'
  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['brand/*.svg', 'brand/*.png'],
        manifest: {
          name: '돈독',
          short_name: '돈독',
          description: '함께 기록하고 차곡차곡 모으는 공유 가계부',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/brand/dondok-app-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/brand/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    server: {
      host: true,
      proxy: {
        '/api': apiTarget,
        '/actuator': apiTarget,
      },
    },
  }
})
