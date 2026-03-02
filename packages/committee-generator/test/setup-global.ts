import { vi } from 'vitest';

// Mock algod module before any other imports to prevent top-level await
vi.mock('../src/algod', () => ({
  networkMetadata: {
    genesisID: 'mainnet-v1.0',
    genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
  },
  algod: {
    getTransactionParams: () => ({
      do: () =>
        Promise.resolve({
          genesisID: 'mainnet-v1.0',
          genesisHash: Buffer.from('wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=', 'base64'),
        }),
    }),
  },
  getNetworkMetadata: () =>
    Promise.resolve({
      genesisID: 'mainnet-v1.0',
      genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
    }),
}));

// Set environment variables for config to use
process.env.MODE = 'write-cache';
process.env.FIRST_BLOCK = '55000000';
process.env.LAST_BLOCK = '58000000';
process.env.S3_PUBLIC_URL = 'http://localhost:4566/test-xgov-committees';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
process.env.S3_REGION = 'us-east-1';
process.env.S3_BUCKET_NAME = 'test-xgov-committees';
process.env.S3_ENDPOINT = 'http://localhost:4566';
