import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assert, describe, expect, it } from "vitest";

describe("systemd integration", () => {
  assert(spawnSync("docker", ["info"], { timeout: 5000 }).status === 0, "Docker is required");

  it("runner service starts, sends READY=1, and exits 0", { timeout: 180_000 }, () => {
    // Builds a systemd+Node.js Docker image, boots with runner.timer enabled,
    // and verifies the service exits with Result=success and the expected log banner.
    const result = spawnSync("bash", [join(import.meta.dirname, "run-container.sh")], {
      encoding: "utf8",
    });
    const log = [result.stdout, result.stderr].filter(Boolean).join("\n---\n");
    expect(result.status, log).toBe(0);
  });
});
