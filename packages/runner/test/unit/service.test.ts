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
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/state.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/state.ts")>();
  return { ...actual, loadState: vi.fn(), saveState: vi.fn() };
});
vi.mock("../../src/config.ts", () => ({}));
vi.mock("@algorandfoundation/algokit-utils", () => ({
  AlgorandClient: { fromConfig: vi.fn() },
}));

const mockSpawn = vi.mocked(spawn);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockFromConfig = vi.mocked(AlgorandClient.fromConfig);

const MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const TIP_BUFFER = 21;

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
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("retries and warns when algod throws, covering both Error and non-Error thrown values", async () => {
    const statusAfterBlock = vi
      .fn()
      .mockImplementationOnce(() => ({
        do: async () => {
          throw "string error";
        },
      }))
      .mockImplementationOnce(() => ({
        do: async () => {
          throw new Error("connection reset");
        },
      }))
      .mockReturnValueOnce({ do: async () => ({ lastRound: BigInt(1000) }) });
    await waitForBlock(makeAlgorandClient(statusAfterBlock), 1000);
    expect(statusAfterBlock).toHaveBeenCalledTimes(3);
    expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(expect.stringContaining("string error"));
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(expect.stringContaining("connection reset"));
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

  it("resolves without retrying when retryOnTip is false and generator hits chain tip", async () => {
    const { child, emitClose } = makeChildProcess(10);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await runWriteCache(makeAlgorandClient(vi.fn()), "/fake/path/gen.js", 57_996_051, 58_000_042, false);

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("expected for warming"));
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
    expect(statusAfterBlock).toHaveBeenCalledWith(58_000_042 + TIP_BUFFER - 1);
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
      slackBotToken: "xoxb-test",
      slackChannelId: "C0TEST",
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

  // All tests use lastGovernancePeriod: { startRound: 50e6, endRound: 53e6 } as base state.
  function makeState(lastCacheRound: number, startRound = 50e6, endRound = 53e6) {
    return { lastGovernancePeriod: { startRound, endRound }, lastCacheRound, updatedAt: "" };
  }

  it("bootstraps from initial governance period when no state file exists", async () => {
    // null, bootstrap state (49M,52M) => first period (50M,53M)
    // round 59.1M: catches up through (56M,59M), warms (57M,60M), then guard breaks
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi.fn().mockReturnValue({
      do: async () => ({ firstValid: 59_112_478n, genesisHash }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock: vi.fn() } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce(null) // bootstrap
      .mockReturnValueOnce(makeState(53e6, 50e6, 53e6))
      .mockReturnValueOnce(makeState(54e6, 51e6, 54e6))
      .mockReturnValueOnce(makeState(55e6, 52e6, 55e6))
      .mockReturnValueOnce(makeState(56e6, 53e6, 56e6))
      .mockReturnValueOnce(makeState(57e6, 54e6, 57e6))
      .mockReturnValueOnce(makeState(58e6, 55e6, 58e6))
      .mockReturnValueOnce(makeState(59e6, 56e6, 59e6)) // after last catch-up → warming
      .mockReturnValueOnce(makeState(59_112_478, 56e6, 59e6)); // after warming → guard breaks

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    // first spawn starts from initial period
    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "50000000", "--to-block", "53000000"],
      expect.anything(),
    );
    expect(mockSaveState).toHaveBeenNthCalledWith(
      1,
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastGovernancePeriod: { startRound: 50e6, endRound: 53e6 }, lastCacheRound: 53e6 }),
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("bootstrapping"));
  });

  it("catches up across multiple periods from bootstrap, then warms current period", async () => {
    // null state, current round 56.4M => 4 catch-ups (50M,53M) to (53M,56M) + 100K warming for (54M,57M)
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi.fn().mockReturnValue({
      do: async () => ({ firstValid: 56_412_837n, genesisHash }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock: vi.fn() } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce(null) // bootstrap
      .mockReturnValueOnce(makeState(53e6, 50e6, 53e6))
      .mockReturnValueOnce(makeState(54e6, 51e6, 54e6))
      .mockReturnValueOnce(makeState(55e6, 52e6, 55e6))
      .mockReturnValueOnce(makeState(56e6, 53e6, 56e6)) // after last catch-up
      .mockReturnValueOnce(makeState(56_412_837, 53e6, 56e6)); // after warming

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    // 4 catch-up spawns
    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "50000000", "--to-block", "53000000"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "51000000", "--to-block", "54000000"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      3,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "52000000", "--to-block", "55000000"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      4,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "53000000", "--to-block", "56000000"],
      expect.anything(),
    );
    // 5th spawn: warming for current period
    expect(mockSpawn).toHaveBeenNthCalledWith(
      5,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "54000000", "--to-block", "57000000"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenCalledTimes(5);
    expect(mockSaveState).toHaveBeenCalledTimes(5);
    expect(mockSaveState).toHaveBeenLastCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastCacheRound: 56_412_837 }),
    );
  });

  it("catches up from existing state after downtime, then warms current period", async () => {
    // state at (54M,57M), round 59.1M => 2 catch-ups (55M,58M) (56M,59M) + warming for (57M,60M)
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi.fn().mockReturnValue({
      do: async () => ({ firstValid: 59_112_478n, genesisHash }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock: vi.fn() } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce(makeState(57e6, 54e6, 57e6))
      .mockReturnValueOnce(makeState(58e6, 55e6, 58e6))
      .mockReturnValueOnce(makeState(59e6, 56e6, 59e6)) // after last catch-up
      .mockReturnValueOnce(makeState(59_112_478, 56e6, 59e6)); // after warming

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    // 2 catch-up spawns
    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "55000000", "--to-block", "58000000"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "56000000", "--to-block", "59000000"],
      expect.anything(),
    );
    // 3rd spawn: warming for current period
    expect(mockSpawn).toHaveBeenNthCalledWith(
      3,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "57000000", "--to-block", "60000000"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenCalledTimes(3);
    expect(mockSaveState).toHaveBeenCalledTimes(3);
    expect(mockSaveState).toHaveBeenLastCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastCacheRound: 59_112_478 }),
    );
  });

  it("no boundary crossed: does not spawn child", async () => {
    const { algorand } = makeRunAlgorand(53_500_050n);
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValue(makeState(53_500_042));

    await run(makeConfig());

    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("close 1M boundary: waits for period end and spawns write-cache", async () => {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_999_150n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_999_150n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 54_000_000n, genesisHash }) });
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(54_000_021) }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock } },
    } as unknown as AlgorandClient);
    mockLoadState.mockReturnValueOnce(makeState(53_999_000)).mockReturnValueOnce(makeState(54e6, 51e6, 54e6));

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "51000000", "--to-block", "54000000"],
      expect.anything(),
    );
    expect(statusAfterBlock).toHaveBeenCalledWith(54_000_020);
    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastGovernancePeriod: { startRound: 51e6, endRound: 54e6 }, lastCacheRound: 54e6 }),
    );
  });

  it("100K boundary crossed: spawns write-cache and re-evaluates", async () => {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_050n, genesisHash }) });
    const statusAfterBlock = vi.fn();
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock } },
    } as unknown as AlgorandClient);
    mockLoadState.mockReturnValueOnce(makeState(53_096_000)).mockReturnValueOnce(makeState(53_200_042));

    const { child, emitClose } = makeChildProcess(0);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await run(makeConfig());

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "51000000", "--to-block", "54000000"],
      expect.anything(),
    );
    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastCacheRound: 53_200_042 }),
    );
    expect(getTransactionParams).toHaveBeenCalledTimes(3);
    expect(mockLoadState).toHaveBeenCalledTimes(2);
    expect(statusAfterBlock).not.toHaveBeenCalled();
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("100K boundary crossed"));
  });

  it("100K boundary crossed: re-evaluates and meets close to 1M boundary", async () => {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_999_150n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 54_000_000n, genesisHash }) });
    const statusAfterBlock = vi.fn().mockReturnValue({
      do: async () => ({ lastRound: BigInt(54_000_021) }),
    });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock } },
    } as unknown as AlgorandClient);
    mockLoadState
      .mockReturnValueOnce(makeState(53_096_000))
      .mockReturnValueOnce(makeState(53_200_042))
      .mockReturnValueOnce(makeState(54e6, 51e6, 54e6));

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
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "51000000", "--to-block", "54000000"],
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      "node",
      ["/fake/generator.js", "--mode", "write-cache", "--from-block", "51000000", "--to-block", "54000000"],
      expect.anything(),
    );
    expect(statusAfterBlock).toHaveBeenCalledWith(54_000_020);
    expect(mockSaveState).toHaveBeenCalledTimes(2);
  });

  it("100K boundary crossed: continues without error when generator hits tip", async () => {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_050n, genesisHash }) });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock: vi.fn() } },
    } as unknown as AlgorandClient);
    mockLoadState.mockReturnValueOnce(makeState(53_096_000)).mockReturnValueOnce(makeState(53_200_042));

    const { child, emitClose } = makeChildProcess(10); // tip
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await expect(run(makeConfig())).resolves.toBeUndefined();
    expect(mockSpawn).toHaveBeenCalledOnce(); // no retry
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("expected for warming"));
    expect(mockSaveState).toHaveBeenCalledWith(
      stateDir,
      MAINNET_GENESIS_HASH,
      999,
      expect.objectContaining({ lastCacheRound: 53_200_042 }),
    );
  });

  it("throws when generator exits with fatal error", async () => {
    const { algorand } = makeRunAlgorand(55_000_000n);
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValue(makeState(53e6));

    const { child, emitClose } = makeChildProcess(1);
    mockSpawn.mockImplementation(() => {
      process.nextTick(emitClose);
      return child;
    });

    await expect(run(makeConfig())).rejects.toThrow("fatal error");
  });

  it("throws when generator hits chain tip on both attempts", async () => {
    const { algorand, statusAfterBlock } = makeRunAlgorand(55_000_000n);
    statusAfterBlock.mockReturnValue({
      do: async () => ({ lastRound: BigInt(55_000_100) }),
    });
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValue(makeState(53e6));

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

  it("throws on first iteration when algod round is not ahead of the last cache round", async () => {
    const { algorand } = makeRunAlgorand(53_500_042n);
    mockFromConfig.mockReturnValue(algorand as unknown as AlgorandClient);
    mockLoadState.mockReturnValue(makeState(53_500_042));

    await expect(run(makeConfig())).rejects.toThrow("not ahead of the last cache");
  });

  it("exits cleanly on second iteration when algod has not advanced past the last cache round", async () => {
    const genesisHash = new Uint8Array(Buffer.from(MAINNET_GENESIS_HASH, "base64"));
    const getTransactionParams = vi
      .fn()
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) })
      .mockReturnValueOnce({ do: async () => ({ firstValid: 53_200_042n, genesisHash }) });
    mockFromConfig.mockReturnValue({
      client: { algod: { getTransactionParams, statusAfterBlock: vi.fn() } },
    } as unknown as AlgorandClient);
    mockLoadState.mockReturnValueOnce(makeState(53_096_000)).mockReturnValueOnce(makeState(53_200_042));

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
