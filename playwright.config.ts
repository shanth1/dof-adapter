import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 45000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5177', headless: true, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 5177 --strictPort', url: 'http://127.0.0.1:5177', reuseExistingServer: false },
});
