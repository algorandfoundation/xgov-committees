import { Algodv2 } from "algosdk";
import { config } from "./config";

export const algod = new Algodv2(
  config.algodToken,
  config.algodServer,
  config.algodPort
);

export type NetworkIDs = { genesisID: string; genesisHash: string };

export const getNetworkIDs = async () => {
  const { genesisID, genesisHash } = await algod.getTransactionParams().do();
  return {
    genesisID,
    genesisHash: Buffer.from(genesisHash).toString("base64"),
  };
};

export const networkIDs = await getNetworkIDs();