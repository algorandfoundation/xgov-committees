import { join } from "path";
import { config } from "../config";
import { networkMetadata, NetworkMetadata } from "../algod";

export const getCachePath = (subPath: string): string => {
  const { genesisID, genesisHash } = networkMetadata;
  const networkPath = join(
    config.dataPath,
    `${genesisID}-${genesisHash.replace(/[\/=]/g, "_")}`,
    subPath
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
