import pMap from 'p-map';
import { getBlock } from './blocks.ts';
import { chunk, clearLine, fsExists, makeRndsArray, sleep } from './utils.ts';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { ensureCacheSubPathExists } from './cache/index.ts';
import { getCachePath } from './cache/utils.ts';
import { CACHE_PAGE_SIZE } from './cache/cache-page.ts';
import { getKeyWithNetworkMetadata, getPublicUrlForObject, uploadData } from './s3/index.ts';
import { guardWhileNotShuttingDown } from './shutdown.ts';

export type ProposerMap = Map<string, number[]>;

const label = 'proposers';
const cacheSubPath = 'proposers';

/*
 * Create proposer map of [proposer] -> proposed_round[]
 */
const _getBlockProposers = async (rnds: number[]): Promise<ProposerMap> => {
  const proposers: ProposerMap = new Map();

  const total = rnds.length;
  let processed = 0;
  const chunks = chunk(rnds, CACHE_PAGE_SIZE);
  for (const chunked of chunks) {
    await pMap(
      chunked,
      async (rnd) => {
        const { proposer: proposerAddr } = await getBlock(rnd);
        const proposer = proposerAddr.toString();

        const existingRounds = proposers.get(proposer) ?? [];
        proposers.set(proposer, [...existingRounds, rnd]);

        processed++;
        const percent = ((100 * processed) / total).toFixed(2);
        process.stdout.write(`\rBlock proposer:\t${rnd} ${processed}/${total} ${percent}%   `);
      },
      { concurrency: 100 },
    );
    await sleep(50); // pause for gb
  }

  clearLine();
  process.stdout.write(`\rProposer data:\t${total} OK\n`);
  return proposers;
};

/**
 * Fetch proposer data for blocks and create a proposer map.
 * Guarded by shutdown decorator to prevent starting during shutdown.
 * If shutdown is initiated while fetching, throws ShuttingDownError.
 */
export const getBlockProposers: typeof _getBlockProposers =
  guardWhileNotShuttingDown(_getBlockProposers);

/**
 * Parse and validate proposer map from file contents.
 * @param fileContents Contents of file on disk/S3 cache
 * @param fromBlock Start range of blocks for proposers data
 * @param toBlock End range of blocks for proposers data
 * @throws Will throw an error if the file contents are not valid JSON, if there are duplicate proposers, if there are duplicate rounds across proposers, or if there are missing rounds in the proposers data for the given block range.
 * @returns A ProposerMap parsed from the file contents if valid, otherwise an error is thrown indicating the specific validation failure.
 */
function parseAndValidateProposerMap(
  fileContents: string,
  fromBlock: number,
  toBlock: number,
): ProposerMap {
  const map: ProposerMap = new Map();
  const lines = fileContents.split('\n').filter(Boolean);
  let lineNum = 0;
  for (const line of lines) {
    const propRnds = JSON.parse(line);
    const proposer = Object.keys(propRnds)[0];
    if (!proposer) {
      throw new Error(`No proposer found in line ${lineNum}`);
    }
    if (map.has(proposer)) {
      throw new Error(`Duplicate proposer ${proposer} found in line ${lineNum}`);
    }
    map.set(proposer, propRnds[proposer]);
    lineNum++;
  }
  const expectedRounds = new Set(makeRndsArray(fromBlock, toBlock));
  for (const [proposer, rnds] of map.entries()) {
    for (const rnd of rnds) {
      if (!expectedRounds.has(rnd)) {
        throw new Error(`Unexpected or duplicate round ${rnd} found for proposer ${proposer}`);
      }
      expectedRounds.delete(rnd);
    }
  }
  if (expectedRounds.size) {
    const rndsStr = [...expectedRounds.values()].join(' ');
    throw new Error(`Proposers cache incomplete, missing rounds: ${rndsStr}`);
  }
  return map;
}

/*
 * Load proposer -> proposed_rounds Map from cache.
 * Validates 1) valid JSON, 2) no duplicate proposers, 3) no duplicate rounds, 4) no missing rounds
 */
export async function loadProposers(
  fromBlock: number,
  toBlock: number,
  from: 'local' | 's3' = 'local',
): Promise<ProposerMap | undefined> {
  if (from === 's3') {
    const url = getPublicUrlForObject(`${cacheSubPath}/${fromBlock}-${toBlock}.jsons`);
    try {
      const res = await fetch(url);
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`Fetching ${url} failed: ${res.status}`);
      const fileContents = await res.text();
      const map = parseAndValidateProposerMap(fileContents, fromBlock, toBlock);
      console.log(`Using S3 proposers: ${url}`);
      return map;
    } catch (e) {
      console.warn(`S3 fetch failed for ${url}: ${(e as Error).message}`);
      return;
    }
  }
  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.jsons`);

  if (await fsExists(filePath)) {
    process.stderr.write(`Trying to load ${label} cache`);
    try {
      const fileContents = (await readFile(filePath)).toString();
      const map = parseAndValidateProposerMap(fileContents, fromBlock, toBlock);
      clearLine();
      console.log(`\rUsing cached ${label} file: ${filePath}`);
      return map;
    } catch (e) {
      console.warn(`\nIgnoring cached ${label} file: ${(e as Error).message}`);
    }
  }
}

/*
 * Save proposers map to disk in jsonstream format
 */
export async function saveProposers(
  fromBlock: number,
  toBlock: number,
  proposers: ProposerMap,
  to: 'local' | 's3' = 'local',
) {
  if (to === 's3') {
    const key = getKeyWithNetworkMetadata(`${cacheSubPath}/${fromBlock}-${toBlock}.jsons`);

    await uploadData(key, serializeProposers(proposers));
    return;
  }

  const cachePath = getCachePath(cacheSubPath);
  await ensureCacheSubPathExists(cacheSubPath);

  const filePath = join(cachePath, `${fromBlock}-${toBlock}.jsons`);
  console.log(`Writing ${label} to ${filePath}`);

  await writeFile(filePath, serializeProposers(proposers));
}

export function serializeProposers(proposers: ProposerMap) {
  let s = ``;
  // sort proposers for deterministic output
  for (const [proposer, rounds] of Array.from(proposers.entries()).sort(([a], [b]) => {
    const aStr = String(a);
    const bStr = String(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  })) {
    // sort rounds for deterministic output
    s += JSON.stringify({ [proposer]: rounds.sort((a, b) => a - b) }) + '\n';
  }
  return s;
}
