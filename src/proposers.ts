import pMap from "p-map";
import { networkIDs } from "./algod";
import { getBlock } from "./blocks";
import { chunk, makeRndsArray, sleep } from "./utils";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import { ensureCachePathExists } from "./cache";
import { getCachePath } from "./cache/utils";

export type ProposerMap = Map<string, number[]>;

export async function getBlockProposers(rnds: number[]): Promise<ProposerMap> {
  const proposers: ProposerMap = new Map();

  let total = rnds.length;
  let processed = 0;
  const chunks = chunk(rnds, 100_000);
  for (const chunked of chunks) {
    await pMap(
      chunked,
      async (rnd) => {
        const {
          proposer: proposerAddr,
          round,
          genesisHash,
        } = await getBlock(rnd);
        const proposer = proposerAddr.toString();

        const existingRounds = proposers.get(proposer) ?? [];
        proposers.set(proposer, [...existingRounds, rnd]);

        processed++;
        const percent = ((100 * processed) / total).toFixed(2);
        process.stdout.write(
          `\rBlock proposer:\t${rnd} ${processed}/${total} ${percent}%`
        );
      },
      { concurrency: 1_000 }
    );
    await sleep(50); // pause for gb
  }

  process.stdout.write(
    `\r                                                        `
  );
  process.stdout.write(`\rProposer data:\t${total} OK\n`);
  return proposers;
}

export async function loadProposers(fromBlock: number, toBlock: number) {
  const cacheSubPath = "proposers";
  const cachePath = getCachePath(networkIDs, cacheSubPath);
  await ensureCachePathExists(networkIDs, cacheSubPath);

  const filePath = join(cachePath, `${fromBlock}-${toBlock}.jsons`);
  process.stderr.write("Trying to load proposers cache");

  let fileContents: string = "";
  try {
    fileContents = (await readFile(filePath)).toString();
  } catch (e) {}

  if (fileContents !== "") {
    try {
      const map: ProposerMap = new Map();
      const lines = fileContents.split("\n").filter(Boolean); // split + trim empty lines
      // parse JSONstream file
      let lineNum = 0;
      for (const line of lines) {
        const propRnds = JSON.parse(line);
        const proposer = Object.keys(propRnds)[0];
        if (!proposer) {
          throw new Error(
            `No proposer found in line ${lineNum} in ${filePath}`
          );
        }
        if (map.has(proposer)) {
          throw new Error(
            `Duplicate proposer ${proposer} found in line ${lineNum} in ${filePath}`
          );
        }
        map.set(proposer, propRnds[proposer]);
        lineNum++;
      }

      // validate. we want correct number of blocks, no duplicates
      const expectedRounds = new Set(makeRndsArray(fromBlock, toBlock));

      // delete rounds as we process proposers
      for (const [proposer, rnds] of map.entries()) {
        for (const rnd of rnds) {
          if (!expectedRounds.has(rnd)) {
            throw new Error(
              `Unexpected or duplicate round ${rnd} found for proposer ${proposer} in ${filePath}`
            );
          }
          expectedRounds.delete(rnd);
        }
      }

      // we should have zero left in expectedRounds, otherwise we are missing rounds
      if (expectedRounds.size) {
        const rndsStr = [...expectedRounds.values()].join(" ");
        throw new Error(
          `Proposers cache incomplete, missing rounds: ${rndsStr}`
        );
      }

      console.log(`\rUsing cached proposers file: ${filePath}`);
      return map;
    } catch (e) {
      console.warn(`\nIgnoring cached proposers file: ${e}`);
    }
  }
}

export async function saveProposers(
  fromBlock: number,
  toBlock: number,
  proposers: ProposerMap
) {
  const cacheSubPath = "proposers";
  const cachePath = getCachePath(networkIDs, cacheSubPath);
  await ensureCachePathExists(networkIDs, cacheSubPath);

  const filePath = join(cachePath, `${fromBlock}-${toBlock}.jsons`);
  console.log(`Writing proposers to ${filePath}`);

  await writeFile(filePath, serializeProposers(proposers));
}

function serializeProposers(proposers: ProposerMap) {
  let s = ``;
  for (const [proposer, rounds] of proposers.entries()) {
    s += JSON.stringify({ [proposer]: rounds }) + "\n";
  }
  return s;
}
