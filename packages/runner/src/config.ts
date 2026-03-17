import "./env.ts";

export interface Config {
  algodServer: string;
  algodPort: number;
  algodToken: string;
  registryAppId: number;
  stateDir: string;
  committeeGeneratorPath: string;
}

const DEFAULT_CONFIG: Config = {
  algodServer: "https://mainnet-api.4160.nodely.dev",
  algodPort: 443,
  algodToken: "",
  registryAppId: 3147789458,
  stateDir: "/var/lib/xgov-committees-runner",
  committeeGeneratorPath: "/opt/xgov-committees/packages/committee-generator/dist/index.js",
};

export const config: Config = {
  algodServer: process.env.ALGOD_SERVER ?? DEFAULT_CONFIG.algodServer,
  algodPort: process.env.ALGOD_PORT ? parseInt(process.env.ALGOD_PORT, 10) : DEFAULT_CONFIG.algodPort,
  algodToken: process.env.ALGOD_TOKEN ?? DEFAULT_CONFIG.algodToken,
  registryAppId: process.env.REGISTRY_APP_ID ? parseInt(process.env.REGISTRY_APP_ID, 10) : DEFAULT_CONFIG.registryAppId,
  stateDir: process.env.STATE_DIR ?? DEFAULT_CONFIG.stateDir,
  committeeGeneratorPath: process.env.COMMITTEE_GENERATOR_PATH ?? DEFAULT_CONFIG.committeeGeneratorPath,
};
