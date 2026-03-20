import { mkdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { type Config } from "./config.ts";
import {
  type GovernancePeriod,
  type RunnerState,
  INITIAL_PERIOD,
  COHORT_VALIDITY_RANGE,
  loadState,
  saveState,
} from "./state.ts";
import { crossed100KBoundary, closeTo1MBoundary } from "./utils.ts";

const TIP_BUFFER = 21; // ~1m at 2.8s per block

// Mirrors committee-generator's ExitCode
const GENERATOR_EXIT_CODE = {
  SUCCESS: 0,
  FATAL: 1,
  EXPECTED_TIP: 10,
} as const;

// Module-level singleton: run() is called once and awaits each spawnWriteCache call.
let activeChild: ChildProcess | null = null;
export function getActiveChild(): ChildProcess | null {
  return activeChild;
}

/**
 * Spawns the committee generator in write-cache mode with (fromBlock, toBlock) arguments.
 * Resolves "success" or "tip" (generator hit the chain tip before toBlock).
 * Rejects on generator's fatal exit or spawn error.
 */
function spawnWriteCache(generatorPath: string, fromBlock: number, toBlock: number): Promise<"success" | "tip"> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [generatorPath, "--mode", "write-cache", "--from-block", String(fromBlock), "--to-block", String(toBlock)],
      { stdio: "inherit", env: process.env },
    );
    activeChild = child;
    child.on("error", (err) => {
      activeChild = null;
      reject(err);
    });
    child.on("close", (code, signal) => {
      activeChild = null;
      if (code === GENERATOR_EXIT_CODE.SUCCESS) resolve("success");
      else if (code === GENERATOR_EXIT_CODE.EXPECTED_TIP) resolve("tip");
      else if (code === GENERATOR_EXIT_CODE.FATAL)
        reject(new Error(`committee-generator exited with a fatal error (exit code ${code})`));
      else
        reject(
          new Error(
            `committee-generator exited unexpectedly: ${code !== null ? `exit code ${code}` : `signal ${signal}`}`,
          ),
        );
    });
  });
}

/**
 * Polls algod until the chain reaches targetRound.
 * Necessary because statusAfterBlock times out after 1 minute.
 */
export async function waitForBlock(algorand: AlgorandClient, targetRound: number): Promise<void> {
  while (true) {
    try {
      const status = await algorand.client.algod.statusAfterBlock(targetRound - 1).do();
      if (Number(status.lastRound) >= targetRound) return;
    } catch (err) {
      console.warn(`waitForBlock: algod error, retrying (${err instanceof Error ? err.message : err})`);
      await setTimeout(2_000);
    }
  }
}

/**
 * Runs generator's write-cache mode, handling the case where the generator hits the chain tip.
 *
 * If retryOnTip is true, retries once if the generator hits the chain tip and throws if tip is hit twice.
 * If retryOnTip is false, accepts "tip" silently and returns.
 */
export async function runWriteCache(
  algorand: AlgorandClient,
  generatorPath: string,
  from: number,
  to: number,
  retryOnTip: boolean = true,
): Promise<void> {
  const result = await spawnWriteCache(generatorPath, from, to);
  if (result === "tip") {
    if (!retryOnTip) {
      console.log(`committee-generator reached chain tip (expected for warming), continuing`);
      return;
    }
    console.log(`committee-generator reached chain tip, waiting for block ${to + TIP_BUFFER}, then retrying`);
    await waitForBlock(algorand, to + TIP_BUFFER);
    const retry = await spawnWriteCache(generatorPath, from, to);
    if (retry === "tip") {
      throw new Error(`committee-generator reached chain tip even after retrying with ${TIP_BUFFER}-round buffer`);
    }
  }
}

/**
 * Loads local state handling the case where no state file exists.
 * In the bootstrap case, makes a fake state that signals the service to start processing from the first-ever
 * governance period.
 */
