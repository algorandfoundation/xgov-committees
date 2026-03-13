import { createHook } from 'async_hooks';
import { shutdownCache } from './cache/cache-manager';

export const ExitCode = {
  SUCCESS: 0,
  EXPECTED_TIP: 10,
  FATAL: 1,
} as const;

let shuttingDown = false;
let shutdownPromise: Promise<never> | null = null;

type ShutdownReason = 'signal' | 'expected' | 'fatal';

/**
 * Error thrown when attempting to execute a function during shutdown
 */
export class ShuttingDownError extends Error {
  constructor(message = 'Operation cannot be executed: application is shutting down') {
    super(message);
    this.name = 'ShuttingDownError';
  }
}

/**
 * Function wrapper version that guards any function against shutdown.
 * Use this for standalone functions that aren't class methods.
 *
 * @example
 * const safeFunction = guardWhileNotShuttingDown(async () => {
 *   // ... function logic
 * });
 */
export function guardWhileNotShuttingDown<TArgs extends Array<unknown>, TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    if (shuttingDown) {
      throw new ShuttingDownError();
    }
    return await fn(...args);
  };
}

// Async resource tracking
const activeResources = new Map<number, { type: string; timestamp: number }>();
const ignoredTypes = new Set(['TIMERWRAP', 'TickObject', 'ELDHISTOGRAM']);

let asyncHookEnabled = false;

// Create async hook to track resources including promises.
// We track resources regardless of `shuttingDown` so that work scheduled
// during shutdown is also observed. For PROMISE resources rely on the
// `promiseResolve` hook because PROMISEs are not always destroyed when
// they settle.
const asyncHook = createHook({
  init(asyncId, type, _triggerAsyncId) {
    if (!ignoredTypes.has(type)) {
      activeResources.set(asyncId, { type, timestamp: Date.now() });
    }
  },
  destroy(asyncId) {
    activeResources.delete(asyncId);
  },
  // Called when a Promise is resolved or rejected (i.e., settled). Remove promise
  // entries so we don't rely solely on `destroy` for PROMISE lifecycle.
  promiseResolve(asyncId) {
    activeResources.delete(asyncId);
  },
});

// Enable async tracking
export function enableAsyncTracking() {
  if (!asyncHookEnabled) {
    asyncHook.enable();
    asyncHookEnabled = true;
  }
}

// Disable async tracking
export function disableAsyncTracking() {
  if (asyncHookEnabled) {
    asyncHook.disable();
    asyncHookEnabled = false;
  }
}

// Wait for all pending async operations
async function waitForPendingOperations(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 100;

  while (activeResources.size > 0) {
    const elapsed = Date.now() - startTime;

    if (elapsed >= timeoutMs) {
      console.warn(
        `Shutdown timeout reached after ${timeoutMs}ms with ${activeResources.size} pending operations:`,
      );
      // Log the types of resources still pending
      const typeCounts = new Map<string, number>();
      for (const { type } of activeResources.values()) {
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      }
      for (const [type, count] of typeCounts.entries()) {
        console.warn(`  - ${type}: ${count}`);
      }
      break;
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  if (activeResources.size === 0) {
    console.log('All async operations completed successfully');
  }
}

export async function shutdown(exitCode: number, reason: ShutdownReason, message?: string) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  if (!shuttingDown) {
    shuttingDown = true;

    shutdownPromise = (async () => {
      console.log(`Shutdown initiated (${reason})`, message ?? '');

      try {
        // Wait for pending async operations
        console.log(`Waiting for ${activeResources.size} pending async operations...`);
        await waitForPendingOperations();

        // Disable async tracking before cleanup
        disableAsyncTracking();

        // Shutdown cache and other resources
        await shutdownCache();
      } catch (err) {
        console.error('Cleanup failed:', err);
      }

      console.log('Shutdown complete, exiting...');

      // This will terminate the process; the Promise will never resolve.
      process.exit(exitCode);
    })();
  }

  return shutdownPromise;
}

/**
 * Check if shutdown is in progress
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Wait for shutdown to complete if one is in progress.
 * If shutdown is in progress, this waits for it to complete (which will exit the process).
 * If no shutdown is in progress, initiates a graceful shutdown.
 */
export async function awaitShutdown(): Promise<never> {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  // If no shutdown in progress but this was called, initiate graceful shutdown
  // This handles the edge case where ShuttingDownError is thrown but shutdown hasn't started yet
  return shutdown(ExitCode.SUCCESS, 'expected', 'Awaiting shutdown when no shutdown in progress');
}

export async function gracefulShutdown(signal: string) {
  await shutdown(ExitCode.SUCCESS, 'signal', signal);
}

export async function expectedExit(code: number, message: string) {
  await shutdown(code, 'expected', message);
}

export async function fatalError(err: unknown) {
  console.error('Fatal error:', err);
  await shutdown(ExitCode.FATAL, 'fatal');
}

// ============================================================================
// Internal API for test helpers - caution: only for test use
// ============================================================================

export const __testInternals = {
  getActiveResourceCount: () => activeResources.size,
  getActiveResourceTypes: () => {
    const typeCounts = new Map<string, number>();
    for (const { type } of activeResources.values()) {
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    return typeCounts;
  },
  resetShutdownState: () => {
    shuttingDown = false;
    shutdownPromise = null;
    activeResources.clear();
    if (asyncHookEnabled) {
      asyncHook.disable();
      asyncHookEnabled = false;
    }
  },
  waitForPendingOperations: (timeoutMs = 30000) => waitForPendingOperations(timeoutMs),
};
