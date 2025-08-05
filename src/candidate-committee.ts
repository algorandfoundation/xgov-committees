import { join } from "path";
import { ensureCacheSubPathExists as ensureCacheSubPathExists } from "./cache";
import { getCachePath } from "./cache/utils";
import { readFile, writeFile } from "fs/promises";
import { ProposerMap } from "./proposers";
import { clearLine, fsExists } from "./utils";

export type CandidateCommittee = Record<string, number>;

const label = "candidate committee";
const cacheSubPath = "candidate-committee";

export async function getCandidateCommittee(proposerMap: ProposerMap) {
  return Object.fromEntries(
    [...proposerMap.entries()].map(([proposer, rnds]) => [
      proposer,
      rnds.length,
    ])
  );
}

export async function loadCandidateCommittee(
  fromBlock: number,
  toBlock: number
): Promise<CandidateCommittee | undefined> {
  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);

  if (await fsExists(filePath)) {
    process.stderr.write(`Trying to load ${label} cache ${filePath}`);
    try {
      const fileContents = (await readFile(filePath)).toString();
      const committee = JSON.parse(fileContents) as Record<string, number>;

      const expectedCount = toBlock - fromBlock;
      const actualCount = Object.values(committee).reduce(
        (sum, value) => sum + value,
        0
      );
      if (actualCount !== expectedCount) {
        throw new Error(
          `Expected ${expectedCount} rounds, found ${actualCount} in ${label} file ${filePath}`
        );
      }
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
  committee: CandidateCommittee
): Promise<void> {
  await ensureCacheSubPathExists(cacheSubPath);

  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);
  console.log(`Writing ${label} to ${filePath}`);

  await writeFile(filePath, JSON.stringify(committee));
}
