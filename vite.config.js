import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward /api/gss/* to the Grand Slam Systems API during local dev.
      // In production, Vercel's api/gss/[...path].js handler serves this.
      '/api/gss': {
        target: 'https://app.grandslamsystems.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gss/, '/api'),
      },
    },
  },
})
