import { shutdownCache } from './cache/cache-manager';

export const ExitCode = {
  SUCCESS: 0,
  EXPECTED_TIP: 10,
  FATAL: 1,
} as const;

let shuttingDown = false;
let shutdownPromise: Promise<never> | null = null;

type ShutdownReason = 'signal' | 'expected' | 'fatal';

export async function shutdown(exitCode: number, reason: ShutdownReason, message?: string) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  if (!shuttingDown) {
    shuttingDown = true;

    shutdownPromise = (async () => {
      console.log(`Shutdown (${reason})`, message ?? '');

      try {
        await shutdownCache();
      } catch (err) {
        console.error('Cleanup failed:', err);
      }

      // This will terminate the process; the Promise will never resolve.
      process.exit(exitCode);
    })();
  }

  return shutdownPromise;
}

export async function gracefulShutdown(signal: string) {
  await shutdown(0, 'signal', signal);
}

export async function expectedExit(code: number, message: string) {
  await shutdown(code, 'expected', message);
}

export async function fatalError(err: unknown) {
  console.error('Fatal error:', err);
  await shutdown(1, 'fatal');
}
