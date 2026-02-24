import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, expect, it } from "vitest";

describe("systemd units", () => {
  assert(spawnSync("docker", ["info"], { timeout: 5000 }).status === 0, "Docker is required");

  it("pass systemd-analyze verify", () => {
    // Runs systemd-analyze verify inside Docker to catch syntax errors, missing users, and invalid directives in the unit files.
    const result = spawnSync("bash", [join(import.meta.dirname, "verify-systemd.sh")], { encoding: "utf8" });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("timer has a matching service unit", () => {
    // The timer relies on naming convention (runner.timer → runner.service). Verify both files exist so a rename doesn't silently break the pairing.
    const unitsDir = join(import.meta.dirname, "..", "systemd");
    const files = readdirSync(unitsDir);
    const timers = files.filter((f) => f.endsWith(".timer"));
    for (const timer of timers) {
      const service = timer.replace(/\.timer$/, ".service");
      expect(files, `${timer} expects ${service}`).toContain(service);
    }
  });
});
