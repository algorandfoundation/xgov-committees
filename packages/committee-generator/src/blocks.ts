import pMap from 'p-map';
import { config } from './config';
import { algod, networkMetadata } from './algod';
import { subtractCached, getCache, setCache } from './cache';
import { chunk, clearLine, formatDuration, sleep } from './utils';
import { BlockHeader } from 'algosdk';
import { BlockResponse } from 'algosdk/dist/types/client/v2/algod/models/types';
import { ExitCode, expectedExit, fatalError, guardWhileNotShuttingDown } from './shutdown';

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
    try {
      const start = Date.now();
      await pMap(
        chunk,
        async (rnd) => {
          const result = await getBlockWithStatus(rnd);
          if (result === undefined) {
            throw new Error(`Block ${rnd} returned undefined. The tip has been reached.`);
          }
          return result;
        },
        {
          concurrency: config.concurrency,
        },
      );
      const end = Date.now();
      const elapsed = end - start; // in ms
      v = ((1000 * chunk.length) / elapsed).toFixed(2);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      // Check if the error is due to reaching the tip of the blockchain
      const match = msg.match(/Block \d+ returned undefined. The tip has been reached./);
      if (match) {
        await expectedExit(ExitCode.EXPECTED_TIP, 'Tip reached during block fetching');
        return;
      }
      await fatalError(e);
    }

    await sleep(50); // pause for gc
  }

  clearLine();
  process.stdout.write(`Block data: \t${total} OK\n`);

  async function getBlockWithStatus(rnd: number): Promise<BlockHeader | undefined> {
    const data: BlockHeader | undefined = await getBlock(rnd, skipCache);
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
export const getBlocks = guardWhileNotShuttingDown(
  _getBlocks as unknown as (...args: unknown[]) => Promise<unknown>,
) as unknown as typeof _getBlocks;

const _getBlock = async (
  rnd: number,
  skipCache: boolean = false,
): Promise<BlockHeader | undefined> => {
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
    if (
      errorMessage.includes(
        'Network request error. Received status 404 (Not Found): failed to retrieve information from the ledger',
      )
    ) {
      // block not yet available, should be handled gracefully.
      return undefined;
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
export const getBlock = guardWhileNotShuttingDown(
  _getBlock as unknown as (...args: unknown[]) => Promise<unknown>,
) as unknown as typeof _getBlock;
