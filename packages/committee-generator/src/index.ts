import { TipReachedError } from './blocks';
import { ensureCacheSubPathExists } from './cache';
import { CacheMode, config } from './config';
import { runUseCache, runValidateCache, runWriteCache } from './modes';
import {
  ExitCode,
  expectedExit,
  fatalError,
  gracefulShutdown,
  enableAsyncTracking,
  ShuttingDownError,
  awaitShutdown,
} from './shutdown';

const { cacheMode, fromBlock, toBlock } = config;

console.log(`Running in cache mode: ${cacheMode}`);

// Enable async resource tracking for graceful shutdown only when needed
if (cacheMode === 'write-cache') {
  enableAsyncTracking();
}

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
  if (error instanceof TipReachedError) {
    await expectedExit(ExitCode.EXPECTED_TIP, `Tip reached at block ${error.blockNumber}`);
  } else if (error instanceof ShuttingDownError) {
    // Handle shutdown gracefully if operation was interrupted during shutdown
    console.log('Operation interrupted due to shutdown signal, waiting for cleanup to complete...');
    // Shutdown was initiated by SIGTERM/SIGINT signal handler
    // Wait for the shutdown process to complete (which will exit the process)
    await awaitShutdown();
  } else {
    // unexpected error, log and exit with failure
    await fatalError(error);
  }
}

await expectedExit(ExitCode.SUCCESS, `${cacheMode} operation completed successfully`);
