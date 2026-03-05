import { ensureCacheSubPathExists } from './cache';
import { CacheMode, config } from './config';
import { runUseCache, runValidateCache, runWriteCache } from './modes';
import { ExitCode, expectedExit, fatalError, gracefulShutdown } from './shutdown';

const { cacheMode, fromBlock, toBlock } = config;

console.log(`Running in cache mode: ${cacheMode}`);

const cacheModes: Record<CacheMode, () => Promise<void>> = {
  'validate-cache': () => runValidateCache(fromBlock, toBlock),
  'write-cache': () => runWriteCache(fromBlock, toBlock),
  'use-cache': () => runUseCache(fromBlock, toBlock),
};

// register signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', fatalError);
process.on('unhandledRejection', fatalError);

// beforeExit intentionally omitted

await ensureCacheSubPathExists('blocks');

try {
  await cacheModes[cacheMode]();
} catch (error: unknown) {
  await fatalError(error);
}

await expectedExit(ExitCode.SUCCESS, `${cacheMode} operation completed successfully`);
