import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getGlobalLocalStack, TEST_BUCKET_NAME, resetS3ClientForTests } from '../setup-files.ts';
import { getExpectedKey, cleanupS3Prefix } from './helpers.ts';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let tempDir: string | null = null;

// Create temp directory and clean S3 before each test
beforeEach(async () => {
  await resetS3ClientForTests();

  // Clean up all S3 objects for the test network
  const { s3Client } = getGlobalLocalStack();
  const prefix = getExpectedKey('');
  await cleanupS3Prefix(s3Client, prefix);

  // Create a temporary directory for test files
  tempDir = await mkdtemp(join(tmpdir(), 'xgov-s3-test-'));
});

// Clean up after each test
afterEach(async () => {
  // Clean up temp directory
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('syncDirectory', () => {
  it('should upload new files from directory', async () => {
    if (!tempDir) throw new Error('Temp directory not created');

    // Create test files
    await writeFile(join(tempDir, 'file1.json'), JSON.stringify({ test: 1 }));
    await writeFile(join(tempDir, 'file2.json'), JSON.stringify({ test: 2 }));

    const { syncDirectory } = await import('../../src/s3/index.ts');
    await syncDirectory(tempDir);

    // List all objects
    const { s3Client } = getGlobalLocalStack();
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey(''),
      }),
    );

    const keys = listResult.Contents?.map((obj) => obj.Key) || [];
    expect(keys).toContain(getExpectedKey('file1.json'));
    expect(keys).toContain(getExpectedKey('file2.json'));
  });

  it('should skip files that already exist in S3', async () => {
    if (!tempDir) throw new Error('Temp directory not created');

    // Create test files
    await writeFile(join(tempDir, 'existing.json'), JSON.stringify({ test: 'existing' }));
    await writeFile(join(tempDir, 'new.json'), JSON.stringify({ test: 'new' }));

    const { syncDirectory } = await import('../../src/s3/index.ts');

    // First sync - uploads both files
    await syncDirectory(tempDir);

    // Verify both files uploaded
    const { s3Client } = getGlobalLocalStack();
    let listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey(''),
      }),
    );

    expect(listResult.Contents).toHaveLength(2);

    // Create a different new file (keeping existing files)
    await writeFile(join(tempDir, 'another.json'), JSON.stringify({ test: 'another' }));

    // Second sync - should skip existing.json and new.json, upload only another.json
    await syncDirectory(tempDir);

    // Verify all three files present (existing ones skipped, new one added)
    listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey(''),
      }),
    );

    const keys = listResult.Contents?.map((obj) => obj.Key) || [];
    expect(keys).toHaveLength(3);
    expect(keys).toContain(getExpectedKey('existing.json'));
    expect(keys).toContain(getExpectedKey('new.json'));
    expect(keys).toContain(getExpectedKey('another.json'));
  });

  it('should handle nested directory structures', async () => {
    if (!tempDir) throw new Error('Temp directory not created');

    // Create nested directory structure
    await mkdir(join(tempDir, 'subdir1'), { recursive: true });
    await mkdir(join(tempDir, 'subdir2', 'nested'), { recursive: true });

    await writeFile(join(tempDir, 'root.json'), JSON.stringify({ level: 'root' }));
    await writeFile(join(tempDir, 'subdir1', 'file1.json'), JSON.stringify({ level: 1 }));
    await writeFile(join(tempDir, 'subdir2', 'file2.json'), JSON.stringify({ level: 2 }));
    await writeFile(join(tempDir, 'subdir2', 'nested', 'deep.json'), JSON.stringify({ level: 3 }));

    const { syncDirectory } = await import('../../src/s3/index.ts');
    await syncDirectory(tempDir);

    // Verify all files uploaded with correct paths
    const { s3Client } = getGlobalLocalStack();
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey(''),
      }),
    );

    const keys = listResult.Contents?.map((obj) => obj.Key) || [];
    expect(keys).toContain(getExpectedKey('root.json'));
    expect(keys).toContain(getExpectedKey('subdir1/file1.json'));
    expect(keys).toContain(getExpectedKey('subdir2/file2.json'));
    expect(keys).toContain(getExpectedKey('subdir2/nested/deep.json'));
  });

  it('should handle empty directory without errors', async () => {
    if (!tempDir) throw new Error('Temp directory not created');

    // Don't create any files - directory is empty
    const { syncDirectory } = await import('../../src/s3/index.ts');

    // Should not throw
    await syncDirectory(tempDir);

    // Verify no files uploaded
    const { s3Client } = getGlobalLocalStack();
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey(''),
      }),
    );

    expect(listResult.Contents || []).toHaveLength(0);
  });

  it('should upload multiple files concurrently', async () => {
    if (!tempDir) throw new Error('Temp directory not created');

    // Create many files to test concurrency
    const fileCount = 10;
    const promises = [];
    for (let i = 0; i < fileCount; i++) {
      promises.push(writeFile(join(tempDir, `file${i}.json`), JSON.stringify({ index: i })));
    }
    await Promise.all(promises);

    const { syncDirectory } = await import('../../src/s3/index.ts');
    await syncDirectory(tempDir);

    // Verify all files uploaded
    const { s3Client } = getGlobalLocalStack();
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey(''),
      }),
    );

    expect(listResult.Contents).toHaveLength(fileCount);

    // Verify each file was uploaded correctly
    for (let i = 0; i < fileCount; i++) {
      const key = getExpectedKey(`file${i}.json`);
      const keys = listResult.Contents?.map((obj) => obj.Key) || [];
      expect(keys).toContain(key);
    }
  });
});
