import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './spike',
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5174',
  },
});
