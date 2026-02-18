import { readFile, writeFile } from "fs/promises";
import { hashBuffer } from "./utils";
import { fsExists } from "../utils";
import { config } from "../config";

export const CACHE_PAGE_SIZE = 1_000;
export const CACHE_MAX_PAGES = 10;

type CachePagePayload = Record<string, string>;

export class CachePage {
  filename: string;
  data: CachePagePayload;
  diskHash?: number;
  dirty = false;
  lastAccess: number;
  pending = new Set<Promise<any>>();
  readonly readOnly: boolean;

  constructor({
    filename,
    contents,
    readOnly = false,
  }: {
    filename: string;
    contents?: Buffer;
    readOnly?: boolean;
  }) {
    this.filename = filename;
    this.diskHash = contents ? hashBuffer(contents) : undefined;
    this.data = contents ? JSON.parse(contents.toString()) : {};
    this.lastAccess = Date.now();
    this.readOnly = readOnly;
  }

  /**
   * Creates a read-only CachePage from S3 data.
   * This page will never be saved to disk or marked as dirty.
   */
  static fromS3Data(pageStart: number, data: CachePagePayload): CachePage {
    const page = new CachePage({
      filename: `S3:${pageStart}`, // Virtual filename for debugging
      readOnly: true,
    });
    page.data = data;
    return page;
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
    // Skip saving for read-only pages (from S3)
    if (this.readOnly) {
      return;
    }

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
        if (config.verbose)
          console.warn(`\nError merging dirty page ${this.filename}: `, e);
      }
    }
    const contents = Buffer.from(JSON.stringify(this.data));
    const promise = writeFile(this.filename, contents);
    this.pending.add(promise);
    await promise;
    this.diskHash = hashBuffer(contents);
    this.pending.delete(promise);
  }

  async evict() {
    // Skip eviction for read-only pages (from S3) - nothing to save
    if (this.readOnly) {
      return;
    }

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
    // Prevent writes to read-only pages (from S3 in use-cache mode)
    if (this.readOnly) {
      throw new Error(`Cannot write to read-only cache page: ${this.filename}`);
    }

    this.lastAccess = Date.now();
    this.dirty = true;
    this.data[String(rnd)] = data;
  }
}
