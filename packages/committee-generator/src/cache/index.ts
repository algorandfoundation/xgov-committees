import { readFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { encodeJSON, decodeJSON, BlockHeader } from 'algosdk';
import { chunk, clearLine, fsExists, sleep } from '../utils';
import { getCachePath } from './utils';
import { cacheManager, getPageStartRnd } from './cache-manager';

export const getCachedRounds = async (min: number, max: number): Promise<Set<number>> => {
  process.stderr.write('Reading block cache, please wait. This can take a while.');
  const minPage = getPageStartRnd(min);
  const maxPage = getPageStartRnd(max);
  const cachePath = getCachePath('blocks');
  const filenames = (await readdir(cachePath)).filter((filename) => {
    if (!filename.endsWith('.json')) return;
    const pageNum = parseInt(filename.split('.')[0], 10);
    return minPage <= pageNum && pageNum <= maxPage;
  });

  const chunks = chunk(filenames, 20);
  const rounds: number[] = [];

  for (const chunked of chunks) {
    await Promise.all(
      chunked.map(async (basename) => {
        try {
          const filename = join(cachePath, basename);
          const buffer = await readFile(filename);
          const data = JSON.parse(buffer.toString());
          const existingRounds = new Set(Object.keys(data).map((s) => parseInt(s, 10)));
          rounds.push(...existingRounds);
        } catch {
          // pretend corrupt files do not exist, they will be overwritten anyway
        }
      }),
    );
    await sleep(50); // gc
  }
  clearLine();
  return new Set(rounds);
};

export async function subtractCached(rnds: number[]): Promise<number[]> {
  const min = rnds[0];
  const max = rnds[rnds.length - 1];
  const existing = await getCachedRounds(min, max);
  return rnds.filter((rnd) => !existing.has(rnd));
}

export async function ensureCacheSubPathExists(subPath: string) {
  const cachePath = getCachePath(subPath);
  if (!(await fsExists(cachePath))) {
    console.log('Creating', cachePath);
    await mkdir(cachePath, { recursive: true });
  }
}

export async function getCache(rnd: number): Promise<BlockHeader | undefined> {
  try {
    const contents = await cacheManager.get(rnd);
    if (!contents) return;
    return decodeJSON(contents, BlockHeader);
  } catch (e) {
    console.error(`\nWhile parsing ${rnd}: `, e);
    throw e;
  }
}

export async function setCache(rnd: number, data: BlockHeader) {
  await cacheManager.set(rnd, encodeJSON(data, { lossyBinaryStringConversion: true }));
}
