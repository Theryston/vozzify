import type { Env } from '../../config/env.js';

export type StorageConfig = {
  /** Unset for AWS; the server's URL for S3-compatible ones (MinIO). */
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Base URL objects are served from, without a trailing slash. */
  publicUrl: string;
};

/**
 * The env schema accepts a config with no S3 variable at all (and rejects a
 * partial one), so this is where a missing storage config stops the app from
 * booting instead of failing on the first upload.
 *
 * @throws {Error} when the S3 variables are not set.
 */
export const resolveStorageConfig = (env: Env): StorageConfig => {
  const {
    S3_ENDPOINT: endpoint,
    S3_REGION: region,
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
    S3_FORCE_PATH_STYLE: forcePathStyle,
    S3_PUBLIC_URL: publicUrl,
  } = env;
  if (
    region === undefined ||
    bucket === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    publicUrl === undefined
  ) {
    throw new Error(
      'File storage is not configured: set S3_REGION, S3_BUCKET, ' +
        'S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_PUBLIC_URL',
    );
  }
  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: forcePathStyle ?? false,
    publicUrl,
  };
};
