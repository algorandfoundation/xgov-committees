import pMap from "p-map";
import { NetworkIDs } from "./algod";
import { getBlock } from "./blocks";
import { chunk, sleep } from "./utils";
import { writeFile } from "fs/promises";
import { join } from "path";
import { ensureCachePathExists } from "./cache";
import { getCachePath } from "./cache/utils";

export type ProposerMap = Map<string, number[]>;

export async function getBlockProposers(rnds: number[]): Promise<ProposerMap> {
  const proposers: ProposerMap = new Map();

  let total = rnds.length;
  let processed = 0;
  const chunks = chunk(rnds, 100_000);
  for (const chunked of chunks) {
    await pMap(
      chunked,
      async (rnd) => {
        const {
          proposer: proposerAddr,
          round,
          genesisHash,
        } = await getBlock(rnd);
        const proposer = proposerAddr.toString();

        const existingRounds = proposers.get(proposer) ?? [];
        proposers.set(proposer, [...existingRounds, rnd]);

        processed++;
        const percent = ((100 * processed) / total).toFixed(2);
        process.stdout.write(
          `\rBlock proposer:\t${rnd} ${processed}/${total} ${percent}%`
        );
      },
      { concurrency: 1_000 }
    );
    await sleep(50); // pause for gb
  }

  process.stdout.write(
    `\r                                                        `
  );
  process.stdout.write(`\rProposer data:\t${total} OK\n`);
  return proposers;
}

export async function saveProposers(
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