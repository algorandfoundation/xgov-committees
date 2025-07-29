import { join } from "path";
import { getNetworkIDs, NetworkIDs } from "./algod";
import { getBlocks } from "./blocks";
import { ensureCachePathExists, getCachePath } from "./cache";
import { config } from "./config";
import { getBlockProposers, ProposerMap } from "./proposers";
import { writeFile } from "fs/promises";

const networkIDs = await getNetworkIDs();

await ensureCachePathExists(networkIDs);

const { fromBlock, toBlock } = config;

const rnds = new Array(toBlock - fromBlock)
  .fill(1)
  .map((_, i) => fromBlock + i);

await getBlocks(rnds, networkIDs);

const proposers = await getBlockProposers(rnds, networkIDs);

await saveProposers(proposers, networkIDs, fromBlock, toBlock);

async function saveProposers(
  proposers: ProposerMap,
  networkIDs: NetworkIDs,
  fromBlock: number,
  toBlock: number
) {
    const cacheSubPath = "proposers"
    const cachePath = getCachePath(networkIDs, cacheSubPath)
    await ensureCachePathExists(networkIDs, cacheSubPath);

    const filePath = join(cachePath, `${fromBlock}-${toBlock}.jsons`)
    console.log(`Writing proposers to ${filePath}`)

    await writeFile(filePath, serializeProposers(proposers))
}

function serializeProposers(proposers: ProposerMap) {
    let s = ``
    for(const [proposer, rounds] of proposers.entries()) {
        s += JSON.stringify({ [proposer]: rounds }) + "\n"
    }
    return s
}