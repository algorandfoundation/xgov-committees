export const BLOCK_TOLERANCE_FOR_1M = 900; // 42m at 2.8s per block

/**
 * Returns true if a 100K block boundary was crossed in the [from, to] interval.
 */
export function crossed100KBoundary(from: number, to: number): boolean {
  if (from <= to) return Math.floor(to / 100_000) > Math.floor((from - 1) / 100_000);
  throw new Error(`Invalid arguments: from (${from}) must be less than or equal to (${to})`);
}

/**
 * Returns the next 1M boundary (% 1_000_000) after `round`.
 */
export function next1MBoundary(round: number): number {
  return Math.ceil((round + 1) / 1_000_000) * 1_000_000;
}

/**
 * Returns true if `round` is close enough to the next 1M boundary.
 */
export function closeTo1MBoundary(round: number): boolean {
  return next1MBoundary(round) - round <= BLOCK_TOLERANCE_FOR_1M;
}
