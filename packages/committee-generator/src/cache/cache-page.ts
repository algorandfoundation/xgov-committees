import { readFile, writeFile } from 'fs/promises';
import { hashBuffer } from './utils';
import { fsExists } from '../utils';
import { config } from '../config';
import { basename } from 'path';
import { getKeyWithNetworkMetadata, uploadData } from '../s3';
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
   * Fetches the page data from S3 and creates a CachePage instance after saving to disk.
   * @param pageStart - Start round of the required page
   * @param filename - The local filename to save the page data to
   * @returns {Promise<CachePage>} A promise that resolves to a CachePage instance with the fetched data
   * @throws Will throw an error if the page is not found in S3 or if the fetch/save process fails.
   */
  static async loadPageFromS3(pageStart: number, filename: string): Promise<CachePage> {
    // load page from S3
    const data = await fetchPageFromS3(pageStart);
    // convert format
    const contents = Buffer.from(JSON.stringify(data));
    // Save to disk for local caching
    await writeFile(filename, contents);
    // load as normal
    return new CachePage({ filename, contents });
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
    if (!this.dirty && config.cacheMode === 'write-cache') {
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
