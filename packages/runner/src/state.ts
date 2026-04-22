import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/**
 * @property startRound - period start block (inclusive); Bi in the xGov docs
 * @property endRound - period end block (exclusive); Bf in the xGov docs
 *
 * startRound and endRound must be multiples of 1M and satisfy startRound < endRound.
 * The range `endRound - startRound` is the committee selection range, currently 3M blocks - {@link COMMITTEE_SELECTION_RANGE}
 * The first ever governance period is [50M; 53M) - {@link INITIAL_PERIOD}
 * The cohort validity is currently 1M blocks. The cohort validity range is the offset between two consecutive governance periods - {@link COHORT_VALIDITY_RANGE}.
 */
export interface GovernancePeriod {
  startRound: number;
  endRound: number;
}

export const COMMITTEE_SELECTION_RANGE = 3_000_000;
export const COHORT_VALIDITY_RANGE = 1_000_000;
export const INITIAL_PERIOD: GovernancePeriod = {
  startRound: 50_000_000,
  endRound: 50_000_000 + COMMITTEE_SELECTION_RANGE,
};

/**
 * Persisted state of the runner for a given network (`genesisHash`) and registry (`registryAppId`).
 * @property lastGovernancePeriod - the last fully processed governance period
 * @property lastCacheRound - last round at which a successful write-cache call was made
 * @property updatedAt - ISO timestamp of last update
 */
export interface RunnerState {
  lastGovernancePeriod: GovernancePeriod;
  lastCacheRound: number;
  updatedAt: string;
}

function stateFilePath(stateDir: string, genesisHash: string, registryAppId: number): string {
  // Sanitize base64 chars unsafe in filenames ('/' and '='). Consistent with committee-generator.
  const safeHash = genesisHash.replace(/[/=]/g, "_");
  return join(stateDir, `${safeHash}-${registryAppId}.json`);
}

export function loadState(stateDir: string, genesisHash: string, registryAppId: number): RunnerState | null {
  const filePath = stateFilePath(stateDir, genesisHash, registryAppId);
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as RunnerState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err; // permission error, malformed JSON, disk error, etc.
  }
}

export function saveState(stateDir: string, genesisHash: string, registryAppId: number, state: RunnerState): void {
  const filePath = stateFilePath(stateDir, genesisHash, registryAppId);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, filePath);
}
