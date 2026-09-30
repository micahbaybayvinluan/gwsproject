import { defineConfig } from '@playwright/test';

/** Smoke test for the daily close (§3 Tests). CI starts the API (built) and the Vite preview server. */
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  // PLAYWRIGHT_CHROMIUM_PATH lets CI / containers reuse a pre-installed Chromium instead of downloading one.
  use: { baseURL: 'http://localhost:5173', viewport: { width: 390, height: 844 }, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {} }, // phone-sized
  webServer: [
    { command: 'cd ../api && node dist/main.js', port: 4000, reuseExistingServer: true, env: { PORT: '4000', DISABLE_JOBS: 'true', CORS_ORIGIN: 'http://localhost:5173' }, timeout: 120000 },
    { command: 'npx vite preview --port 5173 --strictPort', port: 5173, reuseExistingServer: true, env: { VITE_API_URL: 'http://localhost:4000' }, timeout: 120000 },
  ],
});
