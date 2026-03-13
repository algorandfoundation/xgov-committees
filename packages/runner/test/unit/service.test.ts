import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { loadState, saveState } from "../../src/state.ts";
import { type Config } from "../../src/config.ts";
import { waitForBlock, runWriteCache, run, getActiveChild } from "../../src/service.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../../src/state.ts", () => ({ loadState: vi.fn(), saveState: vi.fn() }));
vi.mock("@algorandfoundation/algokit-utils", () => ({
  AlgorandClient: { fromConfig: vi.fn() },
}));

const mockSpawn = vi.mocked(spawn);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockFromConfig = vi.mocked(AlgorandClient.fromConfig);

const MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const ROUND_BUFFER = 21;
const FIRST_SYNC_ROUND = 50_000_000;

function makeChildProcess(exitCode: number | null = 0, signal: string | null = null) {
  const emitter = new EventEmitter() as ChildProcess;
  emitter.kill = vi.fn() as ChildProcess["kill"];
  const emitClose = () => emitter.emit("close", exitCode, signal);
  return { child: emitter, emitClose };
}

function makeAlgorandClient(statusAfterBlock: Mock): AlgorandClient {
  return { client: { algod: { statusAfterBlock } } } as unknown as AlgorandClient;
}

describe("waitForBlock", () => {
  it("resolves in one call when the chain is already at the target round", async () => {
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(1000) }),
    });
    await waitForBlock(makeAlgorandClient(statusAfterBlock), 1000);
    expect(statusAfterBlock).toHaveBeenCalledTimes(1);
    expect(statusAfterBlock).toHaveBeenCalledWith(999);
  });

  it("resolves in one call when lastRound has already passed the target", async () => {
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(1005) }),
    });
    await waitForBlock(makeAlgorandClient(statusAfterBlock), 1000);
    expect(statusAfterBlock).toHaveBeenCalledTimes(1);
  });

  it("polls again when the returned lastRound is still below the target", async () => {
    const statusAfterBlock = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ lastRound: BigInt(998) }) })
      .mockReturnValueOnce({ do: async () => ({ lastRound: BigInt(1000) }) });
    await waitForBlock(makeAlgorandClient(statusAfterBlock), 1000);
    expect(statusAfterBlock).toHaveBeenCalledTimes(2);
  });
});

