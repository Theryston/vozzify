/** Connection details of the S3-compatible server the e2e run uses. */
export type E2eStorage = {
  endpoint: string;
  region: string;
  bucket: string;
  privateBucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Where the bucket's objects are served from (path-style, on MinIO). */
  publicUrl: string;
};

/** Points the env schema's `S3_*` variables at the e2e storage server. */
export const applyStorageEnv = (storage: E2eStorage): void => {
  process.env.S3_ENDPOINT = storage.endpoint;
  process.env.S3_REGION = storage.region;
  process.env.S3_BUCKET = storage.bucket;
  process.env.S3_PRIVATE_BUCKET = storage.privateBucket;
  process.env.S3_ACCESS_KEY_ID = storage.accessKeyId;
  process.env.S3_SECRET_ACCESS_KEY = storage.secretAccessKey;
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.S3_PUBLIC_URL = storage.publicUrl;
};
