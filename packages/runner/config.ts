import dotenv from "dotenv";

dotenv.config({ quiet: true, path: process.env.ENV });

interface Config {
  algodServer: string;
  algodPort: number;
  algodToken: string;
  registryAppId: number;
}

const DEFAULT_CONFIG: Config = {
  algodServer: "https://mainnet-api.4160.nodely.dev",
  algodPort: 443,
  algodToken: "",
  registryAppId: 3147789458,
};

export const config: Config = {
  algodServer: process.env.ALGOD_SERVER ?? DEFAULT_CONFIG.algodServer,
  algodPort: parseInt(process.env.ALGOD_PORT ?? DEFAULT_CONFIG.algodPort.toString(), 10),
  algodToken: process.env.ALGOD_TOKEN ?? DEFAULT_CONFIG.algodToken,
  registryAppId: parseInt(process.env.REGISTRY_APP_ID ?? DEFAULT_CONFIG.registryAppId.toString(), 10),
};
