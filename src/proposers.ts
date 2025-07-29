import pMap from "p-map";
import { NetworkIDs } from "./algod";
import { getCache } from "./cache";
import { getBlock, getBlocks } from "./blocks";

export type ProposerMap = Map<string, number[]>;

export async function getBlockProposers(
  rnds: number[],
  networkIDs: NetworkIDs
): Promise<ProposerMap> {
  const proposers: ProposerMap = new Map();
  
  let total = rnds.length;
  let processed = 0;

  await Promise.all(
    rnds.map(async (rnd) => {
      const {
        proposer: proposerAddr,
        round,
        genesisHash,
      } = await getBlock(rnd, networkIDs);
      const proposer = proposerAddr.toString();

      if (Number(round) !== rnd) {
        throw new Error(
          `Unexpected data, found ${round} data in file ${rnd}`
        );
      }

      const actualGenesisHash = Buffer.from(genesisHash).toString("base64");
      if (actualGenesisHash !== networkIDs.genesisHash) {
        throw new Error(
          `Unexpected genesis hash, found ${actualGenesisHash}, expected ${networkIDs.genesisHash}`
        );
      }

      const existingRounds = proposers.get(proposer) ?? [];
      proposers.set(proposer, [...existingRounds, rnd]);

      processed++;
      const percent = ((100 * processed) / total).toFixed(2);
      process.stdout.write(
        `\rBlock proposer:\t${rnd} ${processed}/${total} ${percent}%`
      );
    })
  );
  process.stdout.write(
    `\r                                                        `
  );
  process.stdout.write(`\rProposer data:\t${total} OK\n`);
  return proposers;
}
