import { getBlocks } from '../blocks';
import { cacheManager } from '../cache/cache-manager';
import {
  loadCandidateCommittee,
  getCandidateCommittee,
  saveCandidateCommittee,
} from '../candidate-committee';
import { loadCommittee, getCommittee, saveCommittee, getCommitteeID } from '../committee';
import { config } from '../config';
import { loadProposers, getBlockProposers, saveProposers } from '../proposers';
import { ensureCommitteeShortcuts } from '../s3';
import { loadSubscribedXgovs, getSubscribedXgovs, saveSubscribedXgovs } from '../subscribed-xgovs';
import { makeRndsArray, committeeIdToSafeFileName } from '../utils';

const { registryAppId } = config;

/**
 * Write to the S3 cache for all artifacts (blocks, proposers, subscribed xGovs, candidate committee, final committee) for the specified block range.
 * @param fromBlock The starting block number for the cache validation range.
 * @param toBlock The ending block number for the cache validation range.
 * @throws Will throw an error if an issue occured while fetching blocks or writing to cache.
 * @returns {Promise<void>}
 */
export async function runWriteCache(fromBlock: number, toBlock: number): Promise<void> {
  let committee = await loadCommittee(fromBlock, toBlock, 's3');
  if (!committee) {
    let candidateCommittee = await loadCandidateCommittee(fromBlock, toBlock, 's3');
    if (!candidateCommittee) {
      let proposers = await loadProposers(fromBlock, toBlock, 's3');
      if (!proposers) {
        const rnds = makeRndsArray(fromBlock, toBlock);

        await getBlocks(rnds);
        await cacheManager.flushAllPages();

        proposers = await getBlockProposers(rnds);
        await saveProposers(fromBlock, toBlock, proposers, 's3');
      }

      candidateCommittee = await getCandidateCommittee(proposers);
      await saveCandidateCommittee(fromBlock, toBlock, candidateCommittee, 's3');
    }

    let subscribedxGovs = await loadSubscribedXgovs(fromBlock, toBlock, 's3');
    if (!subscribedxGovs) {
      subscribedxGovs = await getSubscribedXgovs();
      await saveSubscribedXgovs(fromBlock, toBlock, subscribedxGovs, 's3');
    }

    committee = getCommittee(
      fromBlock,
      toBlock,
      registryAppId,
      candidateCommittee,
      subscribedxGovs,
    );
    await saveCommittee(fromBlock, toBlock, committee, 's3');
  }

  const committeeID = getCommitteeID(committee);
  // @ts-expect-error - At runtime `committeeID` is a string-compatible identifier
  const safeCommitteeID = committeeIdToSafeFileName(committeeID);
  console.log('Safe committee filename:', safeCommitteeID);
  console.log('Committee ID:', committeeID);

  // ensure final committee shortcuts are created for latest committee, fix any if missing or corrupted
  await ensureCommitteeShortcuts();
}
