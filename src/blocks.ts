import pMap from "p-map";
import { config } from "./config";
import { NetworkIDs, algod } from "./algod";
import { removeCached, hasCache, getCache, setCache } from "./cache";
import { chunk, sleep } from "./utils";
import { BlockHeader } from "algosdk";

export const getBlocks = async (rnds: number[], networkIDs: NetworkIDs) => {
  let total = rnds.length;
  const startBlock = rnds[0]
  const endBlock = rnds.at(-1)

  const requiredRnds = await removeCached(rnds, networkIDs);
  let processed = rnds.length - requiredRnds.length;

  console.log(
    `Start block:\t${startBlock}\nEnd block:\t${endBlock}\nTotal blocks:\t${total}\nExisting:\t${processed}\nRemaining:\t${
      total - processed
    }`
  );

  const chunks = chunk(requiredRnds, 10_000);
  let run = true;
  for (const chunk of chunks) {
    try {
      await pMap(chunk, (rnd) => getBlockWithStatus(rnd, networkIDs), {
        concurrency: config.concurrency,
      });
    } catch (e) {
        console.error(e)
        await sleep(2000) // for fs flushing
        process.exit(1)
    }

    await sleep(50); // pause for gc
  }

  process.stdout.write(
    `\r                                                        `
  );
  process.stdout.write(`\rBlock data: \t${total} OK\n`);

  async function getBlockWithStatus(rnd: number, networkIDs: NetworkIDs): Promise<BlockHeader> {
    const data = await getBlock(rnd, networkIDs);
    processed++;
    const percent = ((100 * processed) / total).toFixed(2);
    process.stdout.write(
      `\rFetching block:\t${rnd} ${processed}/${total} ${percent}%`
    );
    return data;
  }
};

export const getBlock = async (rnd: number, networkIDs: NetworkIDs): Promise<BlockHeader> => {
  if (await hasCache(rnd, networkIDs)) {
    try {
        return await getCache(rnd, networkIDs);
    } catch(e) {
        console.error("\nCorrupted cache file: ", rnd)
    }
  }
  const data = await algod.block(rnd).do();
  setCache(rnd, networkIDs, data.block.header);
  return data.block.header;
};
