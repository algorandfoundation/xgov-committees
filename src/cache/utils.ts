import { join } from "path";
import { config } from "../config";
import { NetworkIDs } from "../algod";

export const getCachePath = (
  networkIDs: NetworkIDs,
  subPath = "blocks"
): string => {
  const { genesisID, genesisHash } = networkIDs;
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
    hash = ((hash << 5) - hash) + buffer[i];
    hash |= 0;
  }
  return hash;
}