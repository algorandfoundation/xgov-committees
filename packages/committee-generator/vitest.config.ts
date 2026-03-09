import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 120_000, // 2 minutes for LocalStack startup
    hookTimeout: 120_000,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-files.ts'],
    fileParallelism: false, // Run test files sequentially because tests share a single LocalStack S3
    // instance; parallel execution can cause bucket/state conflicts (e.g., concurrent
    // creation/deletion of the same buckets).
  },
});
