import dotenv from "dotenv";
import yargs from "yargs";
import type { PositionalOptionsType } from "yargs";
import { hideBin } from "yargs/helpers";

export type Config = {
  algodServer: string;
  algodPort: number;
  algodToken: string;
  fromBlock: number;
  toBlock: number;
  dataPath: string;
  concurrency: number;
  verbose: boolean;
};

// Load environment variables from .env file
dotenv.config({ quiet: true, path: process.env.ENV });

const argvConfig = [
  {
    name: "registry-app-id",
    short: "a",
    type: "number",
    description: "xGov Registry App ID",
    envVar: "REGISTRY_APP_ID",
    defaultValue: 3147789458, // Mainnet registry
  },
  {
    name: "from-block",
    short: "f",
    type: "number",
    required: true,
    description: "first block to process",
    envVar: "FIRST_BLOCK",
  },
  {
    name: "to-block",
    short: "t",
    type: "number",
    required: true,
    description: "last block to process",
    envVar: "LAST_BLOCK",
  },
  {
    name: "cutoff-block",
    short: "c",
    type: "number",
    required: true,
    description: "xGov subscriptions cutoff block",
    envVar: "CUTOFF_BLOCK",
  },
  {
    name: "concurrency",
    short: "C",
    type: "number",
    description: "number of concurrent requests to maintain",
    envVar: "CONCURRENCY",
    defaultValue: 1,
  },
  {
    name: "algod-server",
    short: "s",
    type: "string",
    description: "algod server hostname",
    envVar: "ALGOD_SERVER",
    defaultValue: "https://mainnet-api.4160.nodely.dev",
  },
  {
    name: "algod-port",
    short: "p",
    type: "number",
    description: "algod server port",
    envVar: "ALGOD_PORT",
    defaultValue: 443,
  },
  {
    name: "algod-token",
    short: "T",
    type: "string",
    description: "algod server token",
    envVar: "ALGOD_TOKEN",
    defaultValue: "",
  },
  {
    name: "data-path",
    short: "d",
    type: "string",
    description: "path to cache block responses",
    envVar: "DATA_PATH",
    defaultValue: "data/",
  },
  {
    name: "verbose",
    short: "v",
    type: "boolean",
    description: "verbose mode",
    envVar: "VERBOSE",
    defaultValue: false,
  },
];

function parseDefault(
  type: string,
  value: string | undefined,
  defaultValue: string | number | boolean | undefined
) {
  if (value !== undefined) {
    if (type === "number") {
      return parseInt(value, 10);
    } else if (type === "boolean") {
      return Boolean(value);
    } else {
      return value;
    }
  }
  return defaultValue;
}

const parser = argvConfig.reduce(
  (
    parser,
    { name, short, type, description, required, envVar, defaultValue }
  ) => {
    return parser.option(name, {
      alias: short,
      description,
      demandOption: required,
      type: type as PositionalOptionsType,
      default: parseDefault(type, process.env[envVar], defaultValue),
    });
  },
  yargs(hideBin(process.argv))
);

export const config = parser.help().parseSync() as unknown as Config;

for(const argvConfigEntry of argvConfig) {
  const { name, type } = argvConfigEntry
  if (type !== "number")
    continue
  // @ts-ignore - kebabcase is not in type but is the easiest way to access from argvConfig entries
  const value = config[name]
  if (isNaN(value)) {
    console.error(`Configuration value "${name}" expected a number, found non-numeric value`)
    process.exit(1)
  }
}