/**
 * Code responsible for pinging the systemd watchdog to prevent it from killing the process.
 */

import { spawnSync } from "node:child_process";

// Value tied to `WatchdogSec=65` in the systemd service file
// Should have tolerance of ~1 missed ping + a margin
export const WATCHDOG_INTERVAL_MS = 30_000;

export function notifySystemd(msg: string): void {
  const { error, status } = spawnSync("systemd-notify", [msg], { stdio: "ignore" });
  if (error || status !== 0) {
    throw new Error(`systemd-notify failed: ${error?.message ?? `exit ${status}`}`);
  }
}

export function startWatchdog(): NodeJS.Timeout {
  return setInterval(() => notifySystemd("WATCHDOG=1"), WATCHDOG_INTERVAL_MS);
}
