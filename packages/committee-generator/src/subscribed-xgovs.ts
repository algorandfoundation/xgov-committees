import { decodeUint64, encodeAddress } from 'algosdk';
import { algod } from './algod.ts';
import { config } from './config.ts';
import pMap from 'p-map';
import { getCachePath } from './cache/utils.ts';
import { ensureCacheSubPathExists } from './cache/index.ts';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { getXGovSubscriptionEvents } from './xgov-subscription-events.ts';
import { getKeyWithNetworkMetadata, getPublicUrlForObject, uploadData } from './s3/index.ts';
import { clearLine, fsExists } from './utils.ts';
/*
    Gets subscribed xGovs from registry contract

    box keys: "x" + address
    box values: 
        class XGovBoxValue(arc4.Struct)        offset  len
        voting_address: arc4.Address            0       32
        voted_proposals: arc4.UInt64            32      8
        last_vote_timestamp: arc4.UInt64        40      8
        subscription_round: arc4.UInt64         48      8
*/

export type XGovsRecord = Record<string, number>;

const label = 'subscribed xGovs';
const cacheSubPath = 'subscribed-xGovs';

const { toBlock: cutoffBlock, registryAppId, concurrency, verbose } = config;
const xgovBoxPrefix = 'x'.charCodeAt(0);

export async function getSubscribedXgovs({
  force,
}: {
  force?: true;
} = {}): Promise<XGovsRecord> {
  const { lastRound } = await algod.status().do();

  if (lastRound < cutoffBlock) {
    const msg = `xGov subscription cutoff round ${cutoffBlock} has not elapsed! Current round: ${lastRound}`;
    if (!force) {
      throw new Error(`${msg}`);
    } else {
      console.warn(`WARNING! ${msg}. Ignoring because force:true`);
    }
  }

  const { boxes: registryBoxes } = await algod.getApplicationBoxes(registryAppId).do();
  const xgovBoxes = registryBoxes
    .filter(({ name }) => name[0] === xgovBoxPrefix)
    .map(({ name }) => name);
  console.log(
    `Found ${xgovBoxes.length} xGovs. Querying subscription rounds. Cutoff_block=${cutoffBlock} `,
  );

  // ignored xgovs are those that have subscribed after the cutoff round
  const ignored: string[] = [];

  const xGovs: XGovsRecord = {};
  await pMap(
    xgovBoxes,
    async (xgovBox: Uint8Array) => {
      const address = encodeAddress(xgovBox.slice(1));
      const { value } = await algod.getApplicationBoxByName(registryAppId, xgovBox).do();

      // see top - subscribed is at offset 48, length 8
      const subscribedRound = decodeUint64(value.slice(48, 56), 'safe');

      // TODO is subscription at exactly cutoff eligible or not?
      // 3M range is [) end-exclusive so I think not
      if (subscribedRound < cutoffBlock) {
        if (config.verbose) {
          console.log(`xGov subscribed at ${subscribedRound} ${address}`);
        }
        xGovs[address] = subscribedRound;
      } else {
        ignored.push(address);
        if (verbose) {
          console.warn(
            `Ignoring xGov subscribed (${subscribedRound}) after cutoff (${cutoffBlock}): ${address}`,
          );
        }
      }
    },
    { concurrency },
  );

  if (ignored.length > 0) {
    console.log(
      `Ignoring ${ignored.length} xGov(s) that subscribed after the cutoff round (${cutoffBlock})`,
    );
  }

  console.log(
    `Found ${Object.keys(xGovs).length} xGovs subscribed before cutoff round ${cutoffBlock}`,
  );

  // Query from before registry creation (52307574) to capture the full ARC-28 event history.
  // Subscribers with no XGovSubscribed event in this window pre-date ARC-28 being wired in.
  const XGOV_EVENTS_FROM_ROUND = 50000000n;
  const xGovEvents = await getXGovSubscriptionEvents(XGOV_EVENTS_FROM_ROUND, BigInt(lastRound));

  let unsubAfterCutOffCount = 0;

  for (const [xGovAddress, { subscribedEvents, unsubscribedEvents }] of xGovEvents.entries()) {
    const hasUnsubAfterCutoff = unsubscribedEvents.some((e) => e.unsubscribedRound > cutoffBlock);
    if (!hasUnsubAfterCutoff) continue;

    // Replay events chronologically to determine state at cutoff.
    const allEvents = [
      ...subscribedEvents.map((e) => ({ round: e.subscribedRound, type: 'subscribe' as const })),
      ...unsubscribedEvents.map((e) => ({ round: e.unsubscribedRound, type: 'unsub' as const })),
    ].sort((a, b) => (a.round < b.round ? -1 : 1));

    const lastEventBeforeCutoff = allEvents.filter((e) => e.round < BigInt(cutoffBlock)).at(-1);

    // undefined + no subscribe events → subscribed before ARC-28 was deployed → eligible.
    // undefined + has subscribe events → all subs are after cutoff → never eligible.
    const subscribedAtCutoff =
      lastEventBeforeCutoff === undefined
        ? subscribedEvents.length === 0
        : lastEventBeforeCutoff.type === 'subscribe';

    if (subscribedAtCutoff) {
      unsubAfterCutOffCount++;

      if (config.verbose) {
        if (lastEventBeforeCutoff === undefined) {
          console.log(
            `xGov unsubscribed after cutoff, no events before cutoff (pre-ARC28 subscriber): ${xGovAddress}`,
          );
        } else {
          console.log(
            `xGov subscribed at ${lastEventBeforeCutoff.round} and unsubscribed after cutoff: ${xGovAddress}`,
          );
        }
      }

      // lastEventBeforeCutoff is always a 'subscribe' here ('unsub' excluded by subscribedAtCutoff).
      // For pre-ARC28 subscribers the real round is unknown; cutoffBlock - 1 is a deterministic placeholder.
      xGovs[xGovAddress] =
        lastEventBeforeCutoff !== undefined ? Number(lastEventBeforeCutoff.round) : cutoffBlock - 1;
    } else if (config.verbose) {
      console.log(
        `xGov last action before cutoff was unsub (round ${lastEventBeforeCutoff!.round}) — not eligible, skipping: ${xGovAddress}`,
      );
    }
  }

  console.log(unsubAfterCutOffCount, 'xGovs unsubscribed after cutoff');

  return xGovs;
}

