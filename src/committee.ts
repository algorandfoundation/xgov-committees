import { join } from "path";
import { ensureCacheSubPathExists as ensureCacheSubPathExists } from "./cache";
import { getCachePath } from "./cache/utils";
import { readFile, writeFile } from "fs/promises";
import { config } from "./config";
import { networkMetadata } from "./algod";
import { CandidateCommittee } from "./candidate-committee";
import { clearLine, fsExists, isEqual } from "./utils";
import { committeeSchema } from "./committee-schema";
import { validate } from "json-schema";
import { validateCommitteeString } from "./committee-validate";
import { XGovsRecord } from "./subscribed-xgovs";

export type Committee = {
  networkGenesisHash: string;
  registryId: number;

  periodStart: number;
  periodEnd: number;

  totalMembers: number;
  totalVotes: number;

  xGovs: {
    address: string;
    votes: number;
  }[];
};

const label = "committee";
const cacheSubPath = "committee";

export function getCommittee(
  fromBlock: number,
  toBlock: number,
  registryAppId: number,
  candidateCommittee: CandidateCommittee,
  subscribedxGovs: XGovsRecord,
): Committee {
  let totalMembers = 0;
  let totalVotes = 0;
  const subscribed = Object.keys(subscribedxGovs)

  const xGovs = Object.entries(candidateCommittee)
    .filter(([proposer]) => subscribed.includes(proposer))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([address, votes]) => {
      totalMembers += 1;
      totalVotes += votes;
      return { address, votes };
    });

  const committee = {
    networkGenesisHash: networkMetadata.genesisHash,
    periodEnd: toBlock,
    periodStart: fromBlock,
    registryId: registryAppId,
    totalMembers,
    totalVotes,
    xGovs,
  };

  validateCommitteeString(JSON.stringify(committee))

  return committee
}

export async function loadCommittee(
  fromBlock: number,
  toBlock: number
): Promise<Committee | undefined> {
  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);

  if (await fsExists(filePath)) {
    process.stderr.write(`Trying to load ${label} cache`);
    try {
      const fileContents = (await readFile(filePath)).toString();
      const committee = validateCommitteeString(fileContents);
      clearLine();
      console.log(`\rUsing cached ${label} file: ${filePath}`);
      console.log(`Committee file is valid`);
      return committee;
    } catch (e) {
      console.warn(`Ignoring cached ${label} file: ${(e as Error).message}`);
    }
  }
}

export async function saveCommittee(
  fromBlock: number,
  toBlock: number,
  committee: Committee
): Promise<void> {
  await ensureCacheSubPathExists(cacheSubPath);

  const cachePath = getCachePath(cacheSubPath);
  const filePath = join(cachePath, `${fromBlock}-${toBlock}.json`);
  console.log(`Writing ${label} to ${filePath}`);

  await writeFile(filePath, JSON.stringify(committee));
}
