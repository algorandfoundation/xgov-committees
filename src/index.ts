import { getBlocks } from "./blocks";
import { ensureCacheSubPathExists } from "./cache";
import { cacheManager } from "./cache/cache-manager";
import { ensureCommitteeShortcuts } from "./s3";
import {
  getCandidateCommittee,
  loadCandidateCommittee,
  saveCandidateCommittee,
} from "./candidate-committee";
import {
  getCommittee,
  getCommitteeID,
  loadCommittee,
  saveCommittee,
} from "./committee";
import { config } from "./config";
import { getBlockProposers, loadProposers, saveProposers } from "./proposers";
import {
  getSubscribedXgovs,
  loadSubscribedXgovs,
  saveSubscribedXgovs,
} from "./subscribed-xgovs";
import { makeRndsArray, committeeIdToSafeFileName } from "./utils";

const { cacheMode } = config;

console.log(`Running in cache mode: ${cacheMode}`);

// Only create filesystem cache directories when not using S3-only mode
if (cacheMode !== "use-cache") {
  await ensureCacheSubPathExists("blocks");
}

const { fromBlock, toBlock, registryAppId } = config;

const {
  loadFrom,
  saveTo,
}: { loadFrom: "s3" | "local"; saveTo: "s3" | "local" } =
  cacheMode === "use-cache"
    ? { loadFrom: "s3", saveTo: "local" }
    : cacheMode === "write-cache"
      ? { loadFrom: "s3", saveTo: "s3" }
      : { loadFrom: "s3", saveTo: "local" }; // in validate-cache mode, we load from S3 but save locally for comparison

let committee = await loadCommittee(fromBlock, toBlock, loadFrom);

if (!committee) {
  let candidateCommittee = await loadCandidateCommittee(
    fromBlock,
    toBlock,
    loadFrom,
  );
  if (!candidateCommittee) {
    let proposers = await loadProposers(fromBlock, toBlock, loadFrom);
    if (!proposers) {
      const rnds = makeRndsArray(fromBlock, toBlock);

      await getBlocks(rnds);
      await cacheManager.flushAllPages();

      proposers = await getBlockProposers(rnds);
      await saveProposers(fromBlock, toBlock, proposers, saveTo);
    }

    candidateCommittee = await getCandidateCommittee(proposers);
    saveCandidateCommittee(fromBlock, toBlock, candidateCommittee, saveTo);
  }

  let subscribedxGovs = await loadSubscribedXgovs(fromBlock, toBlock, loadFrom);
  if (!subscribedxGovs) {
    subscribedxGovs = await getSubscribedXgovs();
    await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs, saveTo);
  }

  committee = getCommittee(
    fromBlock,
    toBlock,
    registryAppId,
    candidateCommittee,
    subscribedxGovs,
  );
  await saveCommittee(fromBlock, toBlock, committee, saveTo);

  if (cacheMode === "write-cache") {
    // create shortcuts for latest committee
    await ensureCommitteeShortcuts();
  }
}

const committeeID = getCommitteeID(committee);
const safeCommitteeID = committeeIdToSafeFileName(committeeID);
console.log("Safe committee filename:", safeCommitteeID);
console.log("Committee ID:", committeeID);
