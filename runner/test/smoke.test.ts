import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("runner smoke test", () => {
  // Spawns the runner as a subprocess and verifies it boots, prints the expected startup banner, and exits cleanly.
  it("starts and exits 0 with expected output", () => {
    const result = spawnSync("node", ["--import", "tsx/esm", "index.ts"], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Runner started successfully");
  });

  it("respects env overrides", () => {
    // Verifies that environment variables override default config values.
    const result = spawnSync("node", ["--import", "tsx/esm", "index.ts"], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        ALGOD_SERVER: "https://custom-node.example.com",
        ALGOD_PORT: "8443",
        REGISTRY_APP_ID: "999",
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("https://custom-node.example.com:8443");
    expect(result.stdout).toContain("999");
  });
});
