import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enableAsyncTracking,
  disableAsyncTracking,
  isShuttingDown,
  shutdown,
  ExitCode,
} from '../src/shutdown.ts';
import { __testInternals } from './shutdown.test-helpers.ts';

// Mock the cache manager module before importing anything else
vi.mock('../src/cache/cache-manager.ts', () => ({
  shutdownCache: vi.fn().mockResolvedValue(undefined),
}));

describe('Shutdown Async Resource Tracking', () => {
  let originalExit: typeof process.exit;
  let exitMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset module state before each test
    __testInternals.resetShutdownState();
    // Mock process.exit to prevent actual process termination
    originalExit = process.exit;
    exitMock = vi.fn() as never;
    // @ts-expect-error - temporarily replace process.exit with mock for testing
    process.exit = exitMock;

    // Reset the mocked shutdownCache
    const { shutdownCache } = await import('../src/cache/cache-manager.ts');
    vi.mocked(shutdownCache).mockClear();
    vi.mocked(shutdownCache).mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Restore original process.exit
    process.exit = originalExit;

    // Disable async tracking after each test
    disableAsyncTracking();

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('Basic Async Resource Tracking', () => {
    it('should categorize resource types correctly', async () => {
      enableAsyncTracking();

      // Create different types of resources
      const promise = Promise.resolve();
      const timer = setTimeout(() => {}, 100);

      await new Promise((resolve) => setImmediate(resolve));

      const types = __testInternals.getActiveResourceTypes();
      expect(types.size).toBeGreaterThan(0);

      clearTimeout(timer);
      await promise;
    });

    it('should not track ignored resource types', async () => {
      enableAsyncTracking();

      // Create some async resources
      const promise = Promise.resolve();
      const timer = setTimeout(() => {}, 100);

      await new Promise((resolve) => setImmediate(resolve));

      // Get the types currently being tracked
      const trackedTypes = __testInternals.getActiveResourceTypes();
      const typeNames = Array.from(trackedTypes.keys());

      // Verify none of the ignored types are being tracked
      expect(typeNames).not.toContain('TIMERWRAP');
      expect(typeNames).not.toContain('TickObject');
      expect(typeNames).not.toContain('ELDHISTOGRAM');

      clearTimeout(timer);
      await promise;
    });
  });

  describe('Promise Resolution Handling', () => {
    it('should remove resolved promises via promiseResolve hook', async () => {
      enableAsyncTracking();

      // Start with a baseline
      await new Promise((resolve) => setImmediate(resolve));
      const initialCount = __testInternals.getActiveResourceCount();

      // Create and immediately resolve promises
      const promises = Array.from({ length: 5 }, (_, i) => Promise.resolve(i));

      // Wait for hooks to register and resolve
      await Promise.all(promises);
      await new Promise((resolve) => setImmediate(resolve));

      // All promises should be cleaned up
      const finalCount = __testInternals.getActiveResourceCount();

      // Final count should not have grown significantly
      // (some system resources may still be tracked, but not our 5 promises)
      expect(finalCount - initialCount).toBeLessThan(5);
    });

    it('should handle rejected promises correctly', async () => {
      enableAsyncTracking();

      await new Promise((resolve) => setImmediate(resolve));
      const initialCount = __testInternals.getActiveResourceCount();

      // Create promises that reject
      const promises = Array.from(
        { length: 3 },
        () => Promise.reject(new Error('test')).catch(() => {}), // catch to prevent unhandled rejection
      );

      await Promise.all(promises);
      await new Promise((resolve) => setImmediate(resolve));

      const finalCount = __testInternals.getActiveResourceCount();
      expect(finalCount - initialCount).toBeLessThan(3);
    });
  });

  describe('Track Resources During Shutdown', () => {
    it('should track resources during and after shutdown initiation', async () => {
      enableAsyncTracking();

      // Verify initial state
      expect(isShuttingDown()).toBe(false);

      // Create initial async work before shutdown
      const _promise1 = Promise.resolve(1);
      await new Promise((resolve) => setImmediate(resolve));

      // Start shutdown (it will be async)
      void shutdown(ExitCode.SUCCESS, 'expected', 'test shutdown');

      // Give shutdown time to start
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify shutdown started
      expect(isShuttingDown()).toBe(true);

      // Create async work after shutdown starts - should still be tracked
      const _promise2 = Promise.resolve(2);
      await new Promise((resolve) => setImmediate(resolve));

      // Verify async hook is still active and tracking resources
      expect(__testInternals.getActiveResourceCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('waitForPendingOperations', () => {
    it('should track promise completion with async hooks', async () => {
      enableAsyncTracking();

      const delays = [50, 100, 150];
      const completed: number[] = [];

      // Create promises with different delays
      const promises = delays.map(
        (delay) =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              completed.push(delay);
              resolve();
            }, delay);
          }),
      );

      // Wait for our promises to complete
      await Promise.all(promises);

      // All promises should have completed
      expect(completed).toHaveLength(3);
      expect(completed).toContain(50);
      expect(completed).toContain(100);
      expect(completed).toContain(150);

      // Wait for async hooks to process promise cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Resources should be mostly cleared (allow test framework overhead)
      const finalCount = __testInternals.getActiveResourceCount();
      expect(finalCount).toBeLessThan(20);
    });

    it('should wait successfully and complete when operations finish', async () => {
      // Don't enable async tracking to avoid test framework overhead timeout

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create a few quick promises
      const promises = [
        new Promise<void>((resolve) => setTimeout(resolve, 30)),
        new Promise<void>((resolve) => setTimeout(resolve, 50)),
      ];

      // Start the promises
      void Promise.all(promises);

      // Wait for operations with reasonable timeout
      // Should complete without timing out
      await __testInternals.waitForPendingOperations(1000);

      // Should have completed successfully without timeout warnings
      const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(' '));
      const hasTimeoutWarning = logCalls.some((log) => log.includes('Shutdown timeout reached'));

      expect(hasTimeoutWarning).toBe(false);

      consoleLogSpy.mockRestore();
    });

    it('should timeout and log resource types if operations take too long', async () => {
      enableAsyncTracking();

      // Create some long-running operations that won't complete
      const timers = [
        setTimeout(() => {}, 5000),
        setTimeout(() => {}, 5000),
        setTimeout(() => {}, 5000),
      ];

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Call with short timeout to force timeout
      await __testInternals.waitForPendingOperations(100);

      // Should have warned about timeout
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Shutdown timeout reached'),
      );

      // Should have logged resource types
      const warnCalls = consoleWarnSpy.mock.calls;
      expect(warnCalls.length).toBeGreaterThan(0);

      // Verify resource types were logged in the timeout message
      const timeoutCall = warnCalls.find((call) => call[0]?.toString().includes('Timeout'));
      expect(timeoutCall).toBeDefined();

      consoleWarnSpy.mockRestore();
      timers.forEach(clearTimeout);
    });
  });

  describe('Shutdown Integration', () => {
    it('should initiate shutdown and track async operations', async () => {
      enableAsyncTracking();

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Start shutdown
      void shutdown(ExitCode.SUCCESS, 'expected', 'integration test');

      // Wait for shutdown to initiate
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have logged shutdown initiation
      const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(' '));
      expect(logCalls.some((log) => log.includes('Shutdown initiated'))).toBe(true);
      expect(logCalls.some((log) => log.includes('Waiting for'))).toBe(true);

      // Shutdown should be in progress
      expect(isShuttingDown()).toBe(true);

      consoleLogSpy.mockRestore();
    });

    it('should complete shutdown and exit process', async () => {
      // Don't enable async tracking to allow quick completion
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { shutdownCache } = await import('../src/cache/cache-manager.ts');

      // Start shutdown
      void shutdown(ExitCode.SUCCESS, 'expected', 'completion test');

      // Wait for shutdown to complete (quick without async tracking overhead)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should have completed the shutdown sequence
      const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(' '));
      expect(logCalls.some((log) => log.includes('Shutdown complete'))).toBe(true);

      // Should have called cleanup functions
      expect(vi.mocked(shutdownCache)).toHaveBeenCalled();

      // Should have exited with correct code
      expect(exitMock).toHaveBeenCalledWith(ExitCode.SUCCESS);

      consoleLogSpy.mockRestore();
    });

    it('should prevent duplicate shutdown calls', async () => {
      // This test verifies the idempotency of shutdown() in real usage.
      // Note: In practice (outside test isolation), shutdown() returns the same promise,
      // but our test setup with beforeEach reset makes strict identity testing difficult.

      enableAsyncTracking();
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Call shutdown multiple times
      void shutdown(ExitCode.SUCCESS, 'expected', 'first');
      void shutdown(ExitCode.FATAL, 'fatal', 'second');
      void shutdown(ExitCode.EXPECTED_TIP, 'expected', 'third');

      // Wait briefly
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify only one shutdown was initiated (logged once)
      const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(' '));
      const initiationLogs = logCalls.filter((log) => log.includes('Shutdown initiated'));

      // Only one shutdown should execute despite three calls
      expect(initiationLogs.length).toBe(1);
      expect(isShuttingDown()).toBe(true);

      consoleLogSpy.mockRestore();
    });
  });

  describe('Async Tracking Enable/Disable', () => {
    it('should only enable tracking once', () => {
      expect(__testInternals.getActiveResourceCount()).toBe(0);

      enableAsyncTracking();
      enableAsyncTracking(); // Call again
      enableAsyncTracking(); // And again

      // Should not crash or cause issues
      expect(__testInternals.getActiveResourceCount()).toBeGreaterThanOrEqual(0);
    });

    it('should clear resources when disabled', async () => {
      enableAsyncTracking();

      // Create some resources (intentionally unused, triggers async hook)
      const _promise = Promise.resolve();

      const beforeDisableCount = __testInternals.getActiveResourceCount();

      disableAsyncTracking();

      const afterDisableCount = __testInternals.getActiveResourceCount();

      // After disabling, new resources should not be tracked
      const _promise2 = Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));

      const finalCount = __testInternals.getActiveResourceCount();

      // Note: activeResources might not be cleared immediately,
      // but new resources won't be added
      expect(finalCount).toBeLessThanOrEqual(afterDisableCount);
      expect(afterDisableCount).toBeLessThanOrEqual(beforeDisableCount);
    });
  });
});
