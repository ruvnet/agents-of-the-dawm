import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // CI runners have 2 cores; SwiftShader browsers are CPU-bound, so run one at a time with more headroom.
  timeout: process.env.CI ? 480_000 : 180_000,
  retries: 0,
  // SwiftShader browsers are CPU-bound; 16 parallel instances made real-time input tests flaky (VR9).
  workers: process.env.CI ? 1 : 4,
  reporter: [['list'], ['json', { outputFile: 'reports/e2e-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
