import { shutdownCache } from './cache/cache-manager';

export const ExitCode = {
  SUCCESS: 0,
  EXPECTED_TIP: 10,
  FATAL: 1,
} as const;

let shuttingDown = false;

type ShutdownReason = 'signal' | 'expected' | 'fatal';

export async function shutdown(exitCode: number, reason: ShutdownReason, message?: string) {
  if (!shuttingDown) {
    shuttingDown = true;

    console.log(`Shutdown (${reason})`, message ?? '');

    try {
      await shutdownCache();
    } catch (err) {
      console.error('Cleanup failed:', err);
    }

    process.exit(exitCode);
  }
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