describe("runWriteCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("resolves when generator exits 0", async () => {
    const statusAfterBlock = vi.fn();
    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await runWriteCache(makeAlgorandClient(statusAfterBlock), "/fake/path/gen.js", 57_996_051, 58_000_042);

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["/fake/path/gen.js", "--mode", "write-cache", "--from-block", "57996051", "--to-block", "58000042"],
      expect.anything(),
    );
    expect(statusAfterBlock).not.toHaveBeenCalled();
  });

  it("rejects when generator exits with a fatal error (code 1)", async () => {
    const { child, emitClose } = makeChildProcess(1);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await expect(
      runWriteCache(makeAlgorandClient(vi.fn()), "/fake/path/gen.js", 57_996_051, 58_000_042),
    ).rejects.toThrow("fatal error");
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it("retries and resolves when first run hits chain tip and retry succeeds", async () => {
    const { child: child1, emitClose: close1 } = makeChildProcess(10);
    const { child: child2, emitClose: close2 } = makeChildProcess(0);
    mockSpawn
      .mockImplementationOnce(() => {
        process.nextTick(close1);
        return child1;
      })
      .mockImplementationOnce(() => {
        process.nextTick(close2);
        return child2;
      });

    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(58_000_100) }),
    });
    await runWriteCache(makeAlgorandClient(statusAfterBlock), "/fake/path/gen.js", 57_996_051, 58_000_042);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      "node",
      ["/fake/path/gen.js", "--mode", "write-cache", "--from-block", "57996051", "--to-block", "58000042"],
      expect.anything(),
    );
    expect(statusAfterBlock).toHaveBeenCalledWith(58_000_042 + ROUND_BUFFER - 1);
  });

  it("rejects when generator hits chain tip on both attempts", async () => {
    const { child: child1, emitClose: close1 } = makeChildProcess(10);
    const { child: child2, emitClose: close2 } = makeChildProcess(10);
    mockSpawn
      .mockImplementationOnce(() => {
        process.nextTick(close1);
        return child1;
      })
      .mockImplementationOnce(() => {
        process.nextTick(close2);
        return child2;
      });

    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(58_000_100) }),
    });
    await expect(
      runWriteCache(makeAlgorandClient(statusAfterBlock), "/fake/path/gen.js", 57_996_051, 58_000_042),
    ).rejects.toThrow("generator reached chain tip even after retrying");
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("rejects when spawn emits an error", async () => {
    const { child } = makeChildProcess();
    const spawnError = new Error("ENOENT: generator not found");
    mockSpawn.mockImplementation(() => {
      process.nextTick(() => child.emit("error", spawnError));
      return child;
    });

    await expect(
      runWriteCache(makeAlgorandClient(vi.fn()), "/fake/path/gen.js", 57_996_051, 58_000_042),
    ).rejects.toThrow("ENOENT: generator not found");
  });

  it("rejects when generator exits with an unexpected code", async () => {
    const { child, emitClose } = makeChildProcess(2);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await expect(
      runWriteCache(makeAlgorandClient(vi.fn()), "/fake/path/gen.js", 57_996_051, 58_000_042),
    ).rejects.toThrow("exited unexpectedly: exit code 2");
  });

  it("rejects when killed by signal", async () => {
    const { child, emitClose } = makeChildProcess(null, "SIGTERM");
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await expect(
      runWriteCache(makeAlgorandClient(vi.fn()), "/fake/path/gen.js", 57_996_051, 58_000_042),
    ).rejects.toThrow("exited unexpectedly: signal SIGTERM");
  });

  it("sets activeChild while generator runs and clears it on close", async () => {
    const { child, emitClose } = makeChildProcess(0);
    let midSpawnChild: ReturnType<typeof getActiveChild> = null;
    mockSpawn.mockImplementation(() => {
      process.nextTick(() => {
        midSpawnChild = getActiveChild();
        emitClose();
      });
      return child;
    });

    expect(getActiveChild()).toBeNull();
    await runWriteCache(makeAlgorandClient(vi.fn()), "/fake/path/gen.js", 57_996_051, 58_000_042);
    expect(midSpawnChild).toBe(child);
    expect(getActiveChild()).toBeNull();
  });
});

