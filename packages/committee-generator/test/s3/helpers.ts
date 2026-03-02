import type { Committee } from '../../src/committee';
import type { NetworkMetadata } from '../../src/algod';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { TEST_BUCKET_NAME } from './setup';

export const TEST_NETWORK_METADATA: NetworkMetadata = {
  genesisID: 'mainnet-v1.0',
  genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
};

export function createCommitteeFixture(
  fromRound: number,
  toRound: number,
  customXGovs?: { address: string; votes: number }[],
): Committee {
  const xGovs = customXGovs || [
    {
      address: 'ROBOTMMVHPOETOTAX3J26UXYKVZX6QB7FHHYGBC44JNBUXMTABD5I3CODE',
      votes: 100,
    },
    {
      address: 'ZOMBILANDSIUYQWIUYNKUYZVMCYY6IIT5IBAVNJYYWTVMQVZRBORLOP37E',
      votes: 50,
    },
  ];

  return {
    networkGenesisHash: TEST_NETWORK_METADATA.genesisHash,
    periodEnd: toRound,
    periodStart: fromRound,
    registryId: 3147789458,
    totalMembers: xGovs.length,
    totalVotes: xGovs.reduce((sum, x) => sum + x.votes, 0),
    xGovs,
  };
}

export function getExpectedKey(suffix: string): string {
  const networkPrefix = `${TEST_NETWORK_METADATA.genesisID}-${TEST_NETWORK_METADATA.genesisHash.replace(/[/=]/g, '_')}`;
  return `${networkPrefix}/${suffix}`;
}

/**
 * Clean up S3 objects with the given prefix
 */
export async function cleanupS3Prefix(s3Client: S3Client, prefix: string): Promise<void> {
  try {
    let continuationToken: string | undefined;
    do {
      const listResponse: ListObjectsV2CommandOutput = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: TEST_BUCKET_NAME,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_BUCKET_NAME,
            Delete: {
              Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key ?? '' })),
            },
          }),
        );
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);
  } catch {
    // Ignore cleanup errors
  }
}
