import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  testMatch: 'e2e.spec.mjs',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'python3 -m http.server 4173',
    port: 4173,
    reuseExistingServer: true,
  },
});