describe("run", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "runner-unit-"));
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function makeConfig(): Config {
    return {
      algodServer: "http://localhost",
      algodPort: 4001,
      algodToken: "",
      registryAppId: 999,
      stateDir,
      committeeGeneratorPath: "/fake/generator.js",
    };
  }

  function makeRunAlgorand(firstValid: bigint) {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi.fn().mockReturnValue({
      do: async () => ({ firstValid, genesisHash }),
    });
    const statusAfterBlock = vi.fn();
    return {
      algorand: { client: { algod: { getTransactionParams, statusAfterBlock } } },
      getTransactionParams,
      statusAfterBlock,
    };
  }

  it("does not spawn write-cache when no boundary is crossed", async () => {
    const { algorand } = makeRunAlgorand(58_000_042n);
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValue({ lastProcessedRound: 58_000_040, updatedAt: "" });

    await run(makeConfig());

    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("spawns write-cache and re-evaluates when 100K boundary is crossed", async () => {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 58_000_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 58_000_050n, genesisHash }) });
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: 58_000_200n }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce({ lastProcessedRound: 57_996_051, updatedAt: "" })
      .mockReturnValueOnce({ lastProcessedRound: 58_000_042, updatedAt: "" });

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "57996052", "--to-block", "58000042"],
      expect.anything(),
    );
    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastProcessedRound: 58_000_042 }),
    );
    expect(getTransactionParams).toHaveBeenCalledTimes(2);
    expect(mockLoadState).toHaveBeenCalledTimes(2);
    expect(statusAfterBlock).not.toHaveBeenCalled();
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("100K boundary crossed"));
  });

  it("waits for 1M boundary and spawns write-cache when close to 1M and no 100K boundary is crossed", async () => {
    // currentRound=999_950: closeTo1MBoundary=true (50 blocks from 1M), crossed100KBoundary(999_901, 999_950)=false
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 999_950n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 1_000_050n, genesisHash }) });
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(1_000_021) }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce({ lastProcessedRound: 999_900, updatedAt: "" })
      .mockReturnValueOnce({ lastProcessedRound: 1_000_000, updatedAt: "" });

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "999901", "--to-block", "1000000"],
      expect.anything(),
    );
    expect(statusAfterBlock).toHaveBeenCalledWith(1_000_020);
    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastProcessedRound: 1_000_000 }),
    );
  });

  it("spawns 100K write-cache then 1M write-cache when both boundaries are crossed", async () => {
    // currentRound=999_950, nextRoundToProcess=899_001:
    //   crossed100KBoundary(899_001, 999_950)=true (900K boundary in range)
    //   closeTo1MBoundary(999_950)=true (50 blocks from 1M)
    //   => 1M write-cache from = currentRound + 1 = 999_951
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 999_950n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 1_000_050n, genesisHash }) });
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(1_000_021) }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce({ lastProcessedRound: 899_000, updatedAt: "" })
      .mockReturnValueOnce({ lastProcessedRound: 1_000_000, updatedAt: "" });

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "899001", "--to-block", "999950"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "999951", "--to-block", "1000000"],
      expect.anything(),
    );
    expect(statusAfterBlock).toHaveBeenCalledWith(1_000_020);
    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastProcessedRound: 1_000_000 }),
    );
  });

  it("throws when generator exits with fatal error", async () => {
    const { algorand } = makeRunAlgorand(58_000_042n);
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValue({ lastProcessedRound: 0, updatedAt: "" });

    const { child, emitClose } = makeChildProcess(1);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await expect(run(makeConfig())).rejects.toThrow("fatal error");
  });

  it("throws when generator hits chain tip on both attempts", async () => {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi.fn().mockReturnValue({
      do: async () => ({ firstValid: 58_000_042n, genesisHash }),
    });
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: 58_000_200n }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock } },
    } as unknown as AlgorandClient);
    mockLoadState.mockReturnValue({ lastProcessedRound: 57_996_051, updatedAt: "" });

    const { child: child1, emitClose: close1 } = makeChildProcess(10);
    const { child: child2, emitClose: close2 } = makeChildProcess(10);
    mockSpawn
      .mockImplementationOnce(() => {
        process.nextTick(close1);
        return child1;
      })
      .mockImplementationOnce(() => {
        process.nextTick(close2);
        return child2;
      });

    await expect(run(makeConfig())).rejects.toThrow("generator reached chain tip even after retrying");
  });

  it("bootstraps from FIRST_SYNC_ROUND when no state file exists", async () => {
    const { algorand } = makeRunAlgorand(58_000_042n);
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValueOnce(null).mockReturnValueOnce({ lastProcessedRound: 58_000_042, updatedAt: "" });

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      [
        "/fake/generator.js",
        "--mode",
        "write-cache",
        "--from-block",
        String(FIRST_SYNC_ROUND),
        "--to-block",
        "58000042",
      ],
      expect.anything(),
    );
    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastProcessedRound: 58_000_042 }),
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining(String(FIRST_SYNC_ROUND)));
  });

  it("throws on first iteration when algod round is not ahead of the next round to process", async () => {
    // currentRound (58_000_040) == nextRoundToProcess (58_000_040)
    const { algorand } = makeRunAlgorand(58_000_040n);
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValue({ lastProcessedRound: 58_000_039, updatedAt: "" });

    await expect(run(makeConfig())).rejects.toThrow("not ahead of the next round to process");
  });

  it("exits cleanly on second iteration when algod has not advanced past the last processed round", async () => {
    // Iteration 1: 100K boundary crossed → write-cache, saveState.
    // Iteration 2: algod still returns the same round (timer fired before new blocks) → clean break.
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 58_000_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 58_000_042n, genesisHash }) });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock: vi.fn() } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce({ lastProcessedRound: 57_996_051, updatedAt: "" })
      .mockReturnValueOnce({ lastProcessedRound: 58_000_042, updatedAt: "" });

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await expect(run(makeConfig())).resolves.toBeUndefined();
    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("caught up"));
  });
});
