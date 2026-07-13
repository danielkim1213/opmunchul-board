import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Avoid browser CORS restrictions by proxying OverFast API calls in dev
      '/overfast': {
        target: 'https://overfast-api.tekrop.fr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/overfast/, ''),
      },
    },
  },
})
