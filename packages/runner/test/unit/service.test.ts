import { describe, expect, it, vi } from "vitest";
import { type AlgorandClient } from "@algorandfoundation/algokit-utils";
import { waitForBlock } from "../../src/service.ts";

function makeAlgorand(statusAfterBlock: ReturnType<typeof vi.fn>): AlgorandClient {
  return { client: { algod: { statusAfterBlock } } } as unknown as AlgorandClient;
}

describe("waitForBlock", () => {
  it("resolves in one call when the chain is already at the target round", async () => {
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(1000) }),
    });
    await waitForBlock(makeAlgorand(statusAfterBlock), 1000);
    expect(statusAfterBlock).toHaveBeenCalledTimes(1);
    expect(statusAfterBlock).toHaveBeenCalledWith(999);
  });

  it("polls again when statusAfterBlock times out before the target round is reached", async () => {
    const statusAfterBlock = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ lastRound: BigInt(998) }) })
      .mockReturnValueOnce({ do: async () => ({ lastRound: BigInt(1000) }) });
    await waitForBlock(makeAlgorand(statusAfterBlock), 1000);
    expect(statusAfterBlock).toHaveBeenCalledTimes(2);
  });
});
