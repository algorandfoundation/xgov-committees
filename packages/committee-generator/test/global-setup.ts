import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Global LocalStack instance
let localStackContainer: StartedTestContainer | null = null;

const CONFIG_FILE = resolve(__dirname, '.localstack-config.json');

export async function setup() {
  // Ensure config directory exists
  mkdirSync(__dirname, { recursive: true });

  try {
    console.log('[global-setup] Starting LocalStack...');
    localStackContainer = await new GenericContainer('localstack/localstack:4.14.0') // Use a lightweight LocalStack image with just S3 to speed up startup
      .withEnvironment({
        SERVICES: 's3',
        DEBUG: '0',
        EAGER_SERVICE_LOADING: '1',
      })
      .withExposedPorts(4566)
      .withWaitStrategy(Wait.forLogMessage(/Ready\./))
      .withStartupTimeout(120_000)
      .start();

    const endpoint = `http://${localStackContainer.getHost()}:${localStackContainer.getMappedPort(4566)}`;
    console.log(`[global-setup] LocalStack started at ${endpoint}`);

    // Write config to file so setupFiles can read it
    writeFileSync(
      CONFIG_FILE,
      JSON.stringify({
        endpoint,
        containerId: localStackContainer.getId(),
      }),
    );

    console.log('[global-setup] Config written to file');
  } catch (error) {
    console.error('[global-setup] Failed to start LocalStack:', error);
    throw error;
  }

  // Return cleanup function
  return async () => {
    console.log('[global-setup teardown] Cleaning up LocalStack...');
    if (localStackContainer) {
      try {
        await localStackContainer.stop();
        console.log('[global-setup teardown] LocalStack stopped');
      } catch (error) {
        console.error('[global-setup teardown] Failed to stop LocalStack:', error);
      }
    }
  };
}
