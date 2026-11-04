import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 'render' mode is served by Express at the site root; every other mode targets GitHub Pages.
export default defineConfig(({ mode }) => ({
  base: mode === 'render' ? '/' : '/LedgerOps/',
  plugins: [react()],
  // Force same-origin API calls in the Render bundle regardless of any .env files.
  define: mode === 'render' ? { 'import.meta.env.VITE_API_BASE_URL': '""' } : {},
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
}))
