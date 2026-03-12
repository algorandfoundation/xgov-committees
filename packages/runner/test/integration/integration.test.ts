import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveState } from "../../src/state.ts";

const MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const REGISTRY_APP_ID = 3147789458;
const REGISTRY_CREATION_ROUND = 52307574;
const FIXTURES = join(import.meta.dirname, "fixtures");
const RUNNER_ROOT = join(import.meta.dirname, "../..");

describe("runner", () => {
  let fakeBinDir: string; // holds systemd-notify stub, added to PATH
  let stateDir: string;

  beforeAll(async () => {
    fakeBinDir = mkdtempSync(join(tmpdir(), "fake-bin-"));
    const fakeNotify = join(fakeBinDir, "systemd-notify");
    writeFileSync(fakeNotify, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeNotify, 0o755);

    stateDir = mkdtempSync(join(tmpdir(), "runner-state-"));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10_000);
    let resp: Response;
    try {
      resp = await fetch("https://mainnet-api.4160.nodely.dev/v2/transactions/params", {
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
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

  function runRunner(env: NodeJS.ProcessEnv, timeout?: number) {
    return spawnSync("node", ["--import", "tsx/esm", "src/index.ts"], {
      cwd: RUNNER_ROOT,
      encoding: "utf8",
      timeout,
      env,
    });
  }

  function seedStaleState() {
    saveState(stateDir, MAINNET_GENESIS_HASH, REGISTRY_APP_ID, {
      lastProcessedRound: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  function waitForPid(pidFile: string): Promise<number> {
    return new Promise((resolve, reject) => {
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
  }

  it("bootstraps state from registry creation round when no state file exists", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "runner-bootstrap-"));
    try {
      const result = runRunner({
        ...baseEnv(),
        STATE_DIR: freshDir,
        COMMITTEE_GENERATOR_PATH: join(FIXTURES, "instant-generator.js"),
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`bootstrapping from round ${REGISTRY_CREATION_ROUND}`);
      const stateFiles = readdirSync(freshDir).filter((f) => f.endsWith(".json"));
      expect(stateFiles).toHaveLength(1);
      const state = JSON.parse(readFileSync(join(freshDir, stateFiles[0]), "utf8"));
      expect(state.lastProcessedRound).toBeGreaterThan(0);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it("exits 0 with startup banner when no boundary is crossed", () => {
    const result = runRunner(baseEnv());
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Runner started successfully");
  });

  it("run() error exits with code 1", () => {
    const result = runRunner({
      ...baseEnv(),
      ALGOD_SERVER: "https://nonexistent.example.invalid",
      ALGOD_PORT: "9999",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("run() failed");
  });

  it("escalates to SIGKILL after grace period when generator ignores SIGTERM", { timeout: 20_000 }, async () => {
    const pidFile = join(stateDir, "stubborn.pid");
    seedStaleState();

    const runner = spawn("node", ["--import", "tsx/esm", "src/index.ts"], {
      cwd: RUNNER_ROOT,
      env: {
        ...baseEnv(),
        COMMITTEE_GENERATOR_PATH: join(FIXTURES, "sigterm-ignoring-generator.mjs"),
        PID_FILE: pidFile,
      },
    });

    const childPid = await waitForPid(pidFile);
    runner.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolve) => runner.on("close", (code) => resolve(code)));

    expect(exitCode).toBe(0);
    expect(() => process.kill(childPid, 0)).toThrow(); // child was killed, not orphaned
  });

  it("exits 0 on SIGTERM and does not orphan the generator", { timeout: 30_000 }, async () => {
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

    const childPid = await waitForPid(pidFile);
    runner.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolve) => runner.on("close", (code) => resolve(code)));

    expect(exitCode).toBe(0);
    expect(() => process.kill(childPid, 0)).toThrow(); // child was killed, not orphaned
  });
});

describe("notify-slack", () => {
  const NOTIFY_SCRIPT = join(RUNNER_ROOT, "dist", "notify-slack.js");

  it("exits 0 silently when service-result is success", () => {
    const result = spawnSync(
      "node",
      [NOTIFY_SCRIPT, "--exit-status", "0", "--service-result", "success", "--hostname", "test"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("exits 1 when Slack env vars are missing and service-result is not success", () => {
    const result = spawnSync(
      "node",
      [NOTIFY_SCRIPT, "--exit-status", "1", "--service-result", "exit-code", "--hostname", "test"],
      { encoding: "utf8", env: { ...process.env, SLACK_BOT_TOKEN: "", SLACK_CHANNEL_ID: "" } },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required env vars");
  });

  it("exits 1 when required args are missing", () => {
    const result = spawnSync("node", [NOTIFY_SCRIPT], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });

  const hasSlackCreds = !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);

  it.skipIf(!hasSlackCreds)("exits 0 with valid Slack credentials", () => {
    const result = spawnSync(
      "node",
      [NOTIFY_SCRIPT, "--exit-status", "1", "--service-result", "exit-code", "--hostname", "integration-test"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
          SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
        },
      },
    );
    expect(result.status).toBe(0);
  });
});
