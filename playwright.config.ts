import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 70000,
  expect: { timeout: 7000 },
  use: { baseURL: process.env.TEST_URL || 'http://127.0.0.1:4318', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 940 } } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  reporter: [['list'], ['json', { outputFile: 'artifacts/browser-results.json' }]]
});
