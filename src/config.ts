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
};

// Load environment variables from .env file
dotenv.config({ quiet: true, path: process.env.ENV });

const argvConfig = [
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
    name: "data-path",
    short: "d",
    type: "string",
    description: "path to cache block responses",
    envVar: "DATA_PATH",
    defaultValue: "data/",
  },

  {
    name: "concurrency",
    short: "c",
    type: "number",
    description: "number of concurrent requests to maintain",
    envVar: "CONCURRENCY",
    defaultValue: 1,
  },
];

function parseDefault(type: string, value: string | undefined, defaultValue: string | number | undefined) {
  if (value !== undefined) {
    if (type === "number") {
      return parseInt(value, 10)
    } else {
      return value
    }
  }
  return defaultValue
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
