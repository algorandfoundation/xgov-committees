import { CACHE_PAGE_SIZE } from "../cache/cache-page";
import { downloadBlockPages } from "../cache/s3-cache";
import {
  loadCandidateCommittee,
  saveCandidateCommittee,
} from "../candidate-committee";
import { loadCommittee, saveCommittee } from "../committee";
import { loadProposers, saveProposers } from "../proposers";
import { loadSubscribedXgovs, saveSubscribedXgovs } from "../subscribed-xgovs";

/**
 * Trust the artifacts on S3, downloading everything to the local cache (if not already present).
 * @param fromBlock The starting block number for the cache usage range.
 * @param toBlock The ending block number for the cache usage range.
 * @throws Will throw an error if anything is missing from the S3 cache.
 * @returns {Promise<void>}
 */
export async function runUseCache(
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  // range must be multiples of CACHE_PAGE_SIZE for page alignment since we are trusting s3 cache and not validating
  if ((toBlock - fromBlock) % CACHE_PAGE_SIZE !== 0) {
    throw new Error(
      `For use-cache mode, fromBlock and toBlock must be multiples of ${CACHE_PAGE_SIZE}. Got fromBlock=${fromBlock}, toBlock=${toBlock}.`,
    );
  }

  // Download block pages from S3
  await downloadBlockPages(fromBlock, toBlock);

  console.log("Syncing proposers from S3...");
  const proposers = await loadProposers(fromBlock, toBlock, "s3");
  if (!proposers) {
    throw new Error(
      `Proposers not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }
  await saveProposers(fromBlock, toBlock, proposers, "local");
  console.log("Proposers synced successfully.");

  console.log("Syncing subscribed xGovs from S3...");
  const subscribedxGovs = await loadSubscribedXgovs(fromBlock, toBlock, "s3");
  if (!subscribedxGovs) {
    throw new Error(
      `Subscribed xGovs not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }
  await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs, "local");
  console.log("Subscribed xGovs synced successfully.");

  console.log("Syncing candidate committee from S3...");
  const candidateCommittee = await loadCandidateCommittee(
    fromBlock,
    toBlock,
    "s3",
  );
  if (!candidateCommittee) {
    throw new Error(
      `Candidate committee not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }
  await saveCandidateCommittee(fromBlock, toBlock, candidateCommittee, "local");
  console.log("Candidate committee synced successfully.");

  console.log("Syncing committee from S3...");
  const committee = await loadCommittee(fromBlock, toBlock, "s3");
  if (!committee) {
    throw new Error(
      `Committee not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }
  await saveCommittee(fromBlock, toBlock, committee, "local");
  console.log("Committee synced successfully.");
}
