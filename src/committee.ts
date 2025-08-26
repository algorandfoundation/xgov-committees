import { join } from "path";
import { ensureCacheSubPathExists as ensureCacheSubPathExists } from "./cache";
import { getCachePath } from "./cache/utils";
import { readFile, writeFile } from "fs/promises";
import { networkMetadata } from "./algod";
import { CandidateCommittee } from "./candidate-committee";
import { clearLine, fsExists, sha512_256_raw } from "./utils";
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

export function getCommitteeID(committee: Committee): string {
  // An xGov Committee is identified by the following identifier:
  // `SHA-512/256(arc0086||SHA-512/256(xGov Committee JSON))`
  const committeeJSON = JSON.stringify(committee)
  const committeeJSONHash = sha512_256_raw(committeeJSON)
  const committeeIDHash = sha512_256_raw(Buffer.concat([
    Buffer.from("arc0086"),
    committeeJSONHash
  ]))
  return committeeIDHash.toString("base64")
}