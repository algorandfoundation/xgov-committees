import { getBlocks } from "./blocks";
import { ensureCacheSubPathExists } from "./cache";
import { cacheManager } from "./cache/cache-manager";
import {
  getCandidateCommittee,
  loadCandidateCommittee,
  saveCandidateCommittee,
} from "./candidate-committee";
import { getCommittee, loadCommittee, saveCommittee } from "./committee";
import { config } from "./config";
import { getBlockProposers, loadProposers, saveProposers } from "./proposers";
import { getSubscribedXgovs, loadSubscribedXgovs, saveSubscribedXgovs } from "./subscribed-xgovs";
import { makeRndsArray } from "./utils";

await ensureCacheSubPathExists("blocks");

const { fromBlock, toBlock, registryAppId } = config;

let committee = await loadCommittee(fromBlock, toBlock)

if (!committee) {
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

  let subscribedxGovs = await loadSubscribedXgovs(fromBlock, toBlock)
  if (!subscribedxGovs) {
    subscribedxGovs = await getSubscribedXgovs()
    await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs)
  }

  committee = getCommittee(fromBlock, toBlock, registryAppId, candidateCommittee, subscribedxGovs)
  await saveCommittee(fromBlock, toBlock, committee)
}

