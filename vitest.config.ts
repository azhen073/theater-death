import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // CI 构建机（共享 runner）上个别用例（scrypt 注册流程等）会超过默认 5s；放宽上限，不影响断言
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
