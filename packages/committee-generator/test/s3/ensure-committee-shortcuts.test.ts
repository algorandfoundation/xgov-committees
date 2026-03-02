import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { startLocalStack, stopLocalStack, getTestS3Client, TEST_BUCKET_NAME } from './setup';
import { createCommitteeFixture, getExpectedKey, cleanupS3Prefix } from './helpers';
import type { Committee } from '../../src/committee';

// Mock the committee module to avoid algod dependencies
vi.mock('../../src/committee', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../src/committee');
  return {
    ...actual,
    // Mock loadCommittee to return data from our in-memory store
    loadCommittee: vi.fn(async (fromRound: number, toRound: number) => {
      const key = `${fromRound}-${toRound}`;
      return committeeStore.get(key);
    }),
    // Keep the real getCommitteeID implementation for accurate testing
    getCommitteeID: actual.getCommitteeID,
  };
});

// In-memory store for committee data (simulates S3)
const committeeStore = new Map<string, Committee>();

// Setup LocalStack before all tests
let localStackEndpoint: string;
let localStackPublicUrl: string;

beforeAll(async () => {
  const { endpoint, publicUrl } = await startLocalStack();
  localStackEndpoint = endpoint;
  localStackPublicUrl = publicUrl;

  // Update environment variables for the config to pick up
  process.env.S3_ENDPOINT = localStackEndpoint;
  process.env.S3_PUBLIC_URL = localStackPublicUrl;
}, 120_000);

afterAll(async () => {
  await stopLocalStack();
});

// Reset before each test
beforeEach(async () => {
  const { resetS3Client } = await import('../../src/s3');
  resetS3Client();
  committeeStore.clear();
});

// Clean up after each test
afterEach(async () => {
  const s3Client = getTestS3Client();
  const prefix = getExpectedKey('committee/');
  await cleanupS3Prefix(s3Client, prefix);
});

describe('ensureCommitteeShortcuts', () => {
  it('should create both shortcuts when neither exists', async () => {
    const s3Client = getTestS3Client();

    // Create committee data and add to store
    const committeeData = createCommitteeFixture(55000000, 58000000);
    committeeStore.set('55000000-58000000', committeeData);

    // Upload committee file to S3
    const committeeKey = getExpectedKey('committee/55000000-58000000.json');
    await s3Client.send(
      new PutObjectCommand({
        Bucket: TEST_BUCKET_NAME,
        Key: committeeKey,
        Body: JSON.stringify(committeeData),
      }),
    );

    // Run the function
    const { ensureCommitteeShortcuts } = await import('../../src/s3');
    await ensureCommitteeShortcuts();

    // List all objects to verify shortcuts were created
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey('committee/'),
      }),
    );

    const keys = listResult.Contents?.map((obj) => obj.Key) || [];

    // Should have 3 files: original + 2 shortcuts (by round and by ID)
    expect(keys).toHaveLength(3);
    expect(keys).toContain(committeeKey);

    // Verify shortcut by period end round exists
    const endRoundKey = getExpectedKey('committee/58000000.json');
    expect(keys).toContain(endRoundKey);

    // Verify shortcut by committee ID exists (it should be some hash)
    const committeeIDKeys = keys.filter(
      (k) => k !== committeeKey && k !== endRoundKey && k?.includes('committee/'),
    );
    expect(committeeIDKeys).toHaveLength(1);
  });

  it('should skip creation when both shortcuts already exist', async () => {
    const s3Client = getTestS3Client();

    // Create committee data and add to store
    const committeeData = createCommitteeFixture(55005000, 58005000);
    committeeStore.set('55005000-58005000', committeeData);

    const committeeKey = getExpectedKey('committee/55005000-58005000.json');
    const endRoundKey = getExpectedKey('committee/58005000.json');

    // Get the committee ID to create the ID-based shortcut
    const { getCommitteeID } = await import('../../src/committee');
    const { committeeIdToSafeFileName } = await import('../../src/utils');
    const committeeID = getCommitteeID(committeeData);
    const safeCommitteeID = committeeIdToSafeFileName(Buffer.from(committeeID, 'base64'));
    const committeeIDKey = getExpectedKey(`committee/${safeCommitteeID}.json`);

    // Upload all three files (original + both shortcuts)
    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: committeeKey,
          Body: JSON.stringify(committeeData),
        }),
      ),
      s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: endRoundKey,
          Body: JSON.stringify(committeeData),
        }),
      ),
      s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: committeeIDKey,
          Body: JSON.stringify(committeeData),
        }),
      ),
    ]);

    // Run the function
    const { ensureCommitteeShortcuts } = await import('../../src/s3');
    await ensureCommitteeShortcuts();

    // List all objects - should still be 3 (no duplicates)
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey('committee/'),
      }),
    );

    expect(listResult.Contents).toHaveLength(3);
  });

  it('should create only missing shortcut when one exists', async () => {
    const s3Client = getTestS3Client();

    // Create committee data and add to store
    const committeeData = createCommitteeFixture(55010000, 58010000);
    committeeStore.set('55010000-58010000', committeeData);

    const committeeKey = getExpectedKey('committee/55010000-58010000.json');
    const endRoundKey = getExpectedKey('committee/58010000.json');

    // Upload original and only the end-round shortcut
    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: committeeKey,
          Body: JSON.stringify(committeeData),
        }),
      ),
      s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: endRoundKey,
          Body: JSON.stringify(committeeData),
        }),
      ),
    ]);

    // Run the function
    const { ensureCommitteeShortcuts } = await import('../../src/s3');
    await ensureCommitteeShortcuts();

    // List all objects - should now be 3 (original + both shortcuts)
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey('committee/'),
      }),
    );

    expect(listResult.Contents).toHaveLength(3);
  });
});
