import { describe, it, expect, beforeEach } from 'vitest';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getGlobalLocalStack, TEST_BUCKET_NAME, resetS3ClientForTests } from '../setup-files.ts';
import { getExpectedKey, cleanupS3Prefix } from './helpers.ts';

// Reset S3 client and clean bucket before each test
beforeEach(async () => {
  await resetS3ClientForTests();

  // Clean up all S3 objects for the test network
  const { s3Client } = getGlobalLocalStack();
  const prefix = getExpectedKey('');
  await cleanupS3Prefix(s3Client, prefix);
});

describe('S3 Operations', () => {
  describe('objectExists', () => {
    it('should return true when object exists', async () => {
      const { s3Client } = getGlobalLocalStack();
      const key = getExpectedKey('test/exists.json');

      // Upload a test object
      await s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key,
          Body: JSON.stringify({ test: 'data' }),
        }),
      );

      const { objectExists } = await import('../../src/s3/index.ts');
      const exists = await objectExists(key);

      expect(exists).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      const key = getExpectedKey('test/does-not-exist.json');

      const { objectExists } = await import('../../src/s3/index.ts');
      const exists = await objectExists(key);

      expect(exists).toBe(false);
    });
  });

  describe('listKeysWithPrefix', () => {
    it('should list all keys with the given prefix', async () => {
      const { s3Client } = getGlobalLocalStack();
      const prefix = getExpectedKey('test/list/');

      // Upload multiple test objects
      await Promise.all([
        s3Client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET_NAME,
            Key: `${prefix}file1.json`,
            Body: '{}',
          }),
        ),
        s3Client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET_NAME,
            Key: `${prefix}file2.json`,
            Body: '{}',
          }),
        ),
      ]);

      const { listKeysWithPrefix } = await import('../../src/s3/index.ts');
      const keys = await listKeysWithPrefix(prefix);

      expect(keys.size).toBeGreaterThanOrEqual(2);
      expect(keys.has(`${prefix}file1.json`)).toBe(true);
      expect(keys.has(`${prefix}file2.json`)).toBe(true);
    });

    it('should return empty set when no objects match prefix', async () => {
      const prefix = getExpectedKey('test/empty-prefix/');

      const { listKeysWithPrefix } = await import('../../src/s3/index.ts');
      const keys = await listKeysWithPrefix(prefix);

      expect(keys.size).toBe(0);
    });

    it('should handle large result sets', async () => {
      const { s3Client } = getGlobalLocalStack();
      const prefix = getExpectedKey('test/large-list/');

      // Create a moderate number of files (enough to verify it works, but not too many for test speed)
      const fileCount = 50;
      const uploads = [];
      for (let i = 0; i < fileCount; i++) {
        uploads.push(
          s3Client.send(
            new PutObjectCommand({
              Bucket: TEST_BUCKET_NAME,
              Key: `${prefix}file${i}.json`,
              Body: '{}',
            }),
          ),
        );
      }
      await Promise.all(uploads);

      const { listKeysWithPrefix } = await import('../../src/s3/index.ts');
      const keys = await listKeysWithPrefix(prefix);

      expect(keys.size).toBe(fileCount);
      // Verify a few random keys exist
      expect(keys.has(`${prefix}file0.json`)).toBe(true);
      expect(keys.has(`${prefix}file25.json`)).toBe(true);
      expect(keys.has(`${prefix}file49.json`)).toBe(true);
    });
  });

  describe('getMD5HashForObject', () => {
    it('should return MD5 hash for existing object', async () => {
      const { s3Client } = getGlobalLocalStack();
      const key = getExpectedKey('test/md5-test.json');
      const testData = JSON.stringify({ test: 'md5' });

      // Upload a test object
      await s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key,
          Body: testData,
        }),
      );

      const { getMD5HashForObject } = await import('../../src/s3/index.ts');
      const md5 = await getMD5HashForObject(key);

      expect(md5).toBeDefined();
      expect(typeof md5).toBe('string');
      if (md5) {
        expect(md5.length).toBe(32); // MD5 hash length in hex
      }
    });

    it('should return undefined for non-existent object', async () => {
      const key = getExpectedKey('test/does-not-exist-md5.json');

      const { getMD5HashForObject } = await import('../../src/s3/index.ts');
      const md5 = await getMD5HashForObject(key);

      expect(md5).toBeUndefined();
    });

    it('should remove quotes from ETag value', async () => {
      const { s3Client } = getGlobalLocalStack();
      const key = getExpectedKey('test/etag-quotes.json');
      const testData = 'test content';

      await s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key,
          Body: testData,
        }),
      );

      const { getMD5HashForObject } = await import('../../src/s3/index.ts');
      const md5 = await getMD5HashForObject(key);

      // ETag should not contain quotes
      expect(md5).toBeDefined();
      expect(md5).not.toContain('"');
    });
  });

  describe('uploadData', () => {
    it('should upload data successfully', async () => {
      const key = getExpectedKey('test/upload.json');
      const testData = JSON.stringify({ test: 'upload' });

      const { uploadData } = await import('../../src/s3/index.ts');

      // Verify upload was performed
      const uploaded = await uploadData(key, testData);
      expect(uploaded).toBe(true);

      // Verify the file was uploaded
      const { s3Client } = getGlobalLocalStack();
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key,
        }),
      );

      expect(await response.Body?.transformToString()).toBe(testData);
    });

    it('should skip upload when MD5 matches', async () => {
      const key = getExpectedKey('test/upload-skip.json');
      const testData = JSON.stringify({ test: 'skip' });

      const { uploadData } = await import('../../src/s3/index.ts');

      // First upload
      const firstUploaded = await uploadData(key, testData);
      expect(firstUploaded).toBe(true);

      // Second upload with same data should be skipped
      const secondUploaded = await uploadData(key, testData);
      expect(secondUploaded).toBe(false);

      // Verify the file still exists with original data
      const { s3Client } = getGlobalLocalStack();
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key,
        }),
      );

      const uploadedData = await response.Body?.transformToString();
      expect(uploadedData).toBe(testData);
    });

    it('should force upload when force=true even if MD5 matches', async () => {
      const key = getExpectedKey('test/upload-force.json');
      const testData = JSON.stringify({ test: 'force' });

      const { uploadData } = await import('../../src/s3/index.ts');

      // First upload
      const firstUploadResult = await uploadData(key, testData);
      expect(firstUploadResult).toBe(true);

      // Force upload with same data
      const secondUploadResult = await uploadData(key, testData, true);
      expect(secondUploadResult).toBe(true);

      // Verify the file still exists (upload succeeded)
      const { s3Client } = getGlobalLocalStack();
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key,
        }),
      );

      const uploadedData = await response.Body?.transformToString();
      expect(uploadedData).toBe(testData);
    });
  });

  describe('getKeyWithNetworkMetadata', () => {
    it('should generate correct key with network prefix', async () => {
      const { getKeyWithNetworkMetadata } = await import('../../src/s3/index.ts');

      const key = getKeyWithNetworkMetadata('committee/test.json');
      const expected = getExpectedKey('committee/test.json');

      expect(key).toBe(expected);
    });
  });

  describe('getPublicUrlForObject', () => {
    it('should generate correct public URL', async () => {
      const { getPublicUrlForObject } = await import('../../src/s3/index.ts');

      const url = getPublicUrlForObject('committee/test.json');
      const expectedKey = getExpectedKey('committee/test.json');
      const { publicUrl } = getGlobalLocalStack();

      expect(url).toBe(`${publicUrl}/${expectedKey}`);
    });
  });

  describe('deleteDirectory', () => {
    it('should delete all objects with the given prefix', async () => {
      const { s3Client } = getGlobalLocalStack();
      const prefix = getExpectedKey('test/delete/');

      // Upload multiple test objects
      await Promise.all([
        s3Client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET_NAME,
            Key: `${prefix}file1.json`,
            Body: '{}',
          }),
        ),
        s3Client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET_NAME,
            Key: `${prefix}file2.json`,
            Body: '{}',
          }),
        ),
      ]);

      const { deleteDirectory } = await import('../../src/s3/index.ts');
      await deleteDirectory(prefix);

      // Verify files were deleted
      const { listKeysWithPrefix } = await import('../../src/s3/index.ts');
      const keys = await listKeysWithPrefix(prefix);

      expect(keys.size).toBe(0);
    });

    it('should handle empty directory without errors', async () => {
      const prefix = getExpectedKey('test/empty-delete/');

      const { deleteDirectory } = await import('../../src/s3/index.ts');

      // Should not throw when deleting non-existent prefix
      await expect(deleteDirectory(prefix)).resolves.not.toThrow();
    });
  });
});
