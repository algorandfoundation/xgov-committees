import { readFile, writeFile, readdir } from "fs/promises";
import { mkdirSync } from "fs";
import { join } from "path";
import { NetworkIDs } from "./algod";
import { config } from "./config";
import { encodeJSON, decodeJSON, BlockHeader } from "algosdk";
import { fsExists } from "./utils";

export const getCachePath = (
  networkIDs: NetworkIDs,
  subPath = "blocks"
): string => {
  const { genesisID, genesisHash } = networkIDs;
  const networkPath = join(
    config.dataPath,
    `${genesisID}-${genesisHash.replace(/[\/=]/g, "_")}`,
    subPath
  );
  return networkPath;
};

export const getBlockCacheFilePath = (
  rnd: number,
  networkIDs: NetworkIDs
): string => {
  return join(getCachePath(networkIDs), `${rnd}.json`);
};

export const getDirectoryFiles = async (
  networkIDs: NetworkIDs
): Promise<Set<string>> => {
  const filenames = await readdir(getCachePath(networkIDs));
  return new Set(filenames.filter((filename) => filename.endsWith(".json")));
};

export async function removeCached(
  rnds: number[],
  networkIDs: NetworkIDs
): Promise<number[]> {
  const existing = await getDirectoryFiles(networkIDs);
  return rnds.filter((rnd) => !existing.has(`${rnd}.json`));
}

export async function ensureCachePathExists(
  networkIDs: NetworkIDs,
  subPath = "blocks"
) {
  const cachePath = getCachePath(networkIDs, subPath);
  if (!(await fsExists(cachePath))) {
    console.log("Creating", cachePath);
    await mkdirSync(cachePath, { recursive: true });
  }
}

export async function hasCache(rnd: number, networkIDs: NetworkIDs) {
  return fsExists(getBlockCacheFilePath(rnd, networkIDs));
}

export async function getCache(
  rnd: number,
  networkIDs: NetworkIDs
): Promise<BlockHeader> {
  const filename = getBlockCacheFilePath(rnd, networkIDs);
  try {
    const contents = await readFile(filename);
    return decodeJSON(contents.toString(), BlockHeader);
  } catch (e) {
    console.error(`\nWhile parsing ${filename}`);
    throw e
  }
}

export async function setCache(
  rnd: number,
  networkIDs: NetworkIDs,
  data: BlockHeader
) {
  await writeFile(
    getBlockCacheFilePath(rnd, networkIDs),
    encodeJSON(data, { lossyBinaryStringConversion: true })
  );
}
