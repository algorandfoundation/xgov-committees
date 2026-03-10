import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveState } from "../../src/state.ts";

const MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const REGISTRY_APP_ID = 3147789458;
const FIXTURES = join(import.meta.dirname, "fixtures");
const RUNNER_ROOT = join(import.meta.dirname, "../..");

describe("runner smoke test", () => {
  let fakeBinDir: string; // holds systemd-notify stub, added to PATH
  let stateDir: string;

  beforeAll(async () => {
    fakeBinDir = mkdtempSync(join(tmpdir(), "fake-bin-"));
    const fakeNotify = join(fakeBinDir, "systemd-notify");
    writeFileSync(fakeNotify, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeNotify, 0o755);

    stateDir = mkdtempSync(join(tmpdir(), "runner-state-"));
    const resp = await fetch("https://mainnet-api.4160.nodely.dev/v2/transactions/params");
    const { "last-round": lastRound } = (await resp.json()) as { "last-round": number };
    // Seed 2 blocks behind tip so tests with no boundary crossed exit cleanly.
    saveState(stateDir, MAINNET_GENESIS_HASH, REGISTRY_APP_ID, {
      lastProcessedRound: lastRound - 2,
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(() => {
    rmSync(fakeBinDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  function baseEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      STATE_DIR: stateDir,
      COMMITTEE_GENERATOR_PATH: join(FIXTURES, "committee-generator.js"),
    };
  }

  function runRunner(env: NodeJS.ProcessEnv) {
    return spawnSync("node", ["--import", "tsx/esm", "src/index.ts"], {
      cwd: RUNNER_ROOT,
      encoding: "utf8",
      env,
    });
  }

  function seedStaleState(dir: string = stateDir) {
    saveState(dir, MAINNET_GENESIS_HASH, REGISTRY_APP_ID, {
      lastProcessedRound: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  it("starts and exits 0 with expected output", () => {
    const result = runRunner(baseEnv());
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Runner started successfully");
  });

  it("respects env overrides in the startup banner", () => {
    // run() will fail (unreachable algod) — only assert on stdout, not exit code.
    const result = runRunner({
      ...baseEnv(),
      ALGOD_SERVER: "https://custom-node.example.com",
      ALGOD_PORT: "8443",
      REGISTRY_APP_ID: "999",
    });
    expect(result.stdout).toContain("https://custom-node.example.com:8443");
    expect(result.stdout).toContain("999");
  });

  it("exits 0 on SIGTERM while generator is running and does not orphan child", { timeout: 30_000 }, async () => {
    const pidFile = join(stateDir, "generator.pid");
    seedStaleState();

    const runner = spawn("node", ["--import", "tsx/esm", "src/index.ts"], {
      cwd: RUNNER_ROOT,
      env: {
        ...baseEnv(),
        COMMITTEE_GENERATOR_PATH: join(FIXTURES, "slow-generator.mjs"),
        PID_FILE: pidFile,
      },
    });

    const childPid = await new Promise<number>((resolve, reject) => {
      const poll = setInterval(() => {
        try {
          resolve(parseInt(readFileSync(pidFile, "utf8")));
          clearInterval(poll);
          clearTimeout(timeout);
        } catch {
          /* not yet */
        }
      }, 50);
      const timeout = setTimeout(() => {
        clearInterval(poll);
        reject(new Error("timed out waiting for generator PID file"));
      }, 10_000);
    });

    runner.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolve) => runner.on("close", (code) => resolve(code)));

    expect(exitCode).toBe(0);
    expect(() => process.kill(childPid, 0)).toThrow(); // child was killed, not orphaned
  });
});
