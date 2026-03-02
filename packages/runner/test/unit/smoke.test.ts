import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("runner smoke test", () => {
  let fakeBinDir: string;
  let stateDir: string;

  beforeAll(() => {
    // Create a fake systemd-notify binary that exits 0, so notifySystemd() doesn't fail.
    fakeBinDir = mkdtempSync(join(tmpdir(), "fake-bin-"));
    const fakeBin = join(fakeBinDir, "systemd-notify");
    writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeBin, 0o755);

    stateDir = mkdtempSync(join(tmpdir(), "runner-state-"));
  });

  afterAll(() => {
    rmSync(fakeBinDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("starts and exits 0 with expected output", () => {
    // Spawns the runner as a subprocess and verifies it boots, prints the expected startup banner, and exits cleanly.
    const result = spawnSync("node", ["--import", "tsx/esm", "index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}`, STATE_DIR: stateDir },
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
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
        ALGOD_SERVER: "https://custom-node.example.com",
        ALGOD_PORT: "8443",
        REGISTRY_APP_ID: "999",
        STATE_DIR: stateDir,
      },
    });
    expect(result.stdout).toContain("https://custom-node.example.com:8443");
    expect(result.stdout).toContain("999");
  });
});
