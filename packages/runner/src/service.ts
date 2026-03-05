import { mkdirSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { type Config } from "./config.ts";
import { loadState, saveState } from "./state.ts";
import { crossed100KBoundary, closeTo1MBoundary, next1MBoundary } from "./utils.ts";

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
 * Spawns the committee generator in write-cache mode for blocks [fromBlock, toBlock].
 * Resolves "success" (exit 0) or "tip" (exit 10, chain tip reached before toBlock).
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
 * Runs the service loop until all run conditions are handled.
 * Re-evaluates after each action in case new run conditions are met (e.g. 100K sync may get close to 1M boundary).
 * If committee generator signals it reached the tip, exits the loop without mutating state.
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
    let reRun = false;
    const params = await algorand.client.algod.getTransactionParams().do();
    const genesisHash = Buffer.from(params.genesisHash).toString("base64");
    let currentRound = Number(params.firstValid);

    const state = loadState(config.stateDir, genesisHash, config.registryAppId);
    if (state === null) {
      // TODO: handle warm up
      throw new Error("No existing state file found - This case needs implementation");
    }
    const nextRoundToProcess = state.lastProcessedRound + 1;

    if (runCounter === 1) console.log(`genesis: ${genesisHash}, registry: ${config.registryAppId}`);
    console.log(`[#${runCounter}] round ${currentRound}, next to process: ${nextRoundToProcess}`);

    if (currentRound <= nextRoundToProcess) {
      throw new Error(
        `algod returned round ${currentRound} which is not ahead of the next round to process ${nextRoundToProcess}`,
      );
    }

    if (crossed100KBoundary(nextRoundToProcess, currentRound)) {
      console.log(`100K boundary crossed, write-cache ${nextRoundToProcess}–${currentRound}`);
      const result = await spawnWriteCache(config.committeeGeneratorPath, nextRoundToProcess, currentRound);
      if (result === "tip") {
        console.log("generator reached chain tip, pausing until next run");
        break;
      }
      reRun = true;
    }

    if (closeTo1MBoundary(currentRound)) {
      const target = next1MBoundary(currentRound);
      console.log(`approaching 1M boundary at ${target}, waiting...`);
      await algorand.client.algod.statusAfterBlock(target).do();

      const from = crossed100KBoundary(nextRoundToProcess, currentRound) ? currentRound + 1 : nextRoundToProcess;
      currentRound = target;

      console.log(`1M boundary crossed, write-cache ${from}–${target}`);
      const result = await spawnWriteCache(config.committeeGeneratorPath, from, target);
      if (result === "tip") {
        console.log("generator reached chain tip, pausing until next run");
        break;
      }
      reRun = true;
    }

    saveState(config.stateDir, genesisHash, config.registryAppId, {
      lastProcessedRound: currentRound,
      updatedAt: new Date().toISOString(),
    });

    // all caught up, exit
    if (!reRun) break;
  }
}
