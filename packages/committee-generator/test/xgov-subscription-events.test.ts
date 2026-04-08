import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encodeAddress, decodeAddress, ABIType } from 'algosdk';
import { getARC28Prefix } from '../src/utils.ts';

// ---- Test fixtures ----
// Valid Algorand addresses derived from known public keys (filled byte patterns)
const XGOV_1 = encodeAddress(new Uint8Array(32).fill(1));
const XGOV_2 = encodeAddress(new Uint8Array(32).fill(2));
const DELEGATE_1 = encodeAddress(new Uint8Array(32).fill(3));

// ---- Mocks ----
vi.mock('../src/indexer.ts', () => ({
  indexer: {
    lookupApplicationLogs: vi.fn(),
    lookupTransactionByID: vi.fn(),
  },
}));

// ---- ARC28 log builders ----

function buildSubscribedLog(xgovAddr: string, delegateAddr: string): Uint8Array {
  const prefix = getARC28Prefix('XGovSubscribed(address,address)');
  const encoded = ABIType.from('(address,address)').encode([
    decodeAddress(xgovAddr).publicKey,
    decodeAddress(delegateAddr).publicKey,
  ]);
  const result = new Uint8Array(prefix.length + encoded.length);
  result.set(prefix, 0);
  result.set(encoded, prefix.length);
  return result;
}

function buildUnsubscribedLog(xgovAddr: string): Uint8Array {
  const prefix = getARC28Prefix('XGovUnsubscribed(address)');
  const encoded = ABIType.from('(address)').encode([decodeAddress(xgovAddr).publicKey]);
  const result = new Uint8Array(prefix.length + encoded.length);
  result.set(prefix, 0);
  result.set(encoded, prefix.length);
  return result;
}

type LogEntry = { txid: string; logs: Uint8Array[] };
type LogsPage = { logData?: LogEntry[]; nextToken?: string };

/**
 * Configures the mocked indexer for a series of paginated responses.
 * `txRounds` maps txid → confirmed round for `lookupTransactionByID`.
 */
function setupIndexerMock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  indexer: any,
  pages: LogsPage[],
  txRounds: Record<string, bigint>,
) {
  let pageIdx = 0;
  vi.mocked(indexer.lookupApplicationLogs).mockImplementation(() => {
    const chain: ReturnType<typeof vi.fn> & Record<string, unknown> = {
      minRound: () => chain,
      maxRound: () => chain,
      nextToken: () => chain,
      limit: () => ({ do: vi.fn().mockResolvedValue(pages[pageIdx++] ?? {}) }),
    } as never;
    return chain;
  });

  vi.mocked(indexer.lookupTransactionByID).mockImplementation((txid: string) => ({
    do: vi.fn().mockResolvedValue({
      transaction: { confirmedRound: txRounds[txid] },
    }),
  }));
}

// ---- Tests ----

