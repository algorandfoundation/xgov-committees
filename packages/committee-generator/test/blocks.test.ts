import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TipReachedError } from '../src/blocks';
import { createTipReachedMock } from './test-helpers';

// Mock modules before importing the functions under test
vi.mock('../src/config', () => ({
  config: {
    concurrency: 5,
    algodServer: 'http://localhost',
    algodToken: '',
    registryAppId: 123456,
  },
}));

vi.mock('../src/cache', () => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
  subtractCached: vi.fn(),
}));

vi.mock('../src/shutdown', () => ({
  guardWhileNotShuttingDown: <T extends (...args: never[]) => unknown>(fn: T) => fn, // passthrough, no shutdown guard for tests
  isShuttingDown: vi.fn(() => false),
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
}));

describe('blocks.ts - TipReachedError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBlock', () => {
    it('should throw TipReachedError when algod returns 404 error for unavailable block', async () => {
      const { getCache } = await import('../src/cache');
      const { algod } = await import('../src/algod');
      const { getBlock } = await import('../src/blocks');

      // Mock cache miss
      vi.mocked(getCache).mockResolvedValue(undefined);

      // Mock algod to throw 404 error (block not available)
      vi.mocked(algod.block).mockImplementation(createTipReachedMock());

      const futureBlockNumber = 99999999;

      // Verify error properties
      await expect(getBlock(futureBlockNumber)).rejects.toBeInstanceOf(TipReachedError);
      await expect(getBlock(futureBlockNumber)).rejects.toMatchObject({
        blockNumber: futureBlockNumber,
        message: `Block ${futureBlockNumber} not available. The tip of the blockchain has been reached.`,
        name: 'TipReachedError',
      });
    });

    it('should throw TipReachedError when algod returns 404 with skipCache=true', async () => {
      const { algod } = await import('../src/algod');
      const { getBlock } = await import('../src/blocks');

      // Mock algod to throw 404 error
      vi.mocked(algod.block).mockImplementation(createTipReachedMock());

      const futureBlockNumber = 88888888;

      // Test with skipCache=true (should bypass cache entirely)
      await expect(getBlock(futureBlockNumber, true)).rejects.toThrow(TipReachedError);
    });

    it('should rethrow non-404 errors without wrapping in TipReachedError', async () => {
      const { getCache } = await import('../src/cache');
      const { algod } = await import('../src/algod');
      const { getBlock } = await import('../src/blocks');

      // Mock cache miss
      vi.mocked(getCache).mockResolvedValue(undefined);

      // Mock algod to throw a different error (not 404)
      const networkError = new Error('Network timeout');
      const mockBlock = vi.fn().mockReturnValue({
        headerOnly: vi.fn().mockReturnValue({
          do: vi.fn().mockRejectedValue(networkError),
        }),
      });
      vi.mocked(algod.block).mockImplementation(mockBlock);

      const blockNumber = 12345;

      // Should throw the original error, not TipReachedError
      const blockPromise = getBlock(blockNumber);
      await expect(blockPromise).rejects.toThrow('Network timeout');
      await expect(blockPromise).rejects.toThrow(networkError);
      await expect(blockPromise).rejects.not.toThrow(TipReachedError);
    });

    it('should successfully return block when available from algod', async () => {
      const { getCache, setCache } = await import('../src/cache');
      const { algod, networkMetadata } = await import('../src/algod');
      const { getBlock } = await import('../src/blocks');

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
      const { getCache, subtractCached } = await import('../src/cache');
      const { algod } = await import('../src/algod');
      const { getBlocks } = await import('../src/blocks');

      // Mock cache to indicate no cached blocks
      vi.mocked(subtractCached).mockResolvedValue([99999990, 99999991, 99999992]);
      vi.mocked(getCache).mockResolvedValue(undefined);

      // Mock algod to throw 404 error
      vi.mocked(algod.block).mockImplementation(createTipReachedMock());

      // Should throw TipReachedError when trying to fetch unavailable blocks
      await expect(getBlocks([99999990, 99999991, 99999992])).rejects.toThrow(TipReachedError);
    });
  });
});
