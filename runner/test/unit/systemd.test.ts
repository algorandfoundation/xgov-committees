import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, expect, it } from "vitest";

describe("systemd units", () => {
  assert(
    spawnSync("systemd-analyze", ["--version"], { timeout: 3000 }).status === 0,
    "systemd-analyze is required (run via pnpm test:unit)",
  );

  it("pass systemd-analyze verify", () => {
    // Catches syntax errors, unknown directives, missing users, and bad ExecStart paths.
    const unitsDir = join(import.meta.dirname, "../../systemd");
    const result = spawnSync(
      "systemd-analyze",
      ["verify", "--man=no", join(unitsDir, "runner.service"), join(unitsDir, "runner.timer")],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("timer has a matching service unit", () => {
    // The timer relies on naming convention (runner.timer → runner.service).
    // Verify both files exist so a rename doesn't silently break the pairing.
    const unitsDir = join(import.meta.dirname, "../../systemd");
    const files = readdirSync(unitsDir);
    const timers = files.filter((f) => f.endsWith(".timer"));
    for (const timer of timers) {
      const service = timer.replace(/\.timer$/, ".service");
      expect(files, `${timer} expects ${service}`).toContain(service);
    }
  });
});
