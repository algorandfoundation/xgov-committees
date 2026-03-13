import pMap from 'p-map';
import { config } from './config';
import { algod, networkMetadata } from './algod';
import { subtractCached, getCache, setCache } from './cache';
import { chunk, clearLine, formatDuration, sleep } from './utils';
import { BlockHeader } from 'algosdk';
import { BlockResponse } from 'algosdk/dist/types/client/v2/algod/models/types';
import { guardWhileNotShuttingDown, fatalError } from './shutdown';

/**
 * Error thrown when attempting to fetch a block beyond the blockchain tip.
 */
export class TipReachedError extends Error {
  constructor(public readonly blockNumber: bigint) {
    super(`Block ${blockNumber} not available. The tip of the blockchain has been reached.`);
    this.name = 'TipReachedError';
  }
}

const DELTA_TOLERANCE = 5n;

/**
 * Determines whether a TipReachedError is a genuine tip condition or an unexpected failure.
 * A genuine tip condition is when the requested block is within delta tolerance of lastRound.
 * @returns true if within tolerance (expected), false if outside tolerance (unexpected error)
 */
export function isGenuineTipReached(
  blockNumber: bigint,
  lastRound: bigint,
  deltaTolerance: bigint = DELTA_TOLERANCE,
): boolean {
  const delta = lastRound - blockNumber;
  return delta <= deltaTolerance;
}

const _getBlocks = async (rnds: number[], skipCache: boolean = false) => {
  const total = rnds.length;
  let v = '';
  const startBlock = rnds[0];
  const endBlock = rnds.at(-1);

  const requiredRnds = skipCache ? rnds : await subtractCached(rnds);
  let processed = rnds.length - requiredRnds.length;

  console.log(`Network:\t${networkMetadata.genesisID}`);
  console.log(`Registry app:\t${config.registryAppId}`);
  console.log(`Node:   \t${config.algodServer}`);
  console.log(`Token:  \t${config.algodToken ? 'Yes' : 'No'}`);
  console.log(`First block:\t${startBlock}`);
  console.log(`Last block:\t${endBlock}`);
  console.log('--');
  console.log(`Total blocks:\t${total}`);
  console.log(`Existing:\t${processed}`);
  console.log(`Remaining:\t${total - processed}`);
  console.log('--');

  const chunks = chunk(requiredRnds, 1_000);
  for (const chunk of chunks) {
    const start = Date.now();
    await pMap(
      chunk,
      async (rnd) => {
        return await getBlockWithStatus(rnd);
      },
      {
        concurrency: config.concurrency,
      },
    );
    const end = Date.now();
    const elapsed = end - start; // in ms
    v = ((1000 * chunk.length) / elapsed).toFixed(2);

    await sleep(50); // pause for gc
  }

  clearLine();
  process.stdout.write(`Block data: \t${total} OK\n`);

  async function getBlockWithStatus(rnd: number): Promise<BlockHeader> {
    const data: BlockHeader = await getBlock(rnd, skipCache);
    processed++;
    const percent = ((100 * processed) / total).toFixed(2);
    const etaSec = (total - processed) / parseFloat(v);
    process.stdout.write(
      `\rFetching block:\t${rnd} ${processed}/${total} ${percent}%${
        v ? ` ${v} rnd/sec ETA ${formatDuration(etaSec)}        ` : ''
      }`,
    );
    return data;
  }
};

/**
 * Fetch blocks from the Algorand node and cache them.
 * Guarded by shutdown decorator to prevent starting during shutdown.
 * If shutdown is initiated while fetching, throws ShuttingDownError.
 */
export const getBlocks: typeof _getBlocks = guardWhileNotShuttingDown(_getBlocks);

const _getBlock = async (rnd: number, skipCache: boolean = false): Promise<BlockHeader> => {
  let cached: BlockHeader | undefined;
  if (!skipCache && (cached = await getCache(rnd))) {
    try {
      const { round, genesisHash } = cached;

      if (Number(round) !== rnd) {
        throw new Error(`Unexpected round, found ${round}, expected ${rnd}`);
      }

      const actualGenesisHash = Buffer.from(genesisHash).toString('base64');
      if (actualGenesisHash !== networkMetadata.genesisHash) {
        throw new Error(
          `Unexpected genesis hash, found ${actualGenesisHash}, expected ${networkMetadata.genesisHash}`,
        );
      }

      return cached;
    } catch (e) {
      console.error(`Error in cached file ${rnd}:`, (e as Error).message);

      console.log('Refetching: ', rnd);
    }
  }

  let data: BlockResponse;

  try {
    data = await algod.block(rnd).headerOnly(true).do();
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    // Check if block is not available (404 error from ledger)
    if (errorMessage.includes('failed to retrieve information from the ledger')) {
      const { lastRound } = await algod.status().do();
      if (!isGenuineTipReached(BigInt(rnd), lastRound)) {
        await fatalError(
          new Error(
            `Block ${rnd} request failed unexpectedly (lastRound: ${lastRound}, delta exceeds tolerance: ${DELTA_TOLERANCE})`,
          ),
        );
      }
      throw new TipReachedError(BigInt(rnd));
    }

    // rethrow other errors
    throw e;
  }

  setCache(rnd, data.block.header);
  return data.block.header;
};

/**
 * Fetch a single block from the Algorand node and cache it.
 * Guarded by shutdown decorator to prevent starting during shutdown.
 */
export const getBlock: typeof _getBlock = guardWhileNotShuttingDown(_getBlock);
