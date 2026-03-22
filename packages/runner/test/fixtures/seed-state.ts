/**
 * Seeds a runner state file. Used by systemd tests where the goal is to test
 * the systemd lifecycle, not the service logic.
 *
 * Usage:
 *   node --import tsx/esm seed-state.ts             # recent state (no catch-up, quick exit)
 *   node --import tsx/esm seed-state.ts --catch-up  # stale state (triggers catch-up)
 */
import { saveState, COMMITTEE_SELECTION_RANGE } from "../../src/state.ts";

const MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const REGISTRY_APP_ID = 3147789458;
const STATE_DIR = process.env.STATE_DIR ?? "/var/lib/xgov-committees-runner";
const ALGOD_SERVER = process.env.ALGOD_SERVER ?? "https://mainnet-api.4160.nodely.dev";
const ALGOD_PORT = process.env.ALGOD_PORT ?? "443";
const catchUp = process.argv.includes("--catch-up");

const resp = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/transactions/params`);
const { "last-round": lastRound } = (await resp.json()) as { "last-round": number };
const lastBf = Math.floor(lastRound / 1e6) * 1e6;

if (catchUp) {
  // Two periods behind the current chain tip - enough to trigger catch-up and spawn the generator.
  const Bf = lastBf - 2e6;
  const Bi = Bf - COMMITTEE_SELECTION_RANGE;
  saveState(STATE_DIR, MAINNET_GENESIS_HASH, REGISTRY_APP_ID, {
    lastGovernancePeriod: { Bi, Bf },
    lastCacheRound: Bf,
    updatedAt: new Date().toISOString(),
  });
  console.log(`Seeded catch-up state: (${Bi}, ${Bf}), lastCacheRound=${Bf}`);
} else {
  saveState(STATE_DIR, MAINNET_GENESIS_HASH, REGISTRY_APP_ID, {
    lastGovernancePeriod: { Bi: lastBf - COMMITTEE_SELECTION_RANGE, Bf: lastBf },
    lastCacheRound: lastRound - 2,
    updatedAt: new Date().toISOString(),
  });
  console.log(`Seeded state: (${lastBf - COMMITTEE_SELECTION_RANGE}, ${lastBf}), lastCacheRound=${lastRound - 2}`);
}
