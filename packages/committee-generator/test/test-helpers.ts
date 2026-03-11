import { vi } from 'vitest';

/**
 * Creates a mock algod.block implementation that simulates a 404 error response
 * when the requested block is not available (tip of blockchain reached).
 *
 * @returns A mock function configured to throw the 404 error pattern from algod
 */
export function createTipReachedMock() {
  return vi.fn().mockReturnValue({
    headerOnly: vi.fn().mockReturnValue({
      do: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Network request error. Received status 404 (Not Found): failed to retrieve information from the ledger',
          ),
        ),
    }),
  });
}
