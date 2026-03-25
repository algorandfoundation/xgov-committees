import { Algodv2 } from 'algosdk';
import { config } from './config.ts';

export const algod = new Algodv2(config.algodToken, config.algodServer, config.algodPort);

export type NetworkMetadata = { genesisID: string; genesisHash: string };

export const getNetworkMetadata = async () => {
  const { genesisID, genesisHash } = await algod.getTransactionParams().do();
  return {
    genesisID,
    genesisHash: Buffer.from(genesisHash).toString('base64'),
  };
};

export const networkMetadata = await getNetworkMetadata();
