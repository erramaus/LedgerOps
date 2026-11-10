import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 'render' mode is served by Express at the site root; every other mode targets GitHub Pages.
export default defineConfig(({ command, mode }) => {
  process.env.NODE_ENV ||= command === 'build' ? 'production' : 'development'

  return {
    base: mode === 'render' ? '/' : '/LedgerOps/',
    plugins: [react()],
    // Keep Render and E2E API calls same-origin regardless of any .env files.
    define: mode === 'render' || mode === 'e2e' ? { 'import.meta.env.VITE_API_BASE_URL': '""' } : {},
    server: {
      ...(mode === 'e2e' ? { hmr: false } : {}),
      proxy: {
        '/api': 'http://127.0.0.1:3001',
      },
    },
  }
})
