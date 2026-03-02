import { mkdirSync } from "node:fs";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { type Config } from "./config.ts";
import { loadState, saveState } from "./state.ts";

export async function run(config: Config): Promise<void> {
  const algorand = AlgorandClient.fromConfig({
    algodConfig: {
      server: config.algodServer,
      port: config.algodPort,
      token: config.algodToken,
    },
  });

  mkdirSync(config.stateDir, { recursive: true });

  // Conditions are evaluated at the start of each iteration and again after any action,
  // so that a newly triggered condition (e.g. approaching 1M) is caught before exiting.
  while (true) {
    const params = await algorand.client.algod.getTransactionParams().do();
    const genesisHash: string = Buffer.from(params.genesisHash).toString("base64");
    const lastRound: number = Number(params.firstValid);

    const state = loadState(config.stateDir, genesisHash, config.registryAppId);

    console.log(`genesis: ${genesisHash}, registry: ${config.registryAppId}`);
    console.log(`last round: ${lastRound}, last processed: ${state?.lastProcessedRound ?? "none (first run)"}`);

    // TODO: if % 1M round ...
    // TODO: if % 100K round ...
    // TODO: else, exit cleanly

    saveState(config.stateDir, genesisHash, config.registryAppId, {
      lastProcessedRound: lastRound,
      updatedAt: new Date().toISOString(),
    });

    break;
  }
}
