import { config } from "./config.ts";
import { notifySystemd, startWatchdog } from "./watchdog.ts";
import { run, getActiveChild } from "./service.ts";

console.log("xgov-committees-runner starting...");
console.log(`  algod:      ${config.algodServer}:${config.algodPort}`);
console.log(`  registry:   ${config.registryAppId}`);
console.log("Runner started successfully.");

const GENERATOR_SIGTERM_GRACE_MS = 40_000;

let shuttingDown = false;

/** Single entry point for all shutdown paths: SIGTERM, watchdog failure, run() completion or error. */
async function shutdown(reason: string, exitCode: number): Promise<never> {
  if (shuttingDown) process.exit(exitCode);
  shuttingDown = true;

  try {
    notifySystemd(`STOPPING=1\nSTATUS=Shutting down: ${reason}`);
  } catch {
    // best effort
  }

  clearInterval(watchdogHandle);
  console.log(`Shutting down (${reason})`);

  const child = getActiveChild();
  if (child) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, GENERATOR_SIGTERM_GRACE_MS);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  process.exit(exitCode);
}

notifySystemd("READY=1");
const watchdogHandle = startWatchdog((err) => {
  shutdown(`watchdog failure: ${err.message}`, 1);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM", 0);
});

try {
  await run(config);
  await shutdown("run() completed", 0);
} catch (err) {
  if (!shuttingDown) await shutdown(`run() failed: ${err instanceof Error ? err.message : err}`, 1);
}