function getState(config: Config, genesisHash: string): Omit<RunnerState, "updatedAt"> {
  const state = loadState(config.stateDir, genesisHash, config.registryAppId);
  if (state != null) return state;
  else {
    console.log(
      `No state file found — bootstrapping from first governance period (${INITIAL_PERIOD.Bi}, ${INITIAL_PERIOD.Bf}) (\`write-cache\` mode is idempotent)`,
    );
    return {
      lastGovernancePeriod: {
        Bi: INITIAL_PERIOD.Bi - COHORT_VALIDITY_RANGE,
        Bf: INITIAL_PERIOD.Bf - COHORT_VALIDITY_RANGE,
      },
      lastCacheRound: 0,
    };
  }
}

/**
 * Calculates the next governance period based on the last processed one.
 */
function nextGovernancePeriod(lastProcessed: GovernancePeriod): GovernancePeriod {
  return {
    Bi: lastProcessed.Bi + COHORT_VALIDITY_RANGE,
    Bf: lastProcessed.Bf + COHORT_VALIDITY_RANGE,
  };
}

/**
 * Runs the service loop until all run conditions are handled.
 * Re-evaluates after each write-cache op in case run conditions are met.
 */
export async function run(config: Config): Promise<void> {
  const algorand = AlgorandClient.fromConfig({
    algodConfig: {
      server: config.algodServer,
      port: config.algodPort,
      token: config.algodToken,
    },
  });

  const params = await algorand.client.algod.getTransactionParams().do();
  const genesisHash = Buffer.from(params.genesisHash).toString("base64");

  mkdirSync(config.stateDir, { recursive: true });

  let loopCounter = 0;

  while (true) {
    loopCounter++;
    const { firstValid } = await algorand.client.algod.getTransactionParams().do();
    const currentRound = Number(firstValid);

    const state = getState(config, genesisHash);
    const { Bi, Bf } = nextGovernancePeriod(state.lastGovernancePeriod);

    if (loopCounter === 1) console.log(`genesis: ${genesisHash}; registry: ${config.registryAppId}`);
    console.log(`[#${loopCounter}] - current round ${currentRound}; processing period: (${Bi}, ${Bf})`);

    if (currentRound <= state.lastCacheRound) {
      if (loopCounter === 1)
        throw new Error(
          `algod returned round ${currentRound} which is not ahead of the last cache warm round ${state.lastCacheRound}`,
        );
      console.log(`caught up at round ${state.lastCacheRound}, exiting`);
      break;
    }

    async function handlePeriodEnd() {
      await runWriteCache(algorand, config.committeeGeneratorPath, Bi, Bf);
      saveState(config.stateDir, genesisHash, config.registryAppId, {
        lastGovernancePeriod: { Bi, Bf },
        lastCacheRound: Bf,
        updatedAt: new Date().toISOString(),
      });
    }

    async function handleCatchUp() {
      console.log(`catch-up: all blocks available, calling write-cache with (${Bi}, ${Bf})`);
      await handlePeriodEnd();
    }

    async function handleApproachingPeriodEnd() {
      console.log(`approaching period end at ${Bf}, waiting...`);
      await waitForBlock(algorand, Bf + TIP_BUFFER);
      console.log(`period end reached: all blocks available, calling write-cache with (${Bi}, ${Bf})`);
      await handlePeriodEnd();
    }

    async function handleBoundaryCrossed() {
      console.log(`100K boundary crossed since last cache update, calling write-cache with (${Bi}, ${Bf})`);
      await runWriteCache(algorand, config.committeeGeneratorPath, Bi, Bf, false);
      saveState(config.stateDir, genesisHash, config.registryAppId, {
        ...state,
        lastCacheRound: currentRound,
        updatedAt: new Date().toISOString(),
      });
    }

    if (currentRound >= Bf) await handleCatchUp();
    else if (closeTo1MBoundary(currentRound)) await handleApproachingPeriodEnd();
    else if (crossed100KBoundary(state.lastCacheRound, currentRound)) await handleBoundaryCrossed();
    else break;
  }
}
