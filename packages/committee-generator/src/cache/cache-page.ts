import { readFile, writeFile } from 'fs/promises';
import { hashBuffer } from './utils';
import { fsExists, getMD5Hash } from '../utils';
import { config } from '../config';
import { basename } from 'path';
import { getKeyWithNetworkMetadata, uploadData, getMD5HashForObject } from '../s3';
import { CachePagePayload, fetchPageFromS3 } from './s3-cache';

export const CACHE_PAGE_SIZE = 1_000;
export const CACHE_MAX_PAGES = 10;

export class CachePage {
  filename: string;
  data: CachePagePayload;
  diskHash?: number;
  dirty = false;
  lastAccess: number;
  pending = new Set<Promise<any>>();

  constructor({ filename, contents }: { filename: string; contents?: Buffer }) {
    this.filename = filename;
    this.diskHash = contents ? hashBuffer(contents) : undefined;
    this.data = contents ? JSON.parse(contents.toString()) : {};
    this.lastAccess = Date.now();
  }

  /**
   * Loads the page using a local-first approach with S3 validation.
   * First checks if the page exists locally and validates its MD5 against S3.
   * If local page is valid, uses it; otherwise fetches from S3 and saves to disk. If not found in S3, returns an empty page (that will be populated from scratch).
   * @param pageStart - Start round of the required page
   * @param filename - The local filename to cache the page data
   * @returns {Promise<CachePage>} A promise that resolves to a CachePage instance
   * @throws May throw an error if S3 validation, fetch, or local file read/write operations fail.
   */
  static async loadPageFromS3(pageStart: number, filename: string): Promise<CachePage> {
    // Check if local file exists
    if (await fsExists(filename)) {
      try {
        if (config.verbose) {
          console.debug(`Validating local page ${pageStart} against S3...`);
        }

        // First check if S3 object exists with MD5 - if not, skip validation
        const s3Hash = await getMD5HashForObject(
          getKeyWithNetworkMetadata(`blocks/${basename(filename)}`),
        );

        if (s3Hash !== undefined) {
          // S3 object exists, now read local file and compare
          const localContents = await readFile(filename);
          const localHash = getMD5Hash(localContents);

          if (localHash === s3Hash) {
            if (config.verbose) {
              console.debug(`Using cached page ${pageStart}, MD5 validated against S3`);
            }
            return new CachePage({ filename, contents: localContents });
          } else {
            if (config.verbose) {
              console.debug(
                `Local cache for page ${pageStart} is stale (MD5 mismatch with S3); will refetch from S3.`,
              );
            }
          }
        }
      } catch (error) {
        if (config.verbose) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to compare local cache with S3 for ${filename}: ${message}.`);
        }
      }
    }

    if (config.verbose) {
      console.debug(`Fetching page ${pageStart} from S3...`);
    }

    const data = await fetchPageFromS3(pageStart);
    if (data !== undefined) {
      const contents = Buffer.from(JSON.stringify(data));
      await writeFile(filename, contents);
      return new CachePage({ filename, contents });
    }

    if (config.verbose) {
      console.debug(`Page ${pageStart} not found in local cache or S3, starting with empty page.`);
    }

    return new CachePage({ filename });
  }

  static async loadPage(filename: string) {
    try {
      if (await fsExists(filename)) {
        const contents = await readFile(filename);
        return new CachePage({ filename, contents });
      } else {
        return new CachePage({ filename });
      }
    } catch (e) {
      console.warn(`\nPage ${filename} was corrupted: ${(e as Error).message}`);
      return new CachePage({ filename });
    }
  }

  async savePage() {
    // mark dirty up top so we err on the side of caution if we get set() while we are saving
    // if exists on disk, check for changes before saving
    if (this.dirty && this.diskHash !== undefined) {
      this.dirty = false;
      try {
        const latestContents = await readFile(this.filename);
        const latestDiskHash = hashBuffer(latestContents);
        if (latestDiskHash !== this.diskHash) {
          // changed on disk, merge
          const diskData = JSON.parse(latestContents.toString());
          this.data = { ...diskData, ...this.data };
        }
      } catch (e) {
        // ok, we tried
        if (config.verbose) console.warn(`\nError merging dirty page ${this.filename}: `, e);
      }
    }
    const contents = Buffer.from(JSON.stringify(this.data));
    const promise = writeFile(this.filename, contents);
    this.pending.add(promise);
    await promise;
    this.diskHash = hashBuffer(contents);
    this.pending.delete(promise);

    // we have a complete file on disk at this point, so we can safely upload to S3 if needed in 'write-cache' mode
    if (
      !this.dirty &&
      config.cacheMode === 'write-cache' &&
      Object.keys(this.data).length === CACHE_PAGE_SIZE // only attempt upload of full pages to avoid unnecessary S3 churn
    ) {
      await uploadData(getKeyWithNetworkMetadata(`blocks/${basename(this.filename)}`), contents);
    }

    if (config.verbose) {
      console.debug(`Saved page ${this.filename} (dirty: ${this.dirty})`);
    }
  }

  async evict() {
    // set() and savePage() races can lead to dirty-after-write
    while (this.dirty) {
      await this.savePage();
    }
  }

  get(rnd: number): string {
    this.lastAccess = Date.now();
    return this.data[String(rnd)];
  }

  set(rnd: number, data: string) {
    this.lastAccess = Date.now();
    this.dirty = true;
    this.data[String(rnd)] = data;
  }
}
