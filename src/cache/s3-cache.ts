import { config } from "../config";
import {
  getData,
  getKeyWithNetworkMetadata,
  getPublicUrlForObject,
  objectExists,
  uploadData,
} from "../s3";

export type CachePagePayload = Record<string, string>;

/**
 * Fetches a cache page from S3.
 * Returns the parsed page data if found, undefined if not found.
 * Throws on errors (caller should handle gracefully).
 */
export async function fetchPageFromS3(
  pageStart: number,
): Promise<CachePagePayload | undefined> {
  // In use-cache mode, fetch from public URL endpoint
  if (config.cacheMode === "use-cache") {
    const url = getPublicUrlForObject(`blocks/${pageStart}.json`); // For backward compatibility with old key format

    console.log(`Fetching S3 page: ${url}`);

    try {
      const res = await fetch(url);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`Fetching ${url} failed: ${res.status}`);
      const data = await res.json();

      if (config.verbose) {
        console.debug(`S3 cache hit: ${url}`);
      }

      return data as CachePagePayload;
    } catch (error) {
      if (config.verbose) {
        console.debug(`S3 cache miss: ${url}`);
      }
      throw error;
    }
  }

  const key = getKeyWithNetworkMetadata(`blocks/${pageStart}.json`); // For backward compatibility with old key format

  try {
    const body = await getData(key);

    if (!body) {
      return undefined;
    }

    // Convert stream or string body to string
    const bodyString =
      typeof body === "string" ? body : await body.transformToString("utf-8");
    const data = JSON.parse(bodyString) as CachePagePayload;

    if (config.verbose) {
      console.debug(`S3 cache hit: ${key}`);
    }

    return data;
  } catch (error) {
    const err = error as {
      $metadata?: { httpStatusCode?: number };
      name?: string;
      Code?: string;
    };

    // 404 means not found - this is expected, return undefined
    if (
      err?.$metadata?.httpStatusCode === 404 ||
      err?.name === "NoSuchKey" ||
      err?.Code === "NoSuchKey"
    ) {
      if (config.verbose) {
        console.debug(`S3 cache miss: ${key}`);
      }
      return undefined;
    }

    // Other errors should be thrown so caller can handle
    throw error;
  }
}

/**
 * Uploads a cache page to S3.
 * Throws on error (caller should handle gracefully).
 */
export async function uploadPageToS3(
  pageStart: number,
  data: CachePagePayload,
): Promise<void> {
  const key = getKeyWithNetworkMetadata(`blocks/${pageStart}.json`); // For backward compatibility with old key format

  await uploadData(key, JSON.stringify(data));

  if (config.verbose) {
    console.debug(`Uploaded to S3: ${key}`);
  }
}

/**
 * Checks if a cache page exists in S3 without downloading it.
 * Returns true if exists, false if not found.
 * Throws on errors (caller should handle gracefully).
 */
export async function pageExistsS3(pageStart: number): Promise<boolean> {
  const key = getKeyWithNetworkMetadata(`blocks/${pageStart}.json`); // For backward compatibility with old key format
  return objectExists(key);
}
