import { access, readdir } from 'fs/promises';
import { constants } from 'fs';
import { sha512_256 } from 'js-sha512';
import { join } from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { type BinaryLike, createHash } from 'crypto';

export async function fsExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms)); // pause for gc
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}D`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}

export function makeRndsArray(fromBlock: number, toBlock: number) {
  return new Array(toBlock - fromBlock).fill(1).map((_, i) => fromBlock + i);
}

export function clearLine() {
  process.stderr.write(
    '\r                                                                              ',
  );
  process.stderr.write('\r');
}

export function isEqual(a: any[], b: any[]) {
  return a.every((v, k) => b[k] === v);
}

export function sha512_256_raw(input: string | Buffer) {
  return Buffer.from(sha512_256(input), 'hex');
}

export function committeeIdToSafeFileName(committeeIdBase64: string): string {
  // Convert base64 to base64url (URL-safe characters and no padding)
  return committeeIdBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkDir(fullPath)));
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

export async function downloadToFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is empty');
  }

  const fileStream = createWriteStream(filename);

  // Convert Web ReadableStream to Node Readable
  const nodeStream = Readable.fromWeb(response.body as any);

  await pipeline(nodeStream, fileStream);
}

/**
 *
 * @param buffer - The input data to hash, as a string or Buffer
 * @returns A hex string representing the MD5 hash of the input buffer
 */
export function getMD5Hash(buffer: BinaryLike): string {
  return createHash('md5').update(buffer).digest('hex');
}
