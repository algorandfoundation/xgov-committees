import { join } from "path";
import { networkIDs, NetworkIDs } from "../algod";
import { CACHE_MAX_PAGES, CACHE_PAGE_SIZE, CachePage } from "./cache-page";
import { getCachePath } from "./utils";
import { fsExists, sleep } from "../utils";
import { config } from "../config";

export function getPageStartRnd(rnd: number) {
  return Math.floor(rnd / CACHE_PAGE_SIZE) * CACHE_PAGE_SIZE;
}

export class CacheManager {
  cachePath: string;
  maxPages: number;
  pages = new Map<number, CachePage>();
  loading = new Map<number, Promise<CachePage>>();
  shuttingDown = false;

  constructor(networkIDs: NetworkIDs, maxPages = CACHE_MAX_PAGES) {
    this.cachePath = getCachePath(networkIDs);
    this.maxPages = maxPages;
  }

  async get(rnd: number) {
    const pageStart = getPageStartRnd(rnd);
    // page is cached
    if (this.pages.has(pageStart)) {
      const page = this.pages.get(pageStart)!;
      return page.get(rnd);
    } else if (await this.hasPage(pageStart)) {
      // check page exists
      const page = await this.loadPage(pageStart)!;
      return page.get(rnd);
    }
  }

  async set(rnd: number, data: string) {
    if (this.shuttingDown) {
      throw new Error(`Can not write ${rnd}: cache is shutting down`);
    }
    const pageStart = getPageStartRnd(rnd);
    // page is cached
    if (this.pages.has(pageStart)) {
      const page = this.pages.get(pageStart)!;
      return page.set(rnd, data);
    } else {
      const page = await this.loadPage(pageStart)!;
      return page.set(rnd, data);
    }
  }

  async hasPage(pageStart: number): Promise<boolean> {
    return fsExists(this.getBlockCacheFilePath(pageStart));
  }

  get numPages() {
    return this.pages.size;
  }

  async loadPage(pageStart: number): Promise<CachePage> {
    if (this.loading.has(pageStart)) {
      return this.loading.get(pageStart)!;
    }
    let q: Promise<CachePage>;
    this.loading.set(
      pageStart,
      (q = new Promise(async (resolve, reject) => {
        try {
          if (config.verbose)
            console.debug(
              `\nLoading ${pageStart} numPages:${this.numPages} max:${this.maxPages}`
            );
          if (this.numPages > this.maxPages) {
            await this.evictPage();
          }
          const filename = this.getBlockCacheFilePath(pageStart);
          const page = await CachePage.loadPage(filename);
          this.pages.set(pageStart, page);
          this.loading.delete(pageStart);
          resolve(page);
        } catch (e) {
          reject(e);
        }
      }))
    );
    return q;
  }

  get oldestPage() {
    return [...this.pages.entries()].reduce(
      ([leastUsedRnd, leastUsedPage], [rnd, page]) => {
        if (leastUsedPage?.lastAccess > page.lastAccess) return [rnd, page];
        return [leastUsedRnd, leastUsedPage];
      }
    );
  }

  hasDirty() {
    return [...this.pages.values()].some((p) => p.dirty);
  }

  async evictPage() {
    if (this.numPages > this.maxPages) {
      const [pageStart, page] = this.oldestPage;
      await page.evict();
      this.pages.delete(pageStart);
      if (config.verbose)
        console.debug(
          `Evicting ${pageStart} numPages:${this.numPages} max:${this.maxPages}`
        );
      await sleep(50);
    }
  }

  async flushAllPages(): Promise<number[]> {
    while (this.pages.size) {
      const pageEntries = [...this.pages.entries()];
      await Promise.all(pageEntries.map((page) => page[1].evict()));
      return pageEntries.map(([key]) => key);
    }
    return [];
  }

  async evictAllPages() {
    this.shuttingDown = true;
    const evictedKeys = await this.flushAllPages();
    for (const key of evictedKeys) {
      this.pages.delete(key);
    }
    this.shuttingDown = false;
  }

  getBlockCacheFilePath(rnd: number): string {
    const pageStart = getPageStartRnd(rnd);
    return join(this.cachePath, `${pageStart}.json`);
  }
}

export const cacheManager = new CacheManager(networkIDs);

for (const sig of [
  "SIGTERM",
  "SIGINT",
  "uncaughtException",
  "unhandledRejection",
  "beforeExit",
]) {
  process.on(sig, gracefulExit);
  async function gracefulExit() {
    if (cacheManager.hasDirty()) {
      console.log("\nFlushing data to disk before exit");
      try {
        await cacheManager.evictAllPages();
        console.log("OK");
      } catch (e) {
        console.error("While shutting down:", e);
      }
    }
    process.exit(0);
  }
}
