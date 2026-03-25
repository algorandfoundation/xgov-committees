import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TipReachedError, isGenuineTipReached } from '../src/blocks.ts';
import { createTipReachedMock } from './test-helpers.ts';

// Mock modules before importing the functions under test
vi.mock('../src/config.ts', () => ({
  config: {
    concurrency: 5,
    algodServer: 'http://localhost',
    algodToken: '',
    registryAppId: 123456,
  },
}));

vi.mock('../src/cache/index.ts', () => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
  subtractCached: vi.fn(),
}));

vi.mock('../src/shutdown.ts', () => ({
  guardWhileNotShuttingDown: <T extends (...args: never[]) => unknown>(fn: T) => fn, // passthrough, no shutdown guard for tests
  isShuttingDown: vi.fn(() => false),
  fatalError: vi.fn().mockResolvedValue(undefined),
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
}));

describe('blocks.ts - TipReachedError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBlock', () => {
    it('should throw TipReachedError with correct block number when algod returns 404', async () => {
      const { getCache } = await import('../src/cache/index.ts');
      const { algod } = await import('../src/algod.ts');
      const { getBlock } = await import('../src/blocks.ts');

      vi.mocked(getCache).mockResolvedValue(undefined);
      vi.mocked(algod.block).mockImplementation(createTipReachedMock());
      vi.mocked(algod.status).mockReturnValue({
        do: vi.fn().mockResolvedValue({ lastRound: 99999999n }),
      } as never);

      await expect(getBlock(99999999)).rejects.toMatchObject({
        blockNumber: 99999999n,
        name: 'TipReachedError',
      });
    });

    it('should rethrow non-404 errors', async () => {
      const { getCache } = await import('../src/cache/index.ts');
      const { algod } = await import('../src/algod.ts');
      const { getBlock } = await import('../src/blocks.ts');

      vi.mocked(getCache).mockResolvedValue(undefined);
      vi.mocked(algod.block).mockReturnValue({
        headerOnly: vi.fn().mockReturnValue({
          do: vi.fn().mockRejectedValue(new Error('Network timeout')),
        }),
      } as never);

      await expect(getBlock(12345)).rejects.toThrow('Network timeout');
    });

    it('should successfully return block when available from algod', async () => {
      const { getCache, setCache } = await import('../src/cache/index.ts');
      const { algod, networkMetadata } = await import('../src/algod.ts');
      const { getBlock } = await import('../src/blocks.ts');

      // Mock cache miss
      vi.mocked(getCache).mockResolvedValue(undefined);

      // Mock successful block response
      const mockBlockHeader = {
        round: 50000000,
        genesisHash: Buffer.from(networkMetadata.genesisHash, 'base64'),
        timestamp: 1234567890,
      };

      const mockBlock = vi.fn().mockReturnValue({
        headerOnly: vi.fn().mockReturnValue({
          do: vi.fn().mockResolvedValue({
            block: {
              header: mockBlockHeader,
            },
          }),
        }),
      });
      vi.mocked(algod.block).mockImplementation(mockBlock);

      const result = await getBlock(50000000);

      expect(result).toEqual(mockBlockHeader);
      expect(setCache).toHaveBeenCalledWith(50000000, mockBlockHeader);
    });
  });

  describe('getBlocks', () => {
    it('should propagate TipReachedError when fetching multiple blocks', async () => {
      const { getCache, subtractCached } = await import('../src/cache/index.ts');
      const { algod } = await import('../src/algod.ts');
      const { getBlocks } = await import('../src/blocks.ts');

      // Mock cache to indicate no cached blocks
      vi.mocked(subtractCached).mockResolvedValue([99999990, 99999991, 99999992]);
      vi.mocked(getCache).mockResolvedValue(undefined);

      // Mock algod to throw 404 error
      vi.mocked(algod.block).mockImplementation(createTipReachedMock());
      vi.mocked(algod.status).mockReturnValue({
        do: vi.fn().mockResolvedValue({ lastRound: 99999992n }),
      } as never);

      // Should throw TipReachedError when trying to fetch unavailable blocks
      await expect(getBlocks([99999990, 99999991, 99999992])).rejects.toThrow(TipReachedError);
    });
  });
});

describe('isGenuineTipReached', () => {
  const DELTA_TOLERANCE = 5n;

  it('should return true when blockNumber is within delta tolerance of lastRound', () => {
    expect(isGenuineTipReached(1000n, 1000n, DELTA_TOLERANCE)).toBe(true); // delta = 0
    expect(isGenuineTipReached(999n, 1000n, DELTA_TOLERANCE)).toBe(true); // delta = 1
    expect(isGenuineTipReached(996n, 1000n, DELTA_TOLERANCE)).toBe(true); // delta = 4
    expect(isGenuineTipReached(995n, 1000n, DELTA_TOLERANCE)).toBe(true); // delta = 5, at boundary
  });

  it('should return false when blockNumber exceeds delta tolerance', () => {
    expect(isGenuineTipReached(994n, 1000n, DELTA_TOLERANCE)).toBe(false); // delta = 6
    expect(isGenuineTipReached(990n, 1000n, DELTA_TOLERANCE)).toBe(false); // delta = 10
    expect(isGenuineTipReached(500n, 1000n, DELTA_TOLERANCE)).toBe(false); // delta = 500
  });
});
