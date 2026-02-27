import pMap from 'p-map';
import { getBlocks } from '../blocks';
import { getCachedRounds } from '../cache';
import { cacheManager } from '../cache/cache-manager';
import { CACHE_PAGE_SIZE } from '../cache/cache-page';
import { validateBlockPage } from '../cache/s3-cache';
import {
  getCandidateCommittee,
  saveCandidateCommittee,
  loadCandidateCommittee,
} from '../candidate-committee';
import { getCommittee, saveCommittee, loadCommittee, getCommitteeID } from '../committee';
import { getBlockProposers, saveProposers, serializeProposers } from '../proposers';
import { getSubscribedXgovs, saveSubscribedXgovs, loadSubscribedXgovs } from '../subscribed-xgovs';
import { getMD5Hash, makeRndsArray } from '../utils';
import { config } from '../config';
import { getKeyWithNetworkMetadata, getMD5HashForObject } from '../s3';

const { registryAppId } = config;

/**
 * Validates the cache by ensuring all blocks in the specified range are cached and that the proposers, subscribed xGovs, candidate committee, and final committee data in S3 matches what is generated locally from the blocks.
 * @param fromBlock The starting block number for the cache validation range.
 * @param toBlock The ending block number for the cache validation range.
 * @throws Will throw an error if any block is missing from the cache or if any data mismatch is found between S3 and local generation.
 * @returns {Promise<void>}
 */
export async function runValidateCache(fromBlock: number, toBlock: number): Promise<void> {
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
      validateBlockPage(pageStart + pageIndex * CACHE_PAGE_SIZE, pageIndex, numberOfPages),
    { concurrency: config.concurrency },
  );

  console.info(
    `Cache validation: All headers from S3 match local headers for blocks ${fromBlock}-${toBlock}.`,
  );

  // recreate proposers locally
  const proposers = await getBlockProposers(rnds);
  await saveProposers(fromBlock, toBlock, proposers, 'local');

  // read and compare proposers MD5 from S3 and local cache
  const s3ProposersHash = await getMD5HashForObject(
    getKeyWithNetworkMetadata(`proposers/${fromBlock}-${toBlock}.jsons`),
  );

  if (!s3ProposersHash) {
    throw new Error(`Proposers not found in S3 cache for blocks ${fromBlock}-${toBlock}.`);
  }

  const localProposersHash = getMD5Hash(serializeProposers(proposers));

  if (s3ProposersHash !== localProposersHash) {
    throw new Error(
      `Validation failed! Proposers from S3 does not match local proposers for blocks ${fromBlock}-${toBlock}. S3 proposers MD5: ${s3ProposersHash}, Local proposers MD5: ${localProposersHash}`,
    );
  }

  console.info(
    `Cache validation: Proposers from S3 matches local proposers for blocks ${fromBlock}-${toBlock}.`,
  );

  // recreate subscribed xGovs locally
  const subscribedxGovs = await getSubscribedXgovs();
  await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs, 'local');

  // read and compare subscribed xGovs from S3 and local cache
  const s3SubscribedXgovs = await loadSubscribedXgovs(fromBlock, toBlock, 's3');

  if (!s3SubscribedXgovs) {
    throw new Error(`Subscribed xGovs not found in S3 cache for blocks ${fromBlock}-${toBlock}.`);
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
  await saveCandidateCommittee(fromBlock, toBlock, candidateCommittee, 'local');

  // read and compare candidate committee from S3 and local cache
  const s3CandidateCommittee = await loadCandidateCommittee(fromBlock, toBlock, 's3');

  if (!s3CandidateCommittee) {
    throw new Error(
      `Candidate committee not found in S3 cache for blocks ${fromBlock}-${toBlock}.`,
    );
  }

  // compare s3 and local candidate committees (sort keys for consistent comparison)
  if (
    JSON.stringify(s3CandidateCommittee, Object.keys(s3CandidateCommittee).sort()) !==
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
  await saveCommittee(fromBlock, toBlock, committee, 'local');

  // read and compare final committee from S3 and local cache
  const s3Committee = await loadCommittee(fromBlock, toBlock, 's3');

  if (!s3Committee) {
    throw new Error(`Committee not found in S3 cache for blocks ${fromBlock}-${toBlock}.`);
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
