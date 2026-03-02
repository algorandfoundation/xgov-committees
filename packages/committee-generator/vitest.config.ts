import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120_000, // 2 minutes for LocalStack startup
    hookTimeout: 120_000,
    setupFiles: ['./test/setup-global.ts'],
  },
});
