import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, saveState } from "../../state.ts";

const GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const REGISTRY_APP_ID = 3147789458;

describe("state", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "runner-state-test-"));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  describe("loadState", () => {
    it("returns null when no state file exists", () => {
      expect(loadState(stateDir, GENESIS_HASH, REGISTRY_APP_ID)).toBeNull();
    });

    it("throws on corrupt state file", () => {
      const safeHash = GENESIS_HASH.replace(/[/=]/g, "_");
      writeFileSync(join(stateDir, `${safeHash}-${REGISTRY_APP_ID}.json`), "not json");
      expect(() => loadState(stateDir, GENESIS_HASH, REGISTRY_APP_ID)).toThrow();
    });

    it("returns the saved state when a file exists", () => {
      const state = { lastProcessedRound: 58000000, updatedAt: "2026-01-01T00:00:00.000Z" };
      saveState(stateDir, GENESIS_HASH, REGISTRY_APP_ID, state);
      expect(loadState(stateDir, GENESIS_HASH, REGISTRY_APP_ID)).toEqual(state);
    });
  });

  describe("saveState", () => {
    it("writes the correct JSON", () => {
      const state = { lastProcessedRound: 58000000, updatedAt: "2026-01-01T00:00:00.000Z" };
      saveState(stateDir, GENESIS_HASH, REGISTRY_APP_ID, state);
      expect(loadState(stateDir, GENESIS_HASH, REGISTRY_APP_ID)).toEqual(state);
    });

    it("overwrites an existing state file", () => {
      saveState(stateDir, GENESIS_HASH, REGISTRY_APP_ID, {
        lastProcessedRound: 58000000,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      saveState(stateDir, GENESIS_HASH, REGISTRY_APP_ID, {
        lastProcessedRound: 58100000,
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
      expect(loadState(stateDir, GENESIS_HASH, REGISTRY_APP_ID)?.lastProcessedRound).toBe(58100000);
    });

    it("does not leave a .tmp file behind", () => {
      const state = { lastProcessedRound: 58000000, updatedAt: "2026-01-01T00:00:00.000Z" };
      saveState(stateDir, GENESIS_HASH, REGISTRY_APP_ID, state);
      const safeHash = GENESIS_HASH.replace(/[/=]/g, "_");
      expect(existsSync(join(stateDir, `${safeHash}-${REGISTRY_APP_ID}.json.tmp`))).toBe(false);
    });

    it("uses separate files for different registry app IDs", () => {
      saveState(stateDir, GENESIS_HASH, REGISTRY_APP_ID, {
        lastProcessedRound: 100,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      saveState(stateDir, GENESIS_HASH, 999, {
        lastProcessedRound: 200,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(loadState(stateDir, GENESIS_HASH, REGISTRY_APP_ID)?.lastProcessedRound).toBe(100);
      expect(loadState(stateDir, GENESIS_HASH, 999)?.lastProcessedRound).toBe(200);
    });

    it("uses separate files for different genesis hashes", () => {
      const otherGenesisHash = "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
      saveState(stateDir, GENESIS_HASH, REGISTRY_APP_ID, {
        lastProcessedRound: 100,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      saveState(stateDir, otherGenesisHash, REGISTRY_APP_ID, {
        lastProcessedRound: 200,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(loadState(stateDir, GENESIS_HASH, REGISTRY_APP_ID)?.lastProcessedRound).toBe(100);
      expect(loadState(stateDir, otherGenesisHash, REGISTRY_APP_ID)?.lastProcessedRound).toBe(200);
    });
  });
});
