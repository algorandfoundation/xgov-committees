import { join } from "path";
import { config } from "../config";
import { networkMetadata } from "../algod";

export const getCachePath = (subPath: string): string => {
  const { genesisID, genesisHash } = networkMetadata;
  const networkPath = join(
    config.dataPath,
    `${genesisID}-${genesisHash.replace(/[\/=]/g, "_")}`,
    subPath,
  );
  return networkPath;
};

export function hashBuffer(buffer: Buffer): number {
  let hash = 0;
  for (let i = 0; i < buffer.length; i++) {
    hash = (hash << 5) - hash + buffer[i];
    hash |= 0;
  }
  return hash;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
