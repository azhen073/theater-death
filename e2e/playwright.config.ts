import { defineConfig, devices } from '@playwright/test';
import { ENV } from './helpers/env.ts';

export default defineConfig({
  testDir: './specs',
  outputDir: './results/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: './results/html', open: 'never' }],
    ['json', { outputFile: './results/results.json' }],
  ],
  use: {
    baseURL: ENV.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            // 容器内浏览器访问 http://app:3000（非 localhost）：放行该源以启用 getUserMedia 与虚拟麦克风
            `--unsafely-treat-insecure-origin-as-secure=${ENV.baseUrl}`,
            // 禁用 HTTPS-First 升级：非 localhost 的 http 导航会被强制试 https 导致 ERR_SSL_PROTOCOL_ERROR
            '--disable-features=HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable,HttpsUpgrades',
          ],
        },
      },
    },
    {
      name: 'webkit',
      // 界面类用例：04 全流程（不含语音）与 05 恢复；冒烟/语音为 Chromium 虚拟麦克风专属
      testMatch: /(04-flow-full|05-resilience)/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
