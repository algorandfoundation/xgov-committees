import { readFile, readdir } from "fs/promises";
import { mkdirSync } from "fs";
import { join } from "path";
import { networkMetadata, NetworkMetadata } from "../algod";
import { encodeJSON, decodeJSON, BlockHeader } from "algosdk";
import { chunk, clearLine, fsExists, sleep } from "../utils";
import { getCachePath } from "./utils";
import { cacheManager, getPageStartRnd } from "./cache-manager";
import { config } from "../config";
import { fetchPageFromS3 } from "./s3-cache";
import { listKeysWithPrefix } from "../s3";

export const getCachedRounds = async (
  min: number,
  max: number,
): Promise<Set<number>> => {
  // In use-cache mode, check which block pages exist in S3
  if (config.cacheMode === "use-cache") {
    process.stderr.write(
      "Checking S3 blocks cache, please wait. This can take a while.",
    );

    const { genesisID, genesisHash } = networkMetadata;
    const networkPrefix = `${genesisID}-${genesisHash.replace(/[\/=]/g, "_")}`;
    const blocksPrefix = `${networkPrefix}/blocks/`;

    try {
      const keys = await listKeysWithPrefix(blocksPrefix);
      const minPage = getPageStartRnd(min);
      const maxPage = getPageStartRnd(max);
      const rounds: number[] = [];

      // Fetch each page in the range and extract round numbers
      for (const key of keys) {
        // Key format: network/blocks/50000000.json
        const match = key.match(/(\d+)\.json$/);
        if (!match) continue;
        const pageStart = parseInt(match[1], 10);
        if (pageStart < minPage || pageStart > maxPage) continue;

        try {
          const pageData = await fetchPageFromS3(pageStart);
          if (pageData) {
            const pageRounds = Object.keys(pageData).map((s) =>
              parseInt(s, 10),
            );
            rounds.push(...pageRounds);
          }
        } catch (e) {
          console.warn(`Failed to load S3 page ${pageStart}: ${e}`);
        }
      }

      clearLine();
      return new Set(rounds);
    } catch (e) {
      console.warn(`Failed to list S3 blocks: ${e}`);
      clearLine();
      return new Set();
    }
  }

  // Existing filesystem logic for non-use-cache modes
  process.stderr.write(
    "Reading block cache, please wait. This can take a while.",
  );
  const minPage = getPageStartRnd(min);
  const maxPage = getPageStartRnd(max);
  const cachePath = getCachePath("blocks");
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
          const existingRounds = new Set(
            Object.keys(data).map((s) => parseInt(s, 10)),
          );
          rounds.push(...existingRounds);
        } catch (e) {
          // pretend corrupt files do not exist, they will be overwritten anyway
        }
      }),
    );
    await sleep(50); // gc
  }
  clearLine();
  return new Set(rounds);
};

export async function subtractCached(rnds: number[]): Promise<number[]> {
  // In use-cache mode, assume all blocks are pre-cached in S3
  // Skip the expensive S3 listing/fetching check
  if (config.cacheMode === "use-cache") {
    return [];
  }

  const min = rnds[0];
  const max = rnds[rnds.length - 1];
  const existing = await getCachedRounds(min, max);
  return rnds.filter((rnd) => !existing.has(rnd));
}

export async function ensureCacheSubPathExists(subPath: string) {
  const cachePath = getCachePath(subPath);
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
  // In use-cache mode, never write to cache (read-only S3)
  if (config.cacheMode === "use-cache") {
    return;
  }

  await cacheManager.set(
    rnd,
    encodeJSON(data, { lossyBinaryStringConversion: true }),
  );
}
