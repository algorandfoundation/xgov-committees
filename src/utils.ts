import { access } from "fs/promises";
import { constants } from "fs";

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
    return new Promise(resolve => setTimeout(resolve, ms)); // pause for gc
}