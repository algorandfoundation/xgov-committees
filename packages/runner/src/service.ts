import { mkdirSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { type Config } from "./config.ts";
import { loadState, saveState } from "./state.ts";
import { crossed100KBoundary, closeTo1MBoundary, next1MBoundary } from "./utils.ts";

const ROUND_BUFFER = 21; // ~1m at 2.8s per block
const REGISTRY_CREATION_ROUND = 52307574; // mainnet tx F6YHCQJJDNXY3ABSTOITQAY3KDVFMAOFIPMHM2HRCOTW72TLUX3Q

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
 * Spawns the committee generator in write-cache mode for [fromBlock, toBlock].
 * Resolves "success" or "tip" (generator hit the chain tip before toBlock).
 * Rejects on fatal exit or spawn error.
 * TODO: verify inclusive/exclusive block range with generator.
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
 * Necessary because the statusAfterBlock times out after 1 minute.
 */
export async function waitForBlock(algorand: AlgorandClient, targetRound: number): Promise<void> {
  while (true) {
    try {
      const status = await algorand.client.algod.statusAfterBlock(targetRound - 1).do();
      if (Number(status.lastRound) >= targetRound) return;
    } catch (err) {
      console.warn(`waitForBlock: algod error, retrying (${err instanceof Error ? err.message : err})`);
    }
  }
}

/**
 * Runs write-cache for [from, to], retrying once if the generator hits the chain tip.
 * On tip, waits for block `to + ROUND_BUFFER` before retrying with the same range.
 * Throws if tip is hit twice.
 */
export async function runWriteCache(
  algorand: AlgorandClient,
  generatorPath: string,
  from: number,
  to: number,
): Promise<void> {
  const result = await spawnWriteCache(generatorPath, from, to);
  if (result === "tip") {
    console.log(`generator reached chain tip, waiting for block ${to + ROUND_BUFFER} then retrying`);
    await waitForBlock(algorand, to + ROUND_BUFFER);
    const retry = await spawnWriteCache(generatorPath, from, to);
    if (retry === "tip") {
      throw new Error(`generator reached chain tip even after retrying with ${ROUND_BUFFER}-round buffer`);
    }
  }
}

/**
 * Runs the service loop until all run conditions are handled.
 * Re-evaluates after each write-cache op in case new boundaries are met (e.g. 100K sync may get close to 1M boundary).
 */
export async function run(config: Config): Promise<void> {
  const algorand = AlgorandClient.fromConfig({
    algodConfig: {
      server: config.algodServer,
      port: config.algodPort,
      token: config.algodToken,
    },
  });

  mkdirSync(config.stateDir, { recursive: true });
  let runCounter = 0;

  while (true) {
    runCounter++;
    let wroteCache = false;
    const params = await algorand.client.algod.getTransactionParams().do();
    const genesisHash = Buffer.from(params.genesisHash).toString("base64");
    let currentRound = Number(params.firstValid);

    const state = loadState(config.stateDir, genesisHash, config.registryAppId);
    if (state === null) {
      console.log(
        `No state file found — bootstrapping from round ${REGISTRY_CREATION_ROUND} (\`write-cache\` mode is idempotent)`,
      );
    }
    const nextRoundToProcess = (state?.lastProcessedRound ?? REGISTRY_CREATION_ROUND - 1) + 1;

    if (runCounter === 1) console.log(`genesis: ${genesisHash}, registry: ${config.registryAppId}`);
    console.log(`[#${runCounter}] round ${currentRound}, next to process: ${nextRoundToProcess}`);

    if (currentRound <= nextRoundToProcess) {
      if (runCounter === 1)
        throw new Error(
          `algod returned round ${currentRound} which is not ahead of the next round to process ${nextRoundToProcess}`,
        );
      console.log(`caught up at round ${currentRound - 1}, exiting`);
      break;
    }

    if (crossed100KBoundary(nextRoundToProcess, currentRound)) {
      console.log(`100K boundary crossed, write-cache ${nextRoundToProcess}–${currentRound}`);
      await runWriteCache(algorand, config.committeeGeneratorPath, nextRoundToProcess, currentRound);
      wroteCache = true;
    }

    if (closeTo1MBoundary(currentRound)) {
      const target = next1MBoundary(currentRound);
      console.log(`approaching 1M boundary at ${target}, waiting...`);
      await waitForBlock(algorand, target + ROUND_BUFFER);

      const from = crossed100KBoundary(nextRoundToProcess, currentRound) ? currentRound + 1 : nextRoundToProcess;
      currentRound = target;

      console.log(`1M boundary crossed, write-cache ${from}–${target}`);
      await runWriteCache(algorand, config.committeeGeneratorPath, from, target);
      wroteCache = true;
    }

    if (!wroteCache) break;

    saveState(config.stateDir, genesisHash, config.registryAppId, {
      lastProcessedRound: currentRound,
      updatedAt: new Date().toISOString(),
    });
  }
}
