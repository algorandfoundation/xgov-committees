import { join } from "path";
import { config } from "../config";
import {
  getData,
  getKeyWithNetworkMetadata,
  getPublicUrlForObject,
  objectExists,
  uploadData,
} from "../s3";
import { clearLine, downloadToFile, formatDuration } from "../utils";
import pMap from "p-map";
import { ensureCacheSubPathExists } from ".";
import { getCachePath } from "./utils";

export type CachePagePayload = Record<string, string>;

/**
 * Downloads block pages from S3 with progress tracking. Expected to be multiples of 1000 blocks since each page covers 1000 blocks.
 * @param fromBlock The starting block number for the download range.
 * @param toBlock The ending block number for the download range.
 * @throws Will throw an error if the block range is not valid or on failure.
 * @return {Promise<void>} Resolves when all pages are downloaded.
 */
export async function downloadBlockPages(
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  const blockCachePath = getCachePath("blocks");
  await ensureCacheSubPathExists("blocks");

  // Generate array of page start blocks
  const targetPages = Array.from(
    { length: (toBlock - fromBlock) / 1000 },
    (_, i) => fromBlock + i * 1000,
  );

  // Progress tracking state
  let downloaded = 0;
  const total = targetPages.length;
  const startTime = Date.now();

  await pMap(
    targetPages,
    async (pageStart) => {
      const pageName = `${pageStart}.json`;
      const url = getPublicUrlForObject(`blocks/${pageName}`);
      const fileName = join(blockCachePath, pageName);

      await downloadToFile(url, fileName);

      // Update progress
      downloaded++;
      const percent = ((100 * downloaded) / total).toFixed(2);
      const elapsed = (Date.now() - startTime) / 1000;
      const rate =
        elapsed > 0
          ? ` ${(downloaded / elapsed).toFixed(2)} pages/sec ETA ${formatDuration((total - downloaded) / (downloaded / elapsed))}`
          : "";

      process.stdout.write(
        `\rDownloading pages:\t${downloaded}/${total} ${percent}%${rate}        `,
      );
    },
    { concurrency: config.concurrency },
  );

  clearLine();
  process.stdout.write(`Download complete:\t${total} pages OK\n`);
}

/**
 * Fetches a cache page from S3.
 * Returns the parsed page data if found, undefined if not found.
 * Throws on errors (caller should handle gracefully).
 */
export async function fetchPageFromS3(
  pageStart: number,
): Promise<CachePagePayload | undefined> {
  // In use-cache mode, fetch from public URL endpoint
  if (config.cacheMode === "use-cache") {
    const url = getPublicUrlForObject(`blocks/${pageStart}.json`); // For backward compatibility with old key format

    console.log(`Fetching S3 page: ${url}`);

    try {
      const res = await fetch(url);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`Fetching ${url} failed: ${res.status}`);
      const data = await res.json();

      if (config.verbose) {
        console.debug(`S3 cache hit: ${url}`);
      }

      return data as CachePagePayload;
    } catch (error) {
      if (config.verbose) {
        console.debug(`S3 cache miss: ${url}`);
      }
      throw error;
    }
  }

  const key = getKeyWithNetworkMetadata(`blocks/${pageStart}.json`); // For backward compatibility with old key format

  try {
    const body = await getData(key);

    if (!body) {
      return undefined;
    }

    // Convert stream or string body to string
    const bodyString =
      typeof body === "string" ? body : await body.transformToString("utf-8");
    const data = JSON.parse(bodyString) as CachePagePayload;

    if (config.verbose) {
      console.debug(`S3 cache hit: ${key}`);
    }

    return data;
  } catch (error) {
    const err = error as {
      $metadata?: { httpStatusCode?: number };
      name?: string;
      Code?: string;
    };

    // 404 means not found - this is expected, return undefined
    if (
      err?.$metadata?.httpStatusCode === 404 ||
      err?.name === "NoSuchKey" ||
      err?.Code === "NoSuchKey"
    ) {
      if (config.verbose) {
        console.debug(`S3 cache miss: ${key}`);
      }
      return undefined;
    }

    // Other errors should be thrown so caller can handle
    throw error;
  }
}

/**
 * Uploads a cache page to S3.
 * Throws on error (caller should handle gracefully).
 */
export async function uploadPageToS3(
  pageStart: number,
  data: CachePagePayload,
): Promise<void> {
  const key = getKeyWithNetworkMetadata(`blocks/${pageStart}.json`); // For backward compatibility with old key format

  await uploadData(key, JSON.stringify(data));

  if (config.verbose) {
    console.debug(`Uploaded to S3: ${key}`);
  }
}

/**
 * Checks if a cache page exists in S3 without downloading it.
 * Returns true if exists, false if not found.
 * Throws on errors (caller should handle gracefully).
 */
export async function pageExistsS3(pageStart: number): Promise<boolean> {
  const key = getKeyWithNetworkMetadata(`blocks/${pageStart}.json`); // For backward compatibility with old key format
  return objectExists(key);
}
