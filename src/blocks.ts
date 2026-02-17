import pMap from "p-map";
import { config } from "./config";
import { algod, networkMetadata } from "./algod";
import { subtractCached, getCache, setCache } from "./cache";
import { chunk, clearLine, formatDuration, sleep } from "./utils";
import { BlockHeader } from "algosdk";

export const getBlocks = async (rnds: number[]) => {
  let total = rnds.length;
  let v = "";
  const startBlock = rnds[0];
  const endBlock = rnds.at(-1);

  const requiredRnds = await subtractCached(rnds);
  let processed = rnds.length - requiredRnds.length;

  console.log(`Network:\t${networkMetadata.genesisID}`);
  console.log(`Registry app:\t${config.registryAppId}`);
  console.log(`Node:   \t${config.algodServer}`);
  console.log(`Token:  \t${config.algodToken ? "Yes" : "No"}`);
  console.log(`First block:\t${startBlock}`);
  console.log(`Last block:\t${endBlock}`);
  console.log("--");
  console.log(`Total blocks:\t${total}`);
  console.log(`Existing:\t${processed}`);
  console.log(`Remaining:\t${total - processed}`);
  console.log("--");

  const chunks = chunk(requiredRnds, 1_000);
  for (const chunk of chunks) {
    try {
      const start = Date.now();
      await pMap(chunk, (rnd) => getBlockWithStatus(rnd), {
        concurrency: config.concurrency,
      });
      const end = Date.now();
      const elapsed = end - start; // in ms
      v = ((1000 * chunk.length) / elapsed).toFixed(2);
    } catch (e) {
      console.error(e);
      await sleep(2000); // for fs flushing
      process.exit(1);
    }

    await sleep(50); // pause for gc
  }

  clearLine();
  process.stdout.write(`Block data: \t${total} OK\n`);

  async function getBlockWithStatus(rnd: number): Promise<BlockHeader> {
    const data = await getBlock(rnd);
    processed++;
    const percent = ((100 * processed) / total).toFixed(2);
    const etaSec = (total - processed) / parseFloat(v);
    process.stdout.write(
      `\rFetching block:\t${rnd} ${processed}/${total} ${percent}%${
        v ? ` ${v} rnd/sec ETA ${formatDuration(etaSec)}        ` : ""
      }`,
    );
    return data;
  }
};

export const getBlock = async (rnd: number): Promise<BlockHeader> => {
  let cached: BlockHeader | undefined;
  if ((cached = await getCache(rnd))) {
    try {
      const { round, genesisHash } = cached;

      if (Number(round) !== rnd) {
        throw new Error(`Unexpected round, found ${round}, expected ${rnd}`);
      }

      const actualGenesisHash = Buffer.from(genesisHash).toString("base64");
      if (actualGenesisHash !== networkMetadata.genesisHash) {
        throw new Error(
          `Unexpected genesis hash, found ${actualGenesisHash}, expected ${networkMetadata.genesisHash}`,
        );
      }

      return cached;
    } catch (e) {
      console.error(`Error in cached file ${rnd}:`, (e as Error).message);

      // In use-cache mode, don't refetch - fail fast
      if (config.cacheMode === "use-cache") {
        throw new Error(
          `Block ${rnd} is corrupted in S3 cache and cannot be refetched in use-cache mode`,
        );
      }

      console.log("Refetching: ", rnd);
    }
  }

  // In use-cache mode, block should be in cache - fail if not found
  if (config.cacheMode === "use-cache") {
    throw new Error(
      `Block ${rnd} not found in S3 cache. All blocks must be pre-cached when using use-cache mode.`,
    );
  }

  // For other modes, fetch from algod and cache it
  const data = await algod.block(rnd).headerOnly(true).do();
  setCache(rnd, data.block.header);
  return data.block.header;
};
