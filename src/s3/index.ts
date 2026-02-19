import {
  _Object,
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { networkMetadata } from "../algod";
import { config } from "../config";
import { createReadStream } from "fs";
import { stat as fsStat } from "fs/promises";
import pMap from "p-map";
import { formatBytes } from "../cache/utils";
import { walkDir } from "../utils";
import { relative } from "path";

const {
  s3: { bucketName, region, endpoint, accessKeyId, secretAccessKey, publicUrl },
} = config;

// Initialize S3 client
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 credentials are not fully configured. Please set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in your environment variables.",
    );
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: region,
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      },
    });
  }
  return s3Client;
}

/**
 * Deletes all objects in the specified S3 bucket that have keys starting with the given prefix.
 * @param dirPrefix prefix to delete
 * @returns {Promise<void>} Resolves when the directory is deleted
 */
export async function deleteDirectory(dirPrefix: string): Promise<void> {
  const client = getS3Client();

  if (config.verbose) {
    console.log(`Deleting directory: s3://${bucketName}/${dirPrefix}`);
  }

  try {
    let isTruncated = true;
    let continuationToken: string | undefined;

    while (isTruncated) {
      // 1. List objects with the given prefix
      const listParams = {
        Bucket: bucketName,
        Prefix: dirPrefix,
        ContinuationToken: continuationToken,
      };

      const listResponse = await client.send(
        new ListObjectsV2Command(listParams),
      );

      const objects = listResponse.Contents;

      if (objects && objects.length > 0) {
        // 2. Prepare objects for batch deletion
        const deleteParams = {
          Bucket: bucketName,
          Delete: {
            Objects: objects.map((object: _Object) => ({
              Key: object.Key as string,
            })),
            Quiet: false, // Set to true for less verbose response
          },
        };

        // 3. Delete objects in a single request (up to 1000 per call)
        await client.send(new DeleteObjectsCommand(deleteParams));

        if (config.verbose) {
          console.log(`Deleted ${objects.length} objects.`);
        }
      }

      isTruncated = listResponse.IsTruncated ?? false;
      continuationToken = listResponse.NextContinuationToken;
    }

    if (config.verbose) {
      console.log("Directory deletion complete.");
    }
  } catch (err) {
    console.error("Error deleting directory:", err);
    throw err;
  }
}

/**
 * Check if object exists in S3
 * @param key The S3 key to check for existence
 * @returns {Promise<boolean>} True if exists, false if not found. Throws on errors.
 */
