import { defineConfig } from '@playwright/test'

// Uses the Edge/Chrome already on the machine; set PW_CHANNEL=chrome to switch.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199/LedgerOps/',
    channel: process.env.PW_CHANNEL || 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --mode e2e --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199/LedgerOps/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
