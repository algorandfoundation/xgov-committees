import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WATCHDOG_INTERVAL_MS } from "../../watchdog.ts";

// vi.mock is hoisted before imports, so watchdog.ts gets the mocked spawnSync.
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

import { notifySystemd, startWatchdog } from "../../watchdog.ts";

describe("watchdog", () => {
  const mockSpawnSync = vi.mocked(spawnSync);

  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ error: null, status: 0 } as unknown as ReturnType<typeof spawnSync>);
  });

  afterEach(() => {
    // Restore real timers so fake timer state doesn't leak into other tests.
    vi.useRealTimers();
  });

  describe("notifySystemd", () => {
    it("calls systemd-notify with the given message", () => {
      notifySystemd("READY=1");
      expect(mockSpawnSync).toHaveBeenCalledWith("systemd-notify", ["READY=1"], { stdio: "ignore" });
    });

    it("throws when systemd-notify returns a spawn error", () => {
      mockSpawnSync.mockReturnValue({ error: new Error("error message"), status: null } as unknown as ReturnType<
        typeof spawnSync
      >);
      expect(() => notifySystemd("READY=1")).toThrow("error message");
    });

    it("throws when systemd-notify exits with a non-zero status", () => {
      mockSpawnSync.mockReturnValue({ error: null, status: 1 } as unknown as ReturnType<typeof spawnSync>);
      expect(() => notifySystemd("READY=1")).toThrow("exit 1");
    });
  });

  describe("startWatchdog", () => {
    it("sends WATCHDOG=1 at the configured interval", () => {
      vi.useFakeTimers();
      const handle = startWatchdog();
      vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS + 1);
      clearInterval(handle);
      expect(mockSpawnSync).toHaveBeenCalledWith("systemd-notify", ["WATCHDOG=1"], {
        stdio: "ignore",
      });
    });
  });
});
