import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { type Config } from "./config.ts";
import { loadState, saveState } from "./state.ts";
import { crossed100KBoundary, closeTo1MBoundary, next1MBoundary } from "./utils.ts";

/**
 * Spawns the committee generator in "write-cache" mode to process blocks `fromBlock` `toBlock`.
 * TODO: check inclusive/exclusive and adjust runner logic or generator args accordingly.
 * @returns A promise that resolves when the process completes successfully, or rejects if an error occurs.
 */
function spawnWriteCache(path: string, fromBlock: number, toBlock: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [path, "--mode", "write-cache", "--from-block", String(fromBlock), "--to-block", String(toBlock)],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`committee-generator failed: (${code !== null ? `exit code ${code}` : `signal ${signal}`})`));
    });
  });
}

/**
 * Runs the service loop until all run conditions are handled.
 * Re-evaluates after each action in case new run conditions are met (e.g. 100K sync may get close to 1M boundary).
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
      await spawnWriteCache(config.committeeGeneratorPath, nextRoundToProcess, currentRound);
      reRun = true;
    }

    if (closeTo1MBoundary(currentRound)) {
      const target = next1MBoundary(currentRound);
      console.log(`approaching 1M boundary at ${target}, waiting...`);
      await algorand.client.algod.statusAfterBlock(target).do();

      const from = crossed100KBoundary(nextRoundToProcess, currentRound) ? currentRound + 1 : nextRoundToProcess;
      currentRound = target;

      console.log(`1M boundary crossed, write-cache ${from}–${target}`);
      await spawnWriteCache(config.committeeGeneratorPath, from, target);
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
