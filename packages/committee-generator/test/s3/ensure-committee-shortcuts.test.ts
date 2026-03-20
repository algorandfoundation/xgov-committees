import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getGlobalLocalStack, TEST_BUCKET_NAME, resetS3ClientForTests } from '../setup-files';
import { createCommitteeFixture, getExpectedKey, cleanupS3Prefix } from './helpers';
import type { Committee } from '../../src/committee';

// In-memory store for committee data (simulates S3) - use vi.hoisted to make it available to mocks
const { committeeStore } = vi.hoisted(() => {
  return {
    committeeStore: new Map<string, Committee>(),
  };
});

// Mock the committee module to avoid algod dependencies
vi.mock('../../src/committee', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../src/committee');

  return {
    ...actual,
    // Mock loadCommittee to return data from our in-memory store
    loadCommittee: vi.fn(async (fromRound: number, toRound: number, _from?: 'local' | 's3') => {
      const key = `${fromRound}-${toRound}`;
      const data = committeeStore.get(key);
      return data;
    }),
    // Keep the real getCommitteeID implementation for accurate testing
    getCommitteeID: actual.getCommitteeID,
  };
});

// Reset S3 client and clean bucket before each test
beforeEach(async () => {
  await resetS3ClientForTests();
  committeeStore.clear();

  // Clean up all S3 objects for the test network
  const { s3Client } = getGlobalLocalStack();
  const prefix = getExpectedKey('');
  await cleanupS3Prefix(s3Client, prefix);
});

describe('ensureCommitteeShortcuts', () => {
  it('should create both shortcuts when neither exists', async () => {
    const { s3Client } = getGlobalLocalStack();

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

    // Should have 4 files: original + 2 shortcuts (by round and by ID) + index.json
    expect(keys).toHaveLength(4);
    expect(keys).toContain(committeeKey);

    // Verify shortcut by period end round exists
    const endRoundKey = getExpectedKey('committee/58000000.json');
    expect(keys).toContain(endRoundKey);

    // Verify index.json exists
    const indexKey = getExpectedKey('committee/index.json');
    expect(keys).toContain(indexKey);

    // Verify shortcut by committee ID exists (it should be some hash)
    const committeeIDKeys = keys.filter(
      (k) => k !== committeeKey && k !== endRoundKey && k !== indexKey && k?.includes('committee/'),
    );
    expect(committeeIDKeys).toHaveLength(1);
  });

  it('should skip creation when both shortcuts already exist', async () => {
    const { s3Client } = getGlobalLocalStack();

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

    // List all objects - should still be 4 (no duplicates, includes index.json)
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey('committee/'),
      }),
    );

    expect(listResult.Contents).toHaveLength(4);
  });

  it('should create only missing shortcut when one exists', async () => {
    const { s3Client } = getGlobalLocalStack();

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

    // List all objects - should now be 4 (original + both shortcuts + index.json)
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET_NAME,
        Prefix: getExpectedKey('committee/'),
      }),
    );

    expect(listResult.Contents).toHaveLength(4);
  });

  it('should generate index.json with correct structure and data', async () => {
    const { s3Client } = getGlobalLocalStack();

    // Create 2 committees with different data
    const committee1 = createCommitteeFixture(55000000, 58000000);
    const committee2 = createCommitteeFixture(55005000, 58005000);

    committeeStore.set('55000000-58000000', committee1);
    committeeStore.set('55005000-58005000', committee2);

    // Upload committee files to S3
    const key1 = getExpectedKey('committee/55000000-58000000.json');
    const key2 = getExpectedKey('committee/55005000-58005000.json');

    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key1,
          Body: JSON.stringify(committee1),
        }),
      ),
      s3Client.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET_NAME,
          Key: key2,
          Body: JSON.stringify(committee2),
        }),
      ),
    ]);

    // Run the function
    const { ensureCommitteeShortcuts } = await import('../../src/s3');
    await ensureCommitteeShortcuts();

    // Fetch index.json
    const indexKey = getExpectedKey('committee/index.json');
    const getResult = await s3Client.send(
      new GetObjectCommand({
        Bucket: TEST_BUCKET_NAME,
        Key: indexKey,
      }),
    );

    // Parse the JSON
    const body = await getResult.Body?.transformToString();
    if (!body) {
      throw new Error(`Expected S3 object body for key "${indexKey}", but got none`);
    }
    const index = JSON.parse(body);

    // Validate structure
    expect(index).toHaveProperty('committees');
    expect(index).toHaveProperty('lastUpdated');
    expect(index).toHaveProperty('totalCommittees');
    expect(typeof index.committees).toBe('object');
    expect(Array.isArray(index.committees)).toBe(false); // Should be object, not array

    // Validate committees object is keyed by toRound
    const committeeKeys = Object.keys(index.committees);
    expect(committeeKeys).toContain('58000000');
    expect(committeeKeys).toContain('58005000');
    expect(committeeKeys).toHaveLength(2);

    // Validate sorting order (by toRound ascending)
    const sortedKeys = committeeKeys.map(Number).sort((a, b) => a - b);
    expect(committeeKeys.map(Number)).toEqual(sortedKeys);

    // Validate first committee entry
    const entry1 = index.committees['58000000'];
    expect(entry1.fromRound).toBe(55000000);
    expect(entry1.toRound).toBe(58000000);
    expect(entry1.totalMembers).toBe(committee1.totalMembers);
    expect(entry1.totalVotes).toBe(committee1.totalVotes);
    expect(typeof entry1.committeeId).toBe('string');
    expect(entry1.committeeId.length).toBeGreaterThan(0);

    // Validate second committee entry
    const entry2 = index.committees['58005000'];
    expect(entry2.fromRound).toBe(55005000);
    expect(entry2.toRound).toBe(58005000);
    expect(entry2.totalMembers).toBe(committee2.totalMembers);
    expect(entry2.totalVotes).toBe(committee2.totalVotes);
    expect(typeof entry2.committeeId).toBe('string');

    // Validate metadata
    expect(index.totalCommittees).toBe(2);
    expect(new Date(index.lastUpdated).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