export async function objectExists(key: string): Promise<boolean> {
  const client = getS3Client();

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return true;
  } catch (error) {
    const err = error as {
      $metadata?: { httpStatusCode?: number };
      name?: string;
      Code?: string;
    };
    if (
      err?.$metadata?.httpStatusCode === 404 ||
      err?.name === "NotFound" ||
      err?.Code === "NotFound"
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Lists all keys in the S3 bucket that start with the specified prefix.
 * @param prefix prefix to list
 * @returns {Promise<Set<string>>} A set of keys with the specified prefix
 */
export async function listKeysWithPrefix(prefix: string): Promise<Set<string>> {
  const client = getS3Client();
  const keys = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of page.Contents ?? []) {
      if (obj.Key) keys.add(obj.Key);
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

/**
 * We must be able to serve committee data from S3 by the period end round, to facilitate this we just create a copy of the existing files
 */
export async function ensureCommitteeShortcuts(): Promise<void> {
  const client = getS3Client();

  console.log("Creating committee shortcuts...");

  const keys = await listKeysWithPrefix(
    getKeyWithNetworkMetadata("committee/"),
  );

  for (const key of keys) {
    //console.log(`Found file: ${key}`);
    const match = key.match(/committee\/(\d+)-(\d+)\.json$/);
    if (match) {
      const fromRound = match[1];
      const toRound = match[2];
      const shortcutKey = key.replace(
        /committee\/(\d+)-(\d+)\.json$/,
        `committee/${toRound}.json`,
      );

      if (await objectExists(shortcutKey)) {
        console.log(`Shortcut already exists: ${shortcutKey}`);
        continue;
      }

      console.log(
        `Creating shortcut from round ${fromRound} to ${toRound}: ${shortcutKey}`,
      );

      // Copy the object in S3
      await client.send(
        new CopyObjectCommand({
          Bucket: bucketName,
          CopySource: `${bucketName}/${key}`,
          Key: shortcutKey,
        }),
      );
    } else {
      //console.warn(`Skipping unrecognized committee file format: ${key}`);
    }
  }
}

export async function syncDirectory(directoryPath: string) {
  const client = getS3Client();
  // Note: streaming file bodies avoids loading whole files into memory.
  const UPLOAD_CONCURRENCY = 25;
  const LIST_CONCURRENCY = 5;
  const HEAD_CONCURRENCY = 50;

  const files = await walkDir(directoryPath);
  const fileToKey = (filePath: string) =>
    relative(directoryPath, filePath).replace(/\\/g, "/");

  const keys = files.map(fileToKey);

  // Optimize existence checks:
  // - For nested keys, list only the relevant top-level prefixes (instead of the whole bucket).
  // - For root-level keys (no '/'), use HEAD so we don't list the entire bucket.
  const topPrefixes = new Set<string>();
  const rootKeys: string[] = [];
  for (const key of keys) {
    const firstSlash = key.indexOf("/");
    if (firstSlash === -1) {
      rootKeys.push(key);
    } else {
      topPrefixes.add(key.slice(0, firstSlash + 1));
    }
  }

  console.log(
    `Checking which objects already exist in bucket "${bucketName}"...`,
  );
  const existingKeys = new Set<string>();

  // List under each top-level prefix, in parallel.
  const prefixes = Array.from(topPrefixes);
  await pMap(
    prefixes,
    async (prefix) => {
      const prefixKeys = await listKeysWithPrefix(prefix);
      for (const k of prefixKeys) existingKeys.add(k);
    },
    { concurrency: LIST_CONCURRENCY },
  );

  // HEAD root-level keys to avoid listing the entire bucket.
  if (rootKeys.length > 0) {
    await pMap(
      rootKeys,
      async (key) => {
        if (await objectExists(key)) existingKeys.add(key);
      },
      { concurrency: HEAD_CONCURRENCY },
    );
  }

  const filesToUpload: string[] = [];
  for (const filePath of files) {
    const key = fileToKey(filePath);

    if (!existingKeys.has(key)) filesToUpload.push(filePath);
  }

  console.log(
    `Uploading directory "${directoryPath}" to bucket "${bucketName}"...`,
  );
  console.log(
    `${filesToUpload.length} files to upload, ${files.length - filesToUpload.length} already in bucket`,
  );

  const uploadStart = Date.now();
  let uploadedCount = 0;
  let uploadedBytes = 0;

  await pMap(
    filesToUpload,
    async (filePath) => {
      const key = fileToKey(filePath);
      const st = await fsStat(filePath);
      const size = st.size ?? 0;
      const body = createReadStream(filePath);

      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ChecksumAlgorithm: "SHA256",
        }),
      );

      uploadedCount++;
      uploadedBytes += size;
      if (uploadedCount % 250 === 0 || uploadedCount === filesToUpload.length) {
        console.log(
          `Progress: ${uploadedCount}/${filesToUpload.length} uploaded`,
        );
      }
    },
    { concurrency: UPLOAD_CONCURRENCY },
  );

  const uploadEnd = Date.now();
  const elapsedMs = uploadEnd - uploadStart;
  const elapsedSec = elapsedMs / 1000;
  const filesPerSec = filesToUpload.length / (elapsedSec || 1);
  const bytesPerSec = uploadedBytes / (elapsedSec || 1);
  console.log(
    `Upload summary: ${filesToUpload.length} files uploaded in ${elapsedSec.toFixed(2)}s (${filesPerSec.toFixed(2)} files/s)`,
  );
  console.log(
    `Transferred ${formatBytes(uploadedBytes)} (${formatBytes(bytesPerSec)}/s)`,
  );
}

export async function getHashForKey(key: string): Promise<string | undefined> {
  const client = getS3Client();

  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: bucketName, Key: key }),
    );
    return response.ChecksumSHA256;
  } catch (error) {
    const err = error as {
      $metadata?: { httpStatusCode?: number };
      name?: string;
      Code?: string;
    };
    if (
      err?.$metadata?.httpStatusCode === 404 ||
      err?.name === "NotFound" ||
      err?.Code === "NotFound"
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function getData(key: string): Promise<any> {
  const client = getS3Client();

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`No data found at key: ${key}`);
    }

    return response.Body;
  } catch (error) {
    console.error(`Error getting data from s3://${bucketName}/${key}:`, error);
    throw error;
  }
}

/**
 * Upload data to S3 under the specified key.
 * @param key S3 key to upload under
 * @param data string or buffer data to upload
 * @returns {Promise<void>} Resolves when upload is complete
 */
export async function uploadData(key: string, data: string): Promise<void> {
  const client = getS3Client();

  if (config.verbose) {
    console.log(`Uploading data to s3://${bucketName}/${key}...`);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: data,
      ContentType: "application/json",
      ChecksumAlgorithm: "SHA256",
    }),
  );
}

/**
 * Get key with network metadata prefix
 * @param keySuffix suffix part of the key, without network metadata
 * @returns {string} Key with network metadata prefix
 */
export function getKeyWithNetworkMetadata(keySuffix: string): string {
  const { genesisID, genesisHash } = networkMetadata;

  const networkPrefix = `${genesisID}-${genesisHash.replace(/[\/=]/g, "_")}`;

  return `${networkPrefix}/${keySuffix}`;
}

/**
 * Gets the public URL for an object stored in S3, based on the configured public URL and network metadata.
 * @param keySuffix end part of the key, without the network metadata prefix
 * @returns {string} Public URL for the object
 */
export function getPublicUrlForObject(keySuffix: string): string {
  if (!publicUrl) {
    throw new Error("S3 public URL is not configured");
  }

  return `${publicUrl.replace(/\/$/, "")}/${getKeyWithNetworkMetadata(keySuffix)}`;
}
