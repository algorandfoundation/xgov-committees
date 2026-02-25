import { ensureCacheSubPathExists } from './cache';

import { CacheMode, config } from './config';
import { runUseCache, runValidateCache, runWriteCache } from './modes';

const { cacheMode, fromBlock, toBlock } = config;

console.log(`Running in cache mode: ${cacheMode}`);

const cacheModes: Record<CacheMode, () => Promise<void>> = {
  'validate-cache': () => runValidateCache(fromBlock, toBlock),
  'write-cache': () => runWriteCache(fromBlock, toBlock),
  'use-cache': () => runUseCache(fromBlock, toBlock),
};

await ensureCacheSubPathExists('blocks');

try {
  await cacheModes[cacheMode]();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : error;
  console.error(`Cache operation failed:`, message);
  process.exit(1);
}
