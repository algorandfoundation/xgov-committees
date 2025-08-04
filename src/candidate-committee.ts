import { join } from "path";
import { networkIDs } from "./algod";
import { ensureCachePathExists } from "./cache";
import { getCachePath } from "./cache/utils";
import { readFile, writeFile } from "fs/promises";
import { ProposerMap } from "./proposers";

type CandidateCommittee = Record<string, number>

export async function getCandidateCommittee(proposerMap: ProposerMap) {
    return Object.fromEntries(
        [...proposerMap.entries()].map(([proposer, rnds]) => [proposer, rnds.length])
    )
}

export async function loadCandidateCommittee(
  fromBlock: number,
  toBlock: number
): Promise<CandidateCommittee | undefined> {
  const cacheSubPath = "candidate-committee";
  await ensureCachePathExists(cacheSubPath);

  const cachePath = getCachePath(networkIDs, cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);

  let fileContents: string = "";
  try {
    fileContents = (await readFile(filePath)).toString();
  } catch (e) {}

  if (fileContents !== "") {
    process.stderr.write("Trying to load candidate committee cache")
    const committee = JSON.parse(fileContents) as Record<string, number>

    const expectedCount = toBlock - fromBlock
    const actualCount = Object.values(committee).reduce((sum, value) => sum + value, 0)
    if (actualCount !== expectedCount) {
        console.warn(`\nExpected ${expectedCount} rounds, found ${actualCount} in candidate committee file ${filePath}`)
        console.warn(`Ignoring cached candidate committee file`)
        return
    }

    console.log(`\rUsing cached candidate committee file: ${filePath}`);
    return committee
  }
}

export async function saveCandidateCommittee(
  fromBlock: number,
  toBlock: number,
  committee: CandidateCommittee
): Promise<void> {
  const cacheSubPath = "candidate-committee";
  await ensureCachePathExists(cacheSubPath);

  const cachePath = getCachePath(networkIDs, cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);
  console.log(`Writing candidate committee to ${filePath}`);

  await writeFile(filePath, JSON.stringify(committee))
}
