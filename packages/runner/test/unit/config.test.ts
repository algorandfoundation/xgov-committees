import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts reads process.env at module-load time (via dotenv + direct access).
// Each test uses vi.doMock + vi.resetModules + dynamic import for isolation.

const CONFIG_KEYS = [
  "ALGOD_SERVER",
  "ALGOD_PORT",
  "ALGOD_TOKEN",
  "REGISTRY_APP_ID",
  "STATE_DIR",
  "COMMITTEE_GENERATOR_PATH",
] as const;

describe("config env var branches", () => {
  let savedEnv: Partial<Record<string, string>>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of CONFIG_KEYS) {
      savedEnv[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const k of CONFIG_KEYS) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
    vi.doUnmock("dotenv");
    vi.resetModules();
  });

  it("uses hardcoded defaults when env vars are absent and dotenv loads nothing", async () => {
    // Mock dotenv so the .env file in the repo doesn't populate process.env.
    vi.doMock("dotenv", () => ({ default: { config: vi.fn() } }));
    vi.resetModules();

    for (const k of CONFIG_KEYS) delete process.env[k];

    const { config } = await import("../../src/config.ts");
    expect(config.algodServer).toBe("https://mainnet-api.4160.nodely.dev");
    expect(config.algodPort).toBe(443);
    expect(config.algodToken).toBe("");
    expect(config.registryAppId).toBe(3147789458);
    expect(config.stateDir).toBe("/var/lib/xgov-committees-runner");
    expect(config.committeeGeneratorPath).toBe("/opt/xgov-committees/packages/committee-generator/dist/index.js");
  });

  it("reads all values from env vars when they are set", async () => {
    process.env.ALGOD_SERVER = "https://custom.example.com";
    process.env.ALGOD_PORT = "8443";
    process.env.ALGOD_TOKEN = "my-token";
    process.env.REGISTRY_APP_ID = "12345";
    process.env.STATE_DIR = "/custom/state";
    process.env.COMMITTEE_GENERATOR_PATH = "/custom/generator.js";

    vi.resetModules();

    const { config } = await import("../../src/config.ts");
    expect(config.algodServer).toBe("https://custom.example.com");
    expect(config.algodPort).toBe(8443);
    expect(config.algodToken).toBe("my-token");
    expect(config.registryAppId).toBe(12345);
    expect(config.stateDir).toBe("/custom/state");
    expect(config.committeeGeneratorPath).toBe("/custom/generator.js");
  });
});
