import pMap from "p-map";
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
import {
  getBlockProposers,
  loadProposers,
  saveProposers,
  serializeProposers,
} from "./proposers";
import {
  getSubscribedXgovs,
  loadSubscribedXgovs,
  saveSubscribedXgovs,
} from "./subscribed-xgovs";
import { makeRndsArray, committeeIdToSafeFileName } from "./utils";

import { downloadBlockPages, validateBlockPage } from "./cache/s3-cache";
import { CACHE_PAGE_SIZE } from "./cache/cache-page";

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

/**
 * Write to the S3 cache for all artifacts (blocks, proposers, subscribed xGovs, candidate committee, final committee) for the specified block range.
 * @param fromBlock The starting block number for the cache validation range.
 * @param toBlock The ending block number for the cache validation range.
 * @throws Will throw an error if an issue occured while fetching blocks or writing to cache.
 * @returns {Promise<void>}
 */
async function writeCache(fromBlock: number, toBlock: number): Promise<void> {
  let committee = await loadCommittee(fromBlock, toBlock, "s3");

  if (!committee) {
    let candidateCommittee = await loadCandidateCommittee(
      fromBlock,
      toBlock,
      "s3",
    );
    if (!candidateCommittee) {
      let proposers = await loadProposers(fromBlock, toBlock, "s3");
      if (!proposers) {
        const rnds = makeRndsArray(fromBlock, toBlock);

        await getBlocks(rnds);
        await cacheManager.flushAllPages();

        proposers = await getBlockProposers(rnds);
        await saveProposers(fromBlock, toBlock, proposers, "s3");
      }

      candidateCommittee = await getCandidateCommittee(proposers);
      await saveCandidateCommittee(
        fromBlock,
        toBlock,
        candidateCommittee,
        "s3",
      );
    }

    let subscribedxGovs = await loadSubscribedXgovs(fromBlock, toBlock, "s3");
    if (!subscribedxGovs) {
      subscribedxGovs = await getSubscribedXgovs();
      await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs, "s3");
    }

    committee = getCommittee(
      fromBlock,
      toBlock,
      registryAppId,
      candidateCommittee,
      subscribedxGovs,
    );
    await saveCommittee(fromBlock, toBlock, committee, "s3");

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

  // must be multiples of CACHE_PAGE_SIZE for proper page alignment
  if (rnds.length % CACHE_PAGE_SIZE !== 0) {
    throw new Error(
      `For cache validation, fromBlock and toBlock must be multiples of ${CACHE_PAGE_SIZE} for proper page alignment. Got fromBlock=${fromBlock}, toBlock=${toBlock}.`,
    );
  }

  // pass true for `skipCache` to getBlocks to skip block header cache and force refetch from algod.
  await getBlocks(rnds, true);
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

  const numberOfPages = rnds.length / CACHE_PAGE_SIZE;
  const pageStart = fromBlock;

  // validate all pages by comparing s3 and local MD5 hashes with concurrency
  await pMap(
    Array.from({ length: numberOfPages }, (_, i) => i),
    (pageIndex) =>
      validateBlockPage(
        pageStart + pageIndex * CACHE_PAGE_SIZE,
        pageIndex,
        numberOfPages,
      ),
    { concurrency: config.concurrency },
  );

  console.info(
    `Cache validation: All headers from S3 match local headers for blocks ${fromBlock}-${toBlock}.`,
  );

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

  // TODO: fix, this always fails
  // compare s3 and local proposers (sort keys for consistent comparison)
  if (serializeProposers(s3Proposers) !== serializeProposers(proposers)) {
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
