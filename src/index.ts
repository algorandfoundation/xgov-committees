import { networkIDs } from "./algod";
import { getBlocks } from "./blocks";
import { ensureCachePathExists,  } from "./cache";
import { cacheManager } from "./cache/cache-manager";
import { config } from "./config";
import { getBlockProposers, saveProposers } from "./proposers";

await ensureCachePathExists(networkIDs);

const { fromBlock, toBlock } = config;
const rnds = new Array(toBlock - fromBlock)
  .fill(1)
  .map((_, i) => fromBlock + i);

await getBlocks(rnds);
await cacheManager.flushAllPages();

const proposers = await getBlockProposers(rnds);
await saveProposers(proposers, networkIDs, fromBlock, toBlock);