import { readFile, writeFile, readdir } from "fs/promises";
import { mkdirSync } from "fs";
import { join } from "path";
import { networkIDs, NetworkIDs } from "../algod";
import { encodeJSON, decodeJSON, BlockHeader } from "algosdk";
import { chunk, fsExists, sleep } from "../utils";
import { getCachePath } from "./utils";
import { cacheManager, getPageStartRnd } from "./cache-manager";

export const getCachedRounds = async (
  min: number,
  max: number
): Promise<Set<number>> => {
  process.stderr.write("Checking cache")
  const minPage = getPageStartRnd(min);
  const maxPage = getPageStartRnd(max);
  const cachePath = getCachePath(networkIDs);
  const filenames = (await readdir(cachePath)).filter((filename) => {
    if (!filename.endsWith(".json")) return;
    const pageNum = parseInt(filename.split(".")[0], 10);
    return minPage <= pageNum && pageNum <= maxPage;
  });

  const chunks = chunk(filenames, 20);
  const rounds: number[] = [];

  for (const chunked of chunks) {
    await Promise.all(
      chunked.map(async (basename) => {
        try {
          const filename = join(cachePath, basename);
          const buffer = await readFile(filename);
          const data = JSON.parse(buffer.toString());
          const existingRounds = new Set(Object.keys(data).map((s) => parseInt(s, 10)))
          rounds.push(...existingRounds);
        } catch (e) {
          // pretend corrupt files do not exist, they will be overwritten anyway
        }
      })
    );
    await sleep(50); // gc
  }
  process.stderr.write("\r               ")
  process.stderr.write("\r")
  return new Set(rounds);
};

export async function subtractCached(
  rnds: number[],
  networkIDs: NetworkIDs
): Promise<number[]> {
  const min = rnds[0];
  const max = rnds[rnds.length - 1];
  const existing = await getCachedRounds(min, max);
  return rnds.filter((rnd) => !existing.has(rnd));
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

export async function getCache(rnd: number): Promise<BlockHeader | undefined> {
  try {
    const contents = await cacheManager.get(rnd);
    if (!contents) return;
    return decodeJSON(contents, BlockHeader);
  } catch (e) {
    console.error(`\nWhile parsing ${rnd}: `, e);
    throw e;
  }
}

export async function setCache(rnd: number, data: BlockHeader) {
  await cacheManager.set(
    rnd,
    encodeJSON(data, { lossyBinaryStringConversion: true })
  );
}
