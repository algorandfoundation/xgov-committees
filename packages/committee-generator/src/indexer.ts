import { Indexer } from 'algosdk';
import { config } from './config.ts';

const { indexerServer, indexerPort, indexerToken } = config;

export const indexer = new Indexer(indexerToken, indexerServer, indexerPort);
