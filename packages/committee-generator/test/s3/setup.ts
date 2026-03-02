import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';

let localStackContainer: StartedTestContainer | null = null;
let s3Client: S3Client | null = null;

export const TEST_BUCKET_NAME = 'test-xgov-committees';
export const TEST_REGION = 'us-east-1';

/**
 * Start LocalStack container for S3 testing
 */
export async function startLocalStack(): Promise<{
  endpoint: string;
  publicUrl: string;
}> {
  if (localStackContainer) {
    const endpoint = `http://${localStackContainer.getHost()}:${localStackContainer.getMappedPort(4566)}`;
    return {
      endpoint,
      publicUrl: `${endpoint}/${TEST_BUCKET_NAME}`,
    };
  }

  localStackContainer = await new GenericContainer('localstack/localstack:latest')
    .withEnvironment({
      SERVICES: 's3',
      DEBUG: '0',
      EAGER_SERVICE_LOADING: '1',
    })
    .withExposedPorts(4566)
    .withWaitStrategy(Wait.forLogMessage(/Ready\./))
    .withStartupTimeout(120_000) // 2 minutes
    .start();

  const endpoint = `http://${localStackContainer.getHost()}:${localStackContainer.getMappedPort(4566)}`;
  const publicUrl = `${endpoint}/${TEST_BUCKET_NAME}`;

  // Create S3 client
  s3Client = new S3Client({
    endpoint,
    region: TEST_REGION,
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
    forcePathStyle: true,
  });

  // Create test bucket
  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET_NAME }));
  } catch {
    // Bucket may already exist, ignore error
  }

  return { endpoint, publicUrl };
}

/**
 * Stop LocalStack container
 */
export async function stopLocalStack(): Promise<void> {
  if (localStackContainer) {
    await localStackContainer.stop();
    localStackContainer = null;
    s3Client = null;
  }
}

/**
 * Get S3 client for test operations
 */
export function getTestS3Client(): S3Client {
  if (!s3Client) {
    throw new Error('LocalStack not started. Call startLocalStack() first.');
  }
  return s3Client;
}
