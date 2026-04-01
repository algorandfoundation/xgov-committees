import { config } from './config';
import { indexer } from './indexer';
import { getARC28EventFromLog, getARC28Prefix } from './utils';

const { registryAppId } = config;

type XGovSubscriptionEvents = Map<
  string,
  {
    subscribedEvents: { xGovAddress: string; delegateAddress: string; subscribedRound: bigint }[];
    unsubscribedEvents: { xGovAddress: string; unsubscribedRound: bigint }[];
  }
>;

/**
 * Event Signatures
 */
const XGovEventSignatures = {
  XGovSubscribed: 'XGovSubscribed(address,address)',
  XGovUnsubscribed: 'XGovUnsubscribed(address)',
} as const;

/**
 * Event Prefixes
 */
const XGovEventPrefixes = {
  XGovSubscribed: getARC28Prefix(XGovEventSignatures.XGovSubscribed),
  XGovUnsubscribed: getARC28Prefix(XGovEventSignatures.XGovUnsubscribed),
} as const;

/**
 * Get xGov subscription and unsubscription events between fromRound and toRound (inclusive)
 * @param fromRound - starting round number
 * @param toRound - ending round number
 * @returns a map of xGov addresses to their subscription and unsubscription events
 * @throws Error if there is an issue fetching logs or decoding events
 */
export const getXGovSubscriptionEvents = async (
  fromRound: bigint,
  toRound: bigint,
): Promise<XGovSubscriptionEvents> => {
  let nextToken: string | undefined = '';
  const allLogs = [];

  while (true) {
    const r = await indexer
      .lookupApplicationLogs(registryAppId)
      .minRound(fromRound)
      .maxRound(toRound) // indexer maxRound is inclusive, we want to include toRound
      .nextToken(nextToken)
      .limit(1000)
      .do();

    if (r.logData) {
      allLogs.push(...r.logData);

      if (config.verbose) {
        console.log(
          `Fetched page of application logs with ${r.logData.length} logs. Next token: ${r.nextToken}`,
        );
      }
    }

    if (!r.nextToken) {
      break;
    }

    nextToken = r.nextToken;
  }

  const confirmedRoundCache: Record<string, bigint> = {};
  let txidLookupsDone = 0;
  let txidCacheHits = 0;

  const lookupTxConfirmedRound = async (txid: string): Promise<bigint> => {
    if (txid in confirmedRoundCache) {
      txidCacheHits++;
      return confirmedRoundCache[txid];
    }

    txidLookupsDone++;
    if (config.verbose) {
      console.log(
        `[txid lookup ${txidLookupsDone}, cache hits: ${txidCacheHits}] Resolving txid: ${txid}`,
      );
    }

    const {
      transaction: { confirmedRound },
    } = await indexer.lookupTransactionByID(txid).do();
    if (!confirmedRound) {
      // edge case, should not be reached
      throw new Error(`Transaction ${txid} is not confirmed yet`);
    }
    confirmedRoundCache[txid] = BigInt(confirmedRound);
    return BigInt(confirmedRound);
  };

  const xGovEvents: XGovSubscriptionEvents = new Map();

  for (const logData of allLogs) {
    for (const log of logData.logs) {
      try {
        const actualPrefix = Buffer.from(log.subarray(0, 4));
        const isSubscribedEvent = actualPrefix.compare(XGovEventPrefixes.XGovSubscribed) === 0;

        if (isSubscribedEvent || actualPrefix.compare(XGovEventPrefixes.XGovUnsubscribed) === 0) {
          const confirmedAt: bigint = await lookupTxConfirmedRound(logData.txid);

          if (isSubscribedEvent) {
            // sub
            const { xgov_address, delegate_address } = getARC28EventFromLog(
              XGovEventSignatures.XGovSubscribed,
              log,
              ['xgov_address', 'delegate_address'],
            );

            const subscribeEvent = {
              xGovAddress: xgov_address,
              delegateAddress: delegate_address,
              subscribedRound: confirmedAt,
            };

            xGovEvents.set(xgov_address, {
              subscribedEvents: [
                ...(xGovEvents.get(xgov_address)?.subscribedEvents ?? []),
                subscribeEvent,
              ],
              unsubscribedEvents: xGovEvents.get(xgov_address)?.unsubscribedEvents ?? [],
            });
          } else {
            // unsub
            const { xgov_address } = getARC28EventFromLog(
              XGovEventSignatures.XGovUnsubscribed,
              log,
              ['xgov_address'],
            );

            const unsubscribeEvent = {
              xGovAddress: xgov_address,
              unsubscribedRound: confirmedAt,
            };

            xGovEvents.set(xgov_address, {
              subscribedEvents: xGovEvents.get(xgov_address)?.subscribedEvents ?? [],
              unsubscribedEvents: [
                ...(xGovEvents.get(xgov_address)?.unsubscribedEvents ?? []),
                unsubscribeEvent,
              ],
            });
          }
        }
      } catch (e) {
        console.warn(`Failed to parse logs: ${(e as Error).message}`);
      }
    }
  }

  const totalSubs = [...xGovEvents.values()].reduce((n, v) => n + v.subscribedEvents.length, 0);
  const totalUnsubs = [...xGovEvents.values()].reduce((n, v) => n + v.unsubscribedEvents.length, 0);

  if (config.verbose) {
    console.log(
      `Resolved ${txidLookupsDone + txidCacheHits} txids (${txidLookupsDone} lookups, ${txidCacheHits} cache hits)`,
    );
    console.log(
      `Found ${totalSubs} xGov subscription and ${totalUnsubs} unsubscription events in logs between rounds ${fromRound} and ${toRound}`,
    );
  }

  return xGovEvents;
};
