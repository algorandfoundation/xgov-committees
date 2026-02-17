import dotenv from "dotenv";
import yargs from "yargs";
import type { PositionalOptionsType } from "yargs";
import { hideBin } from "yargs/helpers";

type CacheMode = "use-cache" | "validate-cache" | "write-cache";

export type Config = {
  cacheMode: CacheMode;
  registryAppId: number;
  fromBlock: number;
  toBlock: number;
  algodServer: string;
  algodPort: number;
  algodToken: string;
  dataPath: string;
  concurrency: number;
  verbose: boolean;

  s3: {
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    bucketName?: string;
    endpoint?: string;
  };
};

// Load environment variables from .env file
dotenv.config({ quiet: true, path: process.env.ENV });

const argvConfig = [
  {
    name: "cache-mode",
    short: "m",
    type: "string",
    description: "run mode: use-cache, validate-cache, write-cache",
    envVar: "MODE",
    defaultValue: "use-cache",
  },
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
  {
    name: "s3-access-key-id",
    short: "K",
    type: "string",
    description: "S3 access key ID",
    envVar: "S3_ACCESS_KEY_ID",
  },
  {
    name: "s3-secret-access-key",
    short: "W",
    type: "string",
    description: "S3 secret access key",
    envVar: "S3_SECRET_ACCESS_KEY",
  },
  {
    name: "s3-region",
    short: "R",
    type: "string",
    description: "S3 region",
    envVar: "S3_REGION",
    defaultValue: "auto",
  },
  {
    name: "s3-bucket-name",
    short: "B",
    type: "string",
    description: "S3 bucket name",
    envVar: "S3_BUCKET_NAME",
    defaultValue: "xgov-committees",
  },
  {
    name: "s3-endpoint",
    short: "E",
    type: "string",
    description: "S3 endpoint URL",
    envVar: "S3_ENDPOINT",
  },
];

function parseDefault(
  type: string,
  value: string | undefined,
  defaultValue: string | number | boolean | undefined,
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
    { name, short, type, description, required, envVar, defaultValue },
  ) => {
    return parser.option(name, {
      alias: short,
      description,
      demandOption: required,
      type: type as PositionalOptionsType,
      default: parseDefault(type, process.env[envVar], defaultValue),
    });
  },
  yargs(hideBin(process.argv)),
);

const parsedArgs = parser.help().parseSync();

// Validate numeric values before transformation
for (const argvConfigEntry of argvConfig) {
  const { name, type } = argvConfigEntry;
  if (type !== "number") continue;
  // @ts-ignore - kebab-case property access
  const value = parsedArgs[name];
  if (isNaN(value as number)) {
    console.error(
      `Configuration value "${name}" expected a number, found non-numeric value`,
    );
    process.exit(1);
  }
}

// Transform s3-* properties into nested s3 object
export const config: Config = {
  cacheMode: parsedArgs["cache-mode"] as CacheMode,
  registryAppId: parsedArgs["registry-app-id"] as number,
  fromBlock: parsedArgs["from-block"] as number,
  toBlock: parsedArgs["to-block"] as number,
  algodServer: parsedArgs["algod-server"] as string,
  algodPort: parsedArgs["algod-port"] as number,
  algodToken: parsedArgs["algod-token"] as string,
  dataPath: parsedArgs["data-path"] as string,
  concurrency: parsedArgs["concurrency"] as number,
  verbose: parsedArgs["verbose"] as boolean,
  s3: {
    accessKeyId: parsedArgs["s3-access-key-id"] as string | undefined,
    secretAccessKey: parsedArgs["s3-secret-access-key"] as string | undefined,
    region: parsedArgs["s3-region"] as string | undefined,
    bucketName: parsedArgs["s3-bucket-name"] as string | undefined,
    endpoint: parsedArgs["s3-endpoint"] as string | undefined,
  },
};
