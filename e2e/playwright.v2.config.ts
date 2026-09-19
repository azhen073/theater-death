import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs-v2', outputDir: process.env.FRONTEND_ARTIFACT_DIR ?? '/results/artifacts',
  fullyParallel: false, workers: 1, retries: 0, timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: process.env.FRONTEND_REPORT_FILE ?? '/results/results.json' }]],
  use: {
    baseURL: process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173', locale: 'zh-CN',
    actionTimeout: 15_000, navigationTimeout: 25_000,
    // Authentication forms contain disposable credentials; never persist their traces.
    trace: 'off', screenshot: 'off', video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } } },
  ],
});
