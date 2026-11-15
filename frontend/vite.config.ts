import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxy = {
  '/api': process.env.ASTROTWIN_DEV_API_URL?.trim() || 'http://127.0.0.1:8000',
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy,
    watch: {
      usePolling: true,
    },
  },
  preview: { proxy },
})
