import { join } from 'path';
import { config } from '../config';
import {
  getKeyWithNetworkMetadata,
  getMD5HashForObject,
  getPublicUrlForObject,
  objectExists,
  uploadData,
} from '../s3';
import { clearLine, downloadToFile, formatDuration, fsExists, getMD5Hash } from '../utils';
import pMap from 'p-map';
import { ensureCacheSubPathExists } from '.';
import { getCachePath } from './utils';
import { CACHE_PAGE_SIZE } from './cache-page';
import { readFile } from 'fs/promises';
import { cacheManager } from './cache-manager';

export type CachePagePayload = Record<string, string>;

/**
 * Validates a single block page by comparing its MD5 hash between S3 and local filesystem.
 * @param pageStartRnd The starting round number for this page.
 * @param pageIndex The zero-based index of this page (for logging).
 * @param totalPages The total number of pages being validated (for logging).
 * @throws Will throw an error if the MD5 hashes don't match.
 */
export async function validateBlockPage(
  pageStartRnd: number,
  pageIndex: number,
  totalPages: number,
): Promise<void> {
  // get MD5 hash of page stored on s3
  const s3MD5Hash = await getMD5HashForObject(
    getKeyWithNetworkMetadata(`blocks/${pageStartRnd}.json`),
  );

  if (s3MD5Hash === undefined) {
    throw new Error(
      `Cache validation failed! Page starting at round ${pageStartRnd} MD5 not found in S3 ETag`,
    );
  }

  // read page file contents as raw bytes
  const fileBuffer = await readFile(cacheManager.getBlockCacheFilePath(pageStartRnd));

  // compute MD5 hash of local file contents (bytes) to match S3 behavior
  const localMD5Hash = getMD5Hash(fileBuffer);

  // compare hashes and throw if mismatch
  if (s3MD5Hash !== localMD5Hash) {
    throw new Error(
      `Cache validation failed! MD5 hash mismatch for page starting at round ${pageStartRnd}. S3 hash: ${s3MD5Hash}, Local hash: ${localMD5Hash}`,
    );
  }

  console.debug(
    `[${pageIndex + 1}/${totalPages}] Block page validation successful for page starting at round ${pageStartRnd}. S3 MD5 ${s3MD5Hash} matches local MD5 ${localMD5Hash}`,
  );
}

/**
 * Downloads block pages from S3 with progress tracking. Expected to be multiples of 1000 blocks since each page covers 1000 blocks.
 * @param fromBlock The starting block number for the download range.
 * @param toBlock The ending block number for the download range.
 * @throws Will throw an error if the block range is not valid or on failure.
 * @return {Promise<void>} Resolves when all pages are downloaded.
 */
export async function downloadBlockPages(fromBlock: number, toBlock: number): Promise<void> {
  const blockCachePath = getCachePath('blocks');
  await ensureCacheSubPathExists('blocks');

  // Generate array of page start blocks
  const targetPages = Array.from(
    { length: (toBlock - fromBlock) / CACHE_PAGE_SIZE },
    (_, i) => fromBlock + i * CACHE_PAGE_SIZE,
  );

  // Progress tracking state
  let downloaded = 0;
  let skipped = 0;
  let redownloaded = 0;
  let newFiles = 0;
  const total = targetPages.length;
  const startTime = Date.now();

  // Helper function to update progress display
  const updateProgress = () => {
    const percent = total > 0 ? ((100 * downloaded) / total).toFixed(2) : '0.00';
    const elapsed = (Date.now() - startTime) / 1000;

    let rate = '';
    if (elapsed > 0 && downloaded > 0) {
      const pagesPerSec = (downloaded / elapsed).toFixed(2);
      const remaining = total - downloaded;

      // Show ETA only if there are remaining pages
      if (remaining > 0) {
        const eta = formatDuration(remaining / (downloaded / elapsed));
        rate = ` ${pagesPerSec} pages/sec ETA ${eta}`;
      } else {
        rate = ` ${pagesPerSec} pages/sec`;
      }
    }

    if (!config.verbose) {
      process.stdout.write(
        `\rDownloading pages:\t${downloaded}/${total} ${percent}%${rate}        `,
      );
    } else if (downloaded % 25 === 0 || downloaded === total) {
      console.log(`Progress: ${downloaded}/${total} pages processed (${percent}%)${rate}`);
    }
  };

  await pMap(
    targetPages,
    async (pageStart) => {
      const pageName = `${pageStart}.json`;
      const url = getPublicUrlForObject(`blocks/${pageName}`);
      const fileName = join(blockCachePath, pageName);

      // if file already exists locally, compare MD5 hash with S3 before deciding to skip or redownload
      if (await fsExists(fileName)) {
        try {
          // read local file and compute MD5 hash
          const localMD5Hash = getMD5Hash(await readFile(fileName));

          // get hash of object on s3
          const s3MD5Hash = await getMD5HashForObject(
            getKeyWithNetworkMetadata(`blocks/${pageName}`),
          );

          // does the hash match? if so, skip download. if not, redownload and overwrite local file
          if (localMD5Hash === s3MD5Hash) {
            // Skip download
            if (config.verbose) {
              console.debug(`Cached: ${pageName} (MD5: ${localMD5Hash})`);
            }
            downloaded++;
            skipped++;
            updateProgress();
            return;
          } else {
            // Hash mismatch - redownload
            if (config.verbose) {
              console.warn(`Hash mismatch for ${pageName}, re-downloading...`);
              console.warn(`Local: ${localMD5Hash}, S3: ${s3MD5Hash}`);
            }
            redownloaded++;
          }
        } catch (error) {
          // File exists but couldn't read it - log and redownload
          console.warn(`Error reading ${pageName}: ${(error as Error).message}, re-downloading...`);
          redownloaded++;
        }
      } else {
        // File doesn't exist - download
        if (config.verbose) {
          console.debug(`New file: ${pageName}, downloading...`);
        }
        newFiles++;
      }

      await downloadToFile(url, fileName);
      downloaded++;
      updateProgress();
    },
    { concurrency: config.concurrency },
  );

  // Clear progress bar line only if it was shown
  if (!config.verbose) {
    clearLine();
  }
  process.stdout.write(
    `Download complete:\t${total} pages (${skipped} cached, ${newFiles} new, ${redownloaded} updated)\n`,
  );
}

/**
 * Fetches a cache page from S3.
 * Returns the parsed page data if found, undefined if not found.
 * Throws on errors (caller should handle gracefully).
 */
export async function fetchPageFromS3(pageStart: number): Promise<CachePagePayload | undefined> {
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

/**
 * Uploads a cache page to S3.
 * Throws on error (caller should handle gracefully).
 */
export async function uploadPageToS3(pageStart: number, data: CachePagePayload): Promise<void> {
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
