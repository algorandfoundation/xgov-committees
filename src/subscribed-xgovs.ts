import { decodeUint64, encodeAddress } from "algosdk";
import { algod } from "./algod";
import { config } from "./config";
import pMap from "p-map";
import { getCachePath } from "./cache/utils";
import { ensureCacheSubPathExists } from "./cache";
import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import { clearLine, fsExists } from "./utils";

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

const label = "subscribed xGovs";
const cacheSubPath = "subscribed-xGovs";

const { toBlock: cutoffBlock, registryAppId, concurrency, verbose } = config;
const xgovBoxPrefix = "x".charCodeAt(0);

export async function getSubscribedXgovs({
  force,
}: {
  force?: true;
} = {}): Promise<string[]> {
  const { lastRound } = await algod.status().do();

  if (lastRound < cutoffBlock) {
    const msg = `xGov subscription cutoff round ${cutoffBlock} has not elapsed! Current round: ${lastRound}`;
    if (!force) {
      throw new Error(`${msg}`);
    } else {
      console.warn(`WARNING! ${msg}. Ignoring because force:true`);
    }
  }

  const { boxes: registryBoxes } = await algod
    .getApplicationBoxes(registryAppId)
    .do();
  const xgovBoxes = registryBoxes
    .filter(({ name }) => name[0] === xgovBoxPrefix)
    .map(({ name }) => name);
  console.log(
    `Found ${xgovBoxes.length} subscribed xGovs. Querying subscription rounds. Cutoff_block=${cutoffBlock} `
  );

  let ignored = 0;
  const xGovs: string[] = [];
  await pMap(
    xgovBoxes,
    async (xgovBox: Uint8Array) => {
      const address = encodeAddress(xgovBox.slice(1));
      const { value } = await algod
        .getApplicationBoxByName(registryAppId, xgovBox)
        .do();

      // see top - subscribed is at offset 48, length 8
      const subscribedRound = decodeUint64(value.slice(48, 56), "safe");

      if (subscribedRound <= cutoffBlock) {
        if (config.verbose) {
          console.log(`xGov subscribed at ${subscribedRound} ${address}`);
        }
        xGovs.push(address);
      } else {
        ignored++;
        if (verbose) {
          console.warn(
            `Ignoring xGov subscribed (${subscribedRound}) after cutoff (${cutoffBlock}): ${address}`
          );
        }
      }
    },
    { concurrency }
  );

  if (ignored) {
    console.log(
      `Ignoring ${ignored} xGov(s) that subscribed after the cutoff round (${cutoffBlock})`
    );
  }

  console.log(
    `Found ${xGovs.length} xGovs subscribed before cutoff round ${cutoffBlock}`
  );

  return xGovs;
}

export async function loadSubscribedXgovs(
  fromBlock: number,
  toBlock: number
): Promise<string[] | undefined> {
  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);

  if (await fsExists(filePath)) {
    process.stderr.write(`Trying to load ${label} cache ${filePath}`);
    try {
      const fileContents = (await readFile(filePath)).toString();
      const subscribed = JSON.parse(fileContents) as string[];
      clearLine();
      console.log(`\rUsing cached ${label} file: ${filePath}`);
      return subscribed;
    } catch (e) {
      console.warn(`\nIgnoring ${label} file: ${(e as Error).message}`);
    }
  }
}

export async function saveSubscribedXgovs(
  fromBlock: number,
  toBlock: number,
  subscribed: string[]
): Promise<void> {
  await ensureCacheSubPathExists(cacheSubPath);

  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);
  console.log(`Writing ${label} to ${filePath}`);

  await writeFile(filePath, JSON.stringify(subscribed));
}
