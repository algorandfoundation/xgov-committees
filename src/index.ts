import { getBlocks } from "./blocks";
import { ensureCacheSubPathExists, getCachedRounds } from "./cache";
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

import { downloadBlockPages } from "./cache/s3-cache";

const { cacheMode, fromBlock, toBlock, registryAppId } = config;

console.log(`Running in cache mode: ${cacheMode}`);

await ensureCacheSubPathExists("blocks");

switch (cacheMode) {
  case "validate-cache":
    try {
      await validateCache(fromBlock, toBlock);
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Cache validation failed:", error.message);
      } else {
        console.error("Cache validation failed:", error);
      }
      process.exit(1);
    }
    break;
  case "write-cache":
    try {
      await writeCache(fromBlock, toBlock);
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Cache writing failed:", error.message);
      } else {
        console.error("Cache writing failed:", error);
      }
      process.exit(1);
    }
    break;
  case "use-cache":
    try {
      await useCache(fromBlock, toBlock);
    } catch (error) {
      if (error instanceof Error) {
        console.error("Cache sync failed:", error.message);
      } else {
        console.error("Cache sync failed:", error);
      }
      process.exit(1);
    }
    break;
  default:
    console.error(`Unknown cache mode: ${cacheMode}`);
    process.exit(1);
}

/**
 * Trust the artifacts on S3, downloading everything to the local cache (if not already present).
 * @param fromBlock The starting block number for the cache usage range.
 * @param toBlock The ending block number for the cache usage range.
 * @throws Will throw an error if anything is missing from the S3 cache.
 * @returns {Promise<void>}
 */
