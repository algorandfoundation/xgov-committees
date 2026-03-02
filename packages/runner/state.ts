import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

interface RunnerState {
  lastProcessedRound: number;
  updatedAt: string; // ISO timestamp
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
  } catch {
    return null;
  }
}

export function saveState(stateDir: string, genesisHash: string, registryAppId: number, state: RunnerState): void {
  const filePath = stateFilePath(stateDir, genesisHash, registryAppId);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, filePath);
}