export async function loadSubscribedXgovs(
  fromBlock: number,
  toBlock: number,
  from: 'local' | 's3' = 'local',
): Promise<XGovsRecord | undefined> {
  if (from === 's3') {
    const url = getPublicUrlForObject(`${cacheSubPath}/${fromBlock}-${toBlock}.json`);

    try {
      const res = await fetch(url);
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`Fetching ${url} failed: ${res.status}`);
      const subscribed = await res.json();
      console.log(`Using cached S3 subscribed-xGovs: ${url}`);
      return subscribed as XGovsRecord;
    } catch (e) {
      console.warn(`S3 fetch failed for ${url}: ${(e as Error).message}`);
      throw e;
    }
  }
  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);

  if (await fsExists(filePath)) {
    process.stderr.write(`Trying to load ${label} cache ${filePath}`);
    try {
      const fileContents = (await readFile(filePath)).toString();
      const subscribed = JSON.parse(fileContents) as XGovsRecord;
      clearLine();
      console.log(`\rUsing cached ${label} file: ${filePath}`);
      return subscribed;
    } catch (e) {
      console.warn(`\nIgnoring cached ${label} file: ${(e as Error).message}`);
    }
  }
}

export async function saveSubscribedXgovs(
  fromBlock: number,
  toBlock: number,
  subscribed: XGovsRecord,
  to: 'local' | 's3' = 'local',
): Promise<void> {
  if (to === 's3') {
    const key = getKeyWithNetworkMetadata(`${cacheSubPath}/${fromBlock}-${toBlock}.json`);

    await uploadData(key, JSON.stringify(subscribed));
    return;
  }

  await ensureCacheSubPathExists(cacheSubPath);

  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);
  console.log(`Writing ${label} to ${filePath}`);

  await writeFile(filePath, JSON.stringify(subscribed));
}
