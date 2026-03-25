import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTipReachedMock } from './test-helpers.ts';

// Mock all dependencies before importing modules
vi.mock('../src/config.ts', () => ({
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

vi.mock('../src/cache/index.ts', () => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
  subtractCached: vi.fn(),
  ensureCacheSubPathExists: vi.fn(),
}));

vi.mock('../src/cache/cache-manager.ts', () => ({
  cacheManager: {
    flushAllPages: vi.fn().mockResolvedValue(undefined),
  },
  shutdownCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/shutdown.ts', () => ({
  guardWhileNotShuttingDown: <T extends (...args: never[]) => unknown>(fn: T) => fn, // passthrough for tests
  isShuttingDown: vi.fn(() => false),
  ExitCode: {
    SUCCESS: 0,
    EXPECTED_TIP: 10,
    FATAL: 1,
  },
  expectedExit: vi.fn(),
  fatalError: vi.fn().mockResolvedValue(undefined),
  gracefulShutdown: vi.fn(),
  enableAsyncTracking: vi.fn(),
  ShuttingDownError: class ShuttingDownError extends Error {},
  awaitShutdown: vi.fn(),
}));

vi.mock('../src/algod.ts', () => ({
  networkMetadata: {
    genesisID: 'mainnet-v1.0',
    genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
  },
  algod: {
    block: vi.fn(),
    status: vi.fn(),
  },
}));

vi.mock('../src/utils.ts', () => ({
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

vi.mock('../src/proposers.ts', () => ({
  loadProposers: vi.fn().mockResolvedValue(null),
  getBlockProposers: vi.fn(),
  saveProposers: vi.fn(),
}));

vi.mock('../src/candidate-committee.ts', () => ({
  loadCandidateCommittee: vi.fn().mockResolvedValue(null),
  getCandidateCommittee: vi.fn(),
  saveCandidateCommittee: vi.fn(),
}));

vi.mock('../src/committee.ts', () => ({
  loadCommittee: vi.fn().mockResolvedValue(null),
  getCommittee: vi.fn(),
  saveCommittee: vi.fn(),
  getCommitteeID: vi.fn().mockReturnValue('test-committee-id'),
}));

vi.mock('../src/subscribed-xgovs.ts', () => ({
  loadSubscribedXgovs: vi.fn().mockResolvedValue(null),
  getSubscribedXgovs: vi.fn(),
  saveSubscribedXgovs: vi.fn(),
}));

vi.mock('../src/s3/index.ts', () => ({
  ensureCommitteeShortcuts: vi.fn().mockResolvedValue(undefined),
}));

describe('TipReachedError Integration Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should propagate TipReachedError from getBlock through runWriteCache', async () => {
    const { getCache, subtractCached } = await import('../src/cache/index.ts');
    const { algod } = await import('../src/algod.ts');
    const { runWriteCache } = await import('../src/modes/write-cache.ts');

    vi.mocked(subtractCached).mockResolvedValue([99999990, 99999991, 99999992]);
    vi.mocked(getCache).mockResolvedValue(undefined);
    vi.mocked(algod.block).mockImplementation(createTipReachedMock());
    vi.mocked(algod.status).mockReturnValue({
      do: vi.fn().mockResolvedValue({ lastRound: 99999990n }),
    } as never);

    await expect(runWriteCache(99999990, 99999992)).rejects.toMatchObject({
      blockNumber: 99999990n,
      name: 'TipReachedError',
    });
  });
});
