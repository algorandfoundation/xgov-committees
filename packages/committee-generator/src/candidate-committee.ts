import { join } from 'path';
import { ensureCacheSubPathExists as ensureCacheSubPathExists } from './cache';
import { getCachePath } from './cache/utils';
import { readFile, writeFile } from 'fs/promises';
import { ProposerMap } from './proposers';
import { clearLine, fsExists } from './utils';
import { getKeyWithNetworkMetadata, getPublicUrlForObject, uploadData } from './s3';

export type CandidateCommittee = Record<string, number>;

const label = 'candidate committee';
const cacheSubPath = 'candidate-committee';

export async function getCandidateCommittee(proposerMap: ProposerMap) {
  return Object.fromEntries(
    [...proposerMap.entries()].map(([proposer, rnds]) => [proposer, rnds.length]),
  );
}

/**
 * Validate a candidate committee
 * @param committee Candidate committee to validate
 * @param expectedCount Expected number of items
 * @param source Source of the committee data
 * @returns {Record<string, number>} The validated committee
 * @throws Will throw an error if the total count of rounds in the committee does not match the expected count, indicating a mismatch between the generated committee and the expected number of rounds for the given block range.
 */
function validateCandidateCommittee(
  candidateCommittee: Record<string, number>,
  expectedCount: number,
): Record<string, number> {
  const actualCount = Object.values(candidateCommittee).reduce((sum, value) => sum + value, 0);
  if (actualCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} rounds, found ${actualCount} in candidate committee`,
    );
  }
  return candidateCommittee;
}

export async function loadCandidateCommittee(
  fromBlock: number,
  toBlock: number,
  from: 'local' | 's3' = 'local',
): Promise<CandidateCommittee | undefined> {
  const expectedCount = toBlock - fromBlock;

  if (from === 's3') {
    const url = getPublicUrlForObject(`${cacheSubPath}/${fromBlock}-${toBlock}.json`);
    try {
      const res = await fetch(url);
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`Fetching ${url} failed: ${res.status}`);
      const data = await res.json();
      const committee = validateCandidateCommittee(data as Record<string, number>, expectedCount);
      console.log(`Using cached S3 candidate committee: ${url}`);
      return committee;
    } catch (e) {
      console.warn(`S3 fetch failed for ${url}: ${(e as Error).message}`);
      return;
    }
  }

  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);

  if (await fsExists(filePath)) {
    process.stderr.write(`Trying to load ${label} cache ${filePath}`);
    try {
      const fileContents = (await readFile(filePath)).toString();
      const committee = validateCandidateCommittee(
        JSON.parse(fileContents) as Record<string, number>,
        expectedCount,
      );
      clearLine();
      console.log(`\rUsing cached ${label} file: ${filePath}`);
      return committee;
    } catch (e) {
      console.warn(`\nIgnoring cached ${label} file: ${(e as Error).message}`);
    }
  }
}

export async function saveCandidateCommittee(
  fromBlock: number,
  toBlock: number,
  committee: CandidateCommittee,
  to: 'local' | 's3' = 'local',
): Promise<void> {
  if (to === 's3') {
    const key = getKeyWithNetworkMetadata(`${cacheSubPath}/${fromBlock}-${toBlock}.json`);

    return await uploadData(key, JSON.stringify(committee));
  }

  await ensureCacheSubPathExists(cacheSubPath);

  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);
  console.log(`Writing ${label} to ${filePath}`);

  await writeFile(filePath, JSON.stringify(committee));
}