describe('getXGovSubscriptionEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty map when there are no log entries', async () => {
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(indexer, [{}], {});

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    expect(result.size).toBe(0);
  });

  it('parses a single XGovSubscribed event correctly', async () => {
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(
      indexer,
      [{ logData: [{ txid: 'TX1', logs: [buildSubscribedLog(XGOV_1, DELEGATE_1)] }] }],
      { TX1: 1200n },
    );

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    expect(result.size).toBe(1);
    const events = result.get(XGOV_1);
    expect(events).toBeDefined();
    expect(events?.subscribedEvents).toHaveLength(1);
    expect(events?.subscribedEvents[0]).toEqual({
      xGovAddress: XGOV_1,
      delegateAddress: DELEGATE_1,
      subscribedRound: 1200n,
    });
    expect(events?.unsubscribedEvents).toHaveLength(0);
  });

  it('parses a single XGovUnsubscribed event when no subscribe event is in range (subscribed before cutoff)', async () => {
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(
      indexer,
      [{ logData: [{ txid: 'TX1', logs: [buildUnsubscribedLog(XGOV_1)] }] }],
      { TX1: 1500n },
    );

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    expect(result.size).toBe(1);
    const events = result.get(XGOV_1);
    expect(events).toBeDefined();
    expect(events?.subscribedEvents).toHaveLength(0);
    expect(events?.unsubscribedEvents).toHaveLength(1);
    expect(events?.unsubscribedEvents[0]).toEqual({
      xGovAddress: XGOV_1,
      unsubscribedRound: 1500n,
    });
  });

  it('tracks both subscribe and unsubscribe when both events are in range', async () => {
    // xGov subscribed after the cutoff, then unsubscribed — both events in the queried range
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(
      indexer,
      [
        {
          logData: [
            { txid: 'TX1', logs: [buildSubscribedLog(XGOV_1, DELEGATE_1)] },
            { txid: 'TX2', logs: [buildUnsubscribedLog(XGOV_1)] },
          ],
        },
      ],
      { TX1: 1100n, TX2: 1400n },
    );

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    const events = result.get(XGOV_1);
    expect(events).toBeDefined();
    expect(events?.subscribedEvents).toHaveLength(1);
    expect(events?.subscribedEvents[0]?.subscribedRound).toBe(1100n);
    expect(events?.unsubscribedEvents).toHaveLength(1);
    expect(events?.unsubscribedEvents[0]?.unsubscribedRound).toBe(1400n);
  });

  it('accumulates multiple events of the same type for the same xGov', async () => {
    // xGov unsubscribed, then re-subscribed after cutoff — both events should be preserved
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(
      indexer,
      [
        {
          logData: [
            { txid: 'TX1', logs: [buildUnsubscribedLog(XGOV_1)] },
            { txid: 'TX2', logs: [buildSubscribedLog(XGOV_1, DELEGATE_1)] },
          ],
        },
      ],
      { TX1: 1100n, TX2: 1400n },
    );

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    const events = result.get(XGOV_1);
    expect(events).toBeDefined();
    expect(events?.unsubscribedEvents).toHaveLength(1);
    expect(events?.unsubscribedEvents[0]?.unsubscribedRound).toBe(1100n);
    expect(events?.subscribedEvents).toHaveLength(1);
    expect(events?.subscribedEvents[0]?.subscribedRound).toBe(1400n);
  });

  it('tracks multiple xGovs independently', async () => {
    // XGOV_1: subscribed before cutoff, unsubscribed after (only unsub event in range)
    // XGOV_2: subscribed and unsubscribed both within the range
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(
      indexer,
      [
        {
          logData: [
            { txid: 'TX1', logs: [buildUnsubscribedLog(XGOV_1)] },
            { txid: 'TX2', logs: [buildSubscribedLog(XGOV_2, DELEGATE_1)] },
            { txid: 'TX3', logs: [buildUnsubscribedLog(XGOV_2)] },
          ],
        },
      ],
      { TX1: 1200n, TX2: 1100n, TX3: 1300n },
    );

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    expect(result.size).toBe(2);

    const xgov1Events = result.get(XGOV_1);
    expect(xgov1Events).toBeDefined();
    expect(xgov1Events?.subscribedEvents).toHaveLength(0);
    expect(xgov1Events?.unsubscribedEvents).toHaveLength(1);
    expect(xgov1Events?.unsubscribedEvents[0]?.unsubscribedRound).toBe(1200n);

    const xgov2Events = result.get(XGOV_2);
    expect(xgov2Events).toBeDefined();
    expect(xgov2Events?.subscribedEvents).toHaveLength(1);
    expect(xgov2Events?.subscribedEvents[0]?.subscribedRound).toBe(1100n);
    expect(xgov2Events?.unsubscribedEvents).toHaveLength(1);
    expect(xgov2Events?.unsubscribedEvents[0]?.unsubscribedRound).toBe(1300n);
  });

  it('caches txid round lookups — same txid across events triggers only one indexer call', async () => {
    // Two events share the same txid; lookupTransactionByID should only be called once
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(
      indexer,
      [
        {
          logData: [
            {
              txid: 'SHARED_TX',
              logs: [buildSubscribedLog(XGOV_1, DELEGATE_1), buildUnsubscribedLog(XGOV_2)],
            },
          ],
        },
      ],
      { SHARED_TX: 1200n },
    );

    await getXGovSubscriptionEvents(1000n, 2000n);

    expect(vi.mocked(indexer.lookupTransactionByID)).toHaveBeenCalledTimes(1);
  });

  it('collects events from all pages when results are paginated', async () => {
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    setupIndexerMock(
      indexer,
      [
        {
          logData: [{ txid: 'TX1', logs: [buildSubscribedLog(XGOV_1, DELEGATE_1)] }],
          nextToken: 'page-2-token',
        },
        {
          logData: [{ txid: 'TX2', logs: [buildUnsubscribedLog(XGOV_1)] }],
        },
      ],
      { TX1: 1100n, TX2: 1400n },
    );

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    const events = result.get(XGOV_1);
    expect(events).toBeDefined();
    expect(events?.subscribedEvents).toHaveLength(1);
    expect(events?.subscribedEvents[0]?.subscribedRound).toBe(1100n);
    expect(events?.unsubscribedEvents).toHaveLength(1);
    expect(events?.unsubscribedEvents[0]?.unsubscribedRound).toBe(1400n);
  });

  it('silently skips logs with unrecognized event prefixes and still processes valid events', async () => {
    const { indexer } = await import('../src/indexer.ts');
    const { getXGovSubscriptionEvents } = await import('../src/xgov-subscription-events.ts');

    // A log with an unknown 4-byte prefix followed by an arbitrary payload
    const unknownLog = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...new Uint8Array(32)]);

    setupIndexerMock(
      indexer,
      [
        {
          logData: [
            {
              txid: 'TX1',
              logs: [unknownLog, buildSubscribedLog(XGOV_1, DELEGATE_1)],
            },
          ],
        },
      ],
      { TX1: 1200n },
    );

    const result = await getXGovSubscriptionEvents(1000n, 2000n);

    // Unknown log skipped; valid subscribed event still processed
    expect(result.size).toBe(1);
    const events = result.get(XGOV_1);
    expect(events).toBeDefined();
    expect(events?.subscribedEvents).toHaveLength(1);
  });
});