async function useCache(fromBlock: number, toBlock: number): Promise<void> {
  // range must be multiples of 1000 for page alignment since we are trusting s3 cache and not validating
  if ((toBlock - fromBlock) % 1000 !== 0) {
    throw new Error(
      `For use-cache mode, fromBlock and toBlock must be multiples of 1000. Got fromBlock=${fromBlock}, toBlock=${toBlock}.`,
    );
  }

  // Download block pages from S3
  await downloadBlockPages(fromBlock, toBlock);

  const proposers = await loadProposers(fromBlock, toBlock, "s3");
  if (!proposers) {
    throw new Error(
      `Proposers not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }
  await saveProposers(fromBlock, toBlock, proposers, "local");

  const subscribedxGovs = await loadSubscribedXgovs(fromBlock, toBlock, "s3");
  if (!subscribedxGovs) {
    throw new Error(
      `Subscribed xGovs not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }
  await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs, "local");

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

  const committee = await loadCommittee(fromBlock, toBlock, "s3");
  if (!committee) {
    throw new Error(
      `Committee not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }
  await saveCommittee(fromBlock, toBlock, committee, "local");
}

/**
 * Write to the S3 cache for all artifacts (blocks, proposers, subscribed xGovs, candidate committee, final committee) for the specified block range.
 * @param fromBlock The starting block number for the cache validation range.
 * @param toBlock The ending block number for the cache validation range.
 * @throws Will throw an error if an issue occured while fetching blocks or writing to cache.
 * @returns {Promise<void>}
 */
async function writeCache(fromBlock: number, toBlock: number): Promise<void> {
  // TODO: make write-cache reads from S3 and saves to S3 (also saving to disk as needed)
  const loadFrom = "s3";
  const saveTo = "s3";

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
      await saveCandidateCommittee(
        fromBlock,
        toBlock,
        candidateCommittee,
        saveTo,
      );
    }

    let subscribedxGovs = await loadSubscribedXgovs(
      fromBlock,
      toBlock,
      loadFrom,
    );
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

    // ensure final committee shortcuts are created for latest committee
    await ensureCommitteeShortcuts();
  }

  const committeeID = getCommitteeID(committee);
  const safeCommitteeID = committeeIdToSafeFileName(committeeID);
  console.log("Safe committee filename:", safeCommitteeID);
  console.log("Committee ID:", committeeID);
}

/**
 * Validates the cache by ensuring all blocks in the specified range are cached and that the proposers, subscribed xGovs, candidate committee, and final committee data in S3 matches what is generated locally from the blocks.
 * @param fromBlock The starting block number for the cache validation range.
 * @param toBlock The ending block number for the cache validation range.
 * @throws Will throw an error if any block is missing from the cache or if any data mismatch is found between S3 and local generation.
 * @returns {Promise<void>}
 */
async function validateCache(
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  const rnds = makeRndsArray(fromBlock, toBlock);

  await getBlocks(rnds);
  await cacheManager.flushAllPages();

  const existing = await getCachedRounds(fromBlock, toBlock);
  const missing = rnds.filter((rnd) => !existing.has(rnd));
  if (missing.length === 0) {
    console.info(
      `Cache validation: All ${rnds.length} rounds from ${fromBlock} to ${toBlock} are cached.`,
    );
  } else {
    throw new Error(`Cache validation failed! Missing rounds!`);
  }

  // TODO: compare blocks with s3 to ensure cache integrity before validating derived data
  // for (const rnd of rnds) {
  //   // get block header
  //   const block = await getBlock(rnd);
  //   if (!block) {
  //     throw new Error(
  //       `Cache validation failed! Round ${rnd} is missing from cache.`,
  //     );
  //   }

  //   // TODO: compare with S3 cached block header
  //   throw new Error(
  //     `Cache validation failed! S3 block comparison not implemented yet!`,
  //   );
  // }

  // console.info(
  //   `Cache validation: All headers from S3 match local headers for blocks ${fromBlock}-${toBlock}.`,
  // );

  // recreate proposers locally
  const proposers = await getBlockProposers(rnds);
  await saveProposers(fromBlock, toBlock, proposers, "local");

  // read and compare proposers from S3 and local cache
  const s3Proposers = await loadProposers(fromBlock, toBlock, "s3");

  if (!s3Proposers) {
    throw new Error(
      `Proposers not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  // compare s3 and local proposers (sort keys for consistent comparison)
  if (
    JSON.stringify(s3Proposers, Object.keys(s3Proposers).sort()) !==
    JSON.stringify(proposers, Object.keys(proposers).sort())
  ) {
    throw new Error(
      `Validation failed! Proposers from S3 does not match local proposers for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  console.info(
    `Cache validation: Proposers from S3 matches local proposers for blocks ${fromBlock}-${toBlock}.`,
  );

  // recreate subscribed xGovs locally
  const subscribedxGovs = await getSubscribedXgovs();
  await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs, "local");

  // read and compare subscribed xGovs from S3 and local cache
  const s3SubscribedXgovs = await loadSubscribedXgovs(fromBlock, toBlock, "s3");

  if (!s3SubscribedXgovs) {
    throw new Error(
      `Subscribed xGovs not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  // compare s3 and local subscribed xGovs (sort keys for consistent comparison)
  if (
    JSON.stringify(s3SubscribedXgovs, Object.keys(s3SubscribedXgovs).sort()) !==
    JSON.stringify(subscribedxGovs, Object.keys(subscribedxGovs).sort())
  ) {
    throw new Error(
      `Validation failed! Subscribed xGovs from S3 does not match local subscribed xGovs for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  console.info(
    `Cache validation: Subscribed xGovs from S3 matches local subscribed xGovs for blocks ${fromBlock}-${toBlock}.`,
  );

  // recreate candidate committee locally
  const candidateCommittee = await getCandidateCommittee(proposers);
  await saveCandidateCommittee(fromBlock, toBlock, candidateCommittee, "local");

  // read and compare candidate committee from S3 and local cache
  const s3CandidateCommittee = await loadCandidateCommittee(
    fromBlock,
    toBlock,
    "s3",
  );

  if (!s3CandidateCommittee) {
    throw new Error(
      `Candidate committee not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  // compare s3 and local candidate committees (sort keys for consistent comparison)
  if (
    JSON.stringify(
      s3CandidateCommittee,
      Object.keys(s3CandidateCommittee).sort(),
    ) !==
    JSON.stringify(candidateCommittee, Object.keys(candidateCommittee).sort())
  ) {
    throw new Error(
      `Validation failed! Candidate committee from S3 does not match local candidate committee for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  console.info(
    `Cache validation: Candidate committee from S3 matches local candidate committee for blocks ${fromBlock}-${toBlock}.`,
  );

  // recreate final committee locally
  const committee = getCommittee(
    fromBlock,
    toBlock,
    registryAppId,
    candidateCommittee,
    subscribedxGovs,
  );
  await saveCommittee(fromBlock, toBlock, committee, "local");

  // read and compare final committee from S3 and local cache
  const s3Committee = await loadCommittee(fromBlock, toBlock, "s3");

  if (!s3Committee) {
    throw new Error(
      `Committee not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  // get committee IDs and compare
  const s3CommitteeID = getCommitteeID(s3Committee);
  const committeeID = getCommitteeID(committee);

  if (s3CommitteeID !== committeeID) {
    throw new Error(
      `Validation failed! Committee ID from S3 (${s3CommitteeID}) does not match local committee ID (${committeeID}).`,
    );
  }

  console.info(
    `Cache validation successful! All data from S3 matches local data for blocks ${fromBlock}-${toBlock}.`,
  );
}
