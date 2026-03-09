import { vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';

/**
 * Test constants shared across all test files
 */
export const TEST_BUCKET_NAME = 'test-xgov-committees';
export const TEST_REGION = 'us-east-1';

export const TEST_NETWORK_METADATA = {
  genesisID: 'mainnet-v1.0',
  genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
};

const CONFIG_FILE = resolve(__dirname, '.localstack-config.json');

// Track cached values
let cachedEndpoint = '';
let cachedPublicUrl = '';
let cachedS3Client: S3Client | null = null;

// Initialize from global setup config file
function initializeFromConfigFile() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    cachedEndpoint = config.endpoint;
    cachedPublicUrl = `${cachedEndpoint}/${TEST_BUCKET_NAME}`;
    console.log(`[setupFiles] Initialized from config file: endpoint=${cachedEndpoint}`);
  } catch (error) {
    console.error(`[setupFiles] Failed to read config file at "${CONFIG_FILE}":`, error);
    throw new Error(`LocalStack not initialized - config file unavailable at "${CONFIG_FILE}"`, {
      cause: error,
    });
  }
}

// Initialize on module load
initializeFromConfigFile();

function getOrCreateS3Client(): S3Client {
  if (!cachedS3Client) {
    if (!cachedEndpoint) {
      throw new Error('LocalStack not initialized - endpoint unavailable');
    }
    cachedS3Client = new S3Client({
      endpoint: cachedEndpoint,
      region: TEST_REGION,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
      forcePathStyle: true,
    });
  }
  return cachedS3Client;
}

// Create bucket in S3 in beforeAll hook (before any tests run)
beforeAll(async () => {
  try {
    const s3Client = getOrCreateS3Client();
    await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET_NAME }));
    console.log('[setupFiles beforeAll] Bucket created/verified');
  } catch (error: any) {
    // Bucket might already exist, which is OK
    if (error.name !== 'BucketAlreadyExists' && error.name !== 'BucketAlreadyOwnedByYou') {
      console.warn('[setupFiles beforeAll] Bucket creation warning:', error.message);
    }
  }
});

// Setup config mock with cached endpoint
vi.mock('../src/config', () => ({
  config: {
    cacheMode: 'write-cache' as const,
    registryAppId: 3147789458,
    fromBlock: 0,
    toBlock: 0,
    algodServer: 'http://localhost',
    algodPort: 4001,
    algodToken: '',
    dataPath: 'data/',
    concurrency: 10,
    verbose: false,
    get s3() {
      const endpoint = cachedEndpoint || 'http://localhost:4566';
      const bucketName = TEST_BUCKET_NAME;

      // Return dynamic config with cached endpoint from global setup
      return {
        accessKeyId: 'test',
        secretAccessKey: 'test',
        region: TEST_REGION,
        bucketName,
        endpoint,
        publicUrl: cachedPublicUrl || `http://localhost:4566/${TEST_BUCKET_NAME}`,
      };
    },
  },
}));

vi.mock('../src/algod', () => ({
  networkMetadata: TEST_NETWORK_METADATA,
  algod: {
    getTransactionParams: () => ({
      do: () =>
        Promise.resolve({
          genesisID: TEST_NETWORK_METADATA.genesisID,
          genesisHash: Buffer.from(TEST_NETWORK_METADATA.genesisHash, 'base64'),
        }),
    }),
  },
  getNetworkMetadata: () => Promise.resolve(TEST_NETWORK_METADATA),
}));

// Export for test access
export function getGlobalLocalStack() {
  if (!cachedEndpoint || !cachedPublicUrl) {
    throw new Error('LocalStack not initialized - endpoint unavailable');
  }
  return {
    s3Client: getOrCreateS3Client(),
    endpoint: cachedEndpoint,
    publicUrl: cachedPublicUrl,
  };
}
