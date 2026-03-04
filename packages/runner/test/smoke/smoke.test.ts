import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveState } from "../../state.ts";

// Mainnet genesis hash — must match what the runner computes from algod params.
const MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const REGISTRY_APP_ID = 3147789458;

describe("runner smoke test", () => {
  let fakeBinDir: string;
  let stateDir: string;

  beforeAll(async () => {
    fakeBinDir = mkdtempSync(join(tmpdir(), "fake-bin-"));

    // Fake systemd-notify so notifySystemd() doesn't fail outside systemd.
    const fakeNotify = join(fakeBinDir, "systemd-notify");
    writeFileSync(fakeNotify, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeNotify, 0o755);

    // Fake committee generator — sleeps 10s (~3 block times at 2.8s/block on mainnet) so that
    // when the runner re-loops after a catch-up, algod returns a round at least 2 ahead of the
    // saved lastProcessedRound, satisfying the nextRoundToProcess < currentRound precondition.
    const fakeGenerator = join(fakeBinDir, "committee-generator.js");
    writeFileSync(fakeGenerator, "setTimeout(() => process.exit(0), 10_000);\n");

    stateDir = mkdtempSync(join(tmpdir(), "runner-state-"));

    // Pre-populate state so the runner doesn't throw on state === null
    const resp = await fetch("https://mainnet-api.4160.nodely.dev/v2/transactions/params");
    const data = (await resp.json()) as { "last-round": number };
    saveState(stateDir, MAINNET_GENESIS_HASH, REGISTRY_APP_ID, {
      lastProcessedRound: data["last-round"] - 2, // seed 2 blocks behind
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
      COMMITTEE_GENERATOR_PATH: join(fakeBinDir, "committee-generator.js"),
    };
  }

  it("starts and exits 0 with expected output", () => {
    // Spawns the runner as a subprocess and verifies it boots, prints the expected startup banner, and exits cleanly.
    const result = spawnSync("node", ["--import", "tsx/esm", "index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      encoding: "utf8",
      env: baseEnv(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Runner started successfully");
  });

  it("respects env overrides in the startup banner", () => {
    // Verifies that environment variables override default config values in the startup banner.
    // Note: run() will fail (fake algod server), so we only assert on stdout, not exit code.
    const result = spawnSync("node", ["--import", "tsx/esm", "index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      encoding: "utf8",
      env: {
        ...baseEnv(),
        ALGOD_SERVER: "https://custom-node.example.com",
        ALGOD_PORT: "8443",
        REGISTRY_APP_ID: "999",
      },
    });
    expect(result.stdout).toContain("https://custom-node.example.com:8443");
    expect(result.stdout).toContain("999");
  });

  it("logs catch-up message and exits cleanly when a 100K boundary was crossed", { timeout: 30_000 }, () => {
    // Force a stale state (round 0) so the runner sees at least one 100K boundary crossed.
    saveState(stateDir, MAINNET_GENESIS_HASH, REGISTRY_APP_ID, {
      lastProcessedRound: 0,
      updatedAt: new Date().toISOString(),
    });

    const result = spawnSync("node", ["--import", "tsx/esm", "index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      encoding: "utf8",
      env: baseEnv(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("100K boundary crossed");
  });
});
