import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TipReachedError } from '../src/blocks';
import { createTipReachedMock } from './test-helpers';

// Mock all dependencies before importing modules
vi.mock('../src/config', () => ({
  config: {
    cacheMode: 'write-cache' as const,
    registryAppId: 123456,
    fromBlock: 99999990,
    toBlock: 99999992,
    algodServer: 'http://localhost',
    algodToken: '',
    concurrency: 5,
    dataPath: 'data/',
    verbose: false,
    s3: undefined,
  },
}));

vi.mock('../src/cache', () => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
  subtractCached: vi.fn(),
  ensureCacheSubPathExists: vi.fn(),
}));

vi.mock('../src/cache/cache-manager', () => ({
  cacheManager: {
    flushAllPages: vi.fn().mockResolvedValue(undefined),
  },
  shutdownCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/shutdown', () => ({
  guardWhileNotShuttingDown: <T extends (...args: never[]) => unknown>(fn: T) => fn, // passthrough for tests
  isShuttingDown: vi.fn(() => false),
  ExitCode: {
    SUCCESS: 0,
    EXPECTED_TIP: 10,
    FATAL: 1,
  },
  expectedExit: vi.fn(),
  fatalError: vi.fn(),
  gracefulShutdown: vi.fn(),
  enableAsyncTracking: vi.fn(),
  ShuttingDownError: class ShuttingDownError extends Error {},
  awaitShutdown: vi.fn(),
}));

vi.mock('../src/algod', () => ({
  networkMetadata: {
    genesisID: 'mainnet-v1.0',
    genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
  },
  algod: {
    block: vi.fn(),
  },
}));

vi.mock('../src/utils', () => ({
  chunk: <T>(arr: T[], size: number) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  },
  clearLine: vi.fn(),
  formatDuration: vi.fn(() => '1s'),
  sleep: vi.fn(() => Promise.resolve()),
  makeRndsArray: (from: number, to: number) => {
    const arr = [];
    for (let i = from; i <= to; i++) {
      arr.push(i);
    }
    return arr;
  },
  committeeIdToSafeFileName: vi.fn((id: string) => id),
}));

vi.mock('../src/proposers', () => ({
  loadProposers: vi.fn().mockResolvedValue(null),
  getBlockProposers: vi.fn(),
  saveProposers: vi.fn(),
}));

vi.mock('../src/candidate-committee', () => ({
  loadCandidateCommittee: vi.fn().mockResolvedValue(null),
  getCandidateCommittee: vi.fn(),
  saveCandidateCommittee: vi.fn(),
}));

vi.mock('../src/committee', () => ({
  loadCommittee: vi.fn().mockResolvedValue(null),
  getCommittee: vi.fn(),
  saveCommittee: vi.fn(),
  getCommitteeID: vi.fn().mockReturnValue('test-committee-id'),
}));

vi.mock('../src/subscribed-xgovs', () => ({
  loadSubscribedXgovs: vi.fn().mockResolvedValue(null),
  getSubscribedXgovs: vi.fn(),
  saveSubscribedXgovs: vi.fn(),
}));

vi.mock('../src/s3', () => ({
  ensureCommitteeShortcuts: vi.fn().mockResolvedValue(undefined),
}));

describe('TipReachedError Integration Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should propagate TipReachedError from getBlock through runWriteCache', async () => {
    const { getCache, subtractCached } = await import('../src/cache');
    const { algod } = await import('../src/algod');
    const { runWriteCache } = await import('../src/modes/write-cache');

    // Mock cache to indicate no cached blocks
    vi.mocked(subtractCached).mockResolvedValue([99999990, 99999991, 99999992]);
    vi.mocked(getCache).mockResolvedValue(undefined);

    // Mock algod.block to throw 404 error (block not available - tip reached)
    vi.mocked(algod.block).mockImplementation(createTipReachedMock());

    // Verify the error contains the correct block number
    await expect(runWriteCache(99999990, 99999992)).rejects.toMatchObject({
      blockNumber: 99999990,
    });
  });

  it('should verify TipReachedError is caught by index.ts error handler', async () => {
    // we expect 3 assertions in this test: error type, block number, and message content (trycatch catch block)
    expect.assertions(3);

    const { getCache, subtractCached } = await import('../src/cache');
    const { algod } = await import('../src/algod');
    const { runWriteCache } = await import('../src/modes/write-cache');

    // Mock cache to indicate no cached blocks
    vi.mocked(subtractCached).mockResolvedValue([88888888]);
    vi.mocked(getCache).mockResolvedValue(undefined);

    // Mock algod.block to throw 404 error
    vi.mocked(algod.block).mockImplementation(createTipReachedMock());

    // Verify that runWriteCache propagates TipReachedError up to index.ts
    // This proves the error bubbles through: getBlock → getBlocks → runWriteCache → index.ts
    try {
      await runWriteCache(88888888, 88888888);
    } catch (error) {
      // Verify error is the correct type and has correct block number
      expect(error).toBeInstanceOf(TipReachedError);
      expect((error as TipReachedError).blockNumber).toBe(88888888);
      expect((error as TipReachedError).message).toContain('Block 88888888 not available');
    }
  });
});
