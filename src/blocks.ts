import pMap from "p-map";
import { config } from "./config";
import { algod, networkIDs } from "./algod";
import { subtractCached, getCache, setCache } from "./cache";
import { chunk, formatDuration, sleep } from "./utils";
import { BlockHeader } from "algosdk";

export const getBlocks = async (rnds: number[]) => {
  let total = rnds.length;
  let v = "";
  const startBlock = rnds[0];
  const endBlock = rnds.at(-1);

  const requiredRnds = await subtractCached(rnds, networkIDs);
  let processed = rnds.length - requiredRnds.length;

  console.log(`Network:\t${networkIDs.genesisID}`)
  console.log(`Node:   \t${config.algodServer}`)

  console.log(
    `Start block:\t${startBlock}\nEnd block:\t${endBlock}\nTotal blocks:\t${total}\nExisting:\t${processed}\nRemaining:\t${
      total - processed
    }`
  );

  const chunks = chunk(requiredRnds, 1_000);
  let run = true;
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

  process.stdout.write(
    `\r                                                        `
  );
  process.stdout.write(`\rBlock data: \t${total} OK\n`);

  async function getBlockWithStatus(rnd: number): Promise<BlockHeader> {
    const data = await getBlock(rnd);
    processed++;
    const percent = ((100 * processed) / total).toFixed(2);
    const etaSec = (total - processed) / parseFloat(v);
    process.stdout.write(
      `\rFetching block:\t${rnd} ${processed}/${total} ${percent}%${
        v ? ` ${v} rnd/sec ETA ${formatDuration(etaSec)}` : ""
      }`
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
      if (actualGenesisHash !== networkIDs.genesisHash) {
        throw new Error(
          `Unexpected genesis hash, found ${actualGenesisHash}, expected ${networkIDs.genesisHash}`
        );
      }

      return cached;
    } catch (e) {
      console.error(`Error in cached file ${rnd}:`, (e as Error).message);
      console.log("Refetching: ", rnd);
    }
  }
  const data = await algod.block(rnd).do();
  setCache(rnd, data.block.header);
  return data.block.header;
};
