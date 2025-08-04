import { networkIDs } from "./algod";
import { getBlocks } from "./blocks";
import { ensureCachePathExists } from "./cache";
import { cacheManager } from "./cache/cache-manager";
import {
  getCandidateCommittee,
  loadCandidateCommittee,
  saveCandidateCommittee,
} from "./candidate-committee";
import { config } from "./config";
import { getBlockProposers, loadProposers, saveProposers } from "./proposers";
import { makeRndsArray } from "./utils";

await ensureCachePathExists();

const { fromBlock, toBlock } = config;

let candidateCommittee = await loadCandidateCommittee(fromBlock, toBlock);
if (!candidateCommittee) {
  let proposers = await loadProposers(fromBlock, toBlock);
  if (!proposers) {
    const rnds = makeRndsArray(fromBlock, toBlock);

    await getBlocks(rnds);
    await cacheManager.flushAllPages();

    proposers = await getBlockProposers(rnds);
    await saveProposers(fromBlock, toBlock, proposers);
  }

  candidateCommittee = await getCandidateCommittee(proposers);
  saveCandidateCommittee(fromBlock, toBlock, candidateCommittee);
}
