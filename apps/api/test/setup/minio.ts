import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { MinioContainer } from '@testcontainers/minio';
import type { E2eStorage } from './storage-settings.js';

// Same server as docker-compose.yml.
const MINIO_IMAGE = 'ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z';
// Covers pulling the image on a cold CI runner, not only the boot.
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const BUCKET = 'vozzify-e2e';
const PRIVATE_BUCKET = 'vozzify-e2e-private';
const REGION = 'us-east-1';
const ROOT_USER = 'vozzify-e2e';
const ROOT_PASSWORD = 'vozzify-e2e-secret';

const logger = new Logger('E2eStorage');

export type StartedStorage = {
  storage: E2eStorage;
  stop: () => Promise<void>;
};

// Objects are readable by anyone, like in production where they are served
// from a public files domain.
const publicReadPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${BUCKET}/*`],
    },
  ],
});

const createPublicBucket = async (storage: E2eStorage): Promise<void> => {
  const client = new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
  });
  try {
    await client
      .send(new CreateBucketCommand({ Bucket: storage.bucket }))
      .catch((error: unknown) => {
        if (!(error instanceof BucketAlreadyOwnedByYou)) {
          throw error;
        }
      });
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: storage.bucket,
        Policy: publicReadPolicy,
      }),
    );
    await client
      .send(new CreateBucketCommand({ Bucket: storage.privateBucket }))
      .catch((error: unknown) => {
        if (!(error instanceof BucketAlreadyOwnedByYou)) {
          throw error;
        }
      });
  } finally {
    client.destroy();
  }
};

const settingsFor = (
  endpoint: string,
  credentials: Pick<E2eStorage, 'accessKeyId' | 'secretAccessKey'>,
): E2eStorage => ({
  endpoint,
  region: REGION,
  bucket: BUCKET,
  privateBucket: PRIVATE_BUCKET,
  ...credentials,
  publicUrl: `${endpoint}/${BUCKET}`,
});

const startContainer = async (): Promise<StartedStorage> => {
  try {
    logger.log(`Starting ${MINIO_IMAGE} with Testcontainers`);
    const container = await new MinioContainer(MINIO_IMAGE)
      .withUsername(ROOT_USER)
      .withPassword(ROOT_PASSWORD)
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();
    logger.log(
      `MinIO container ${container.getId().slice(0, 12)} listening on ` +
        container.getConnectionUrl(),
    );
    return {
      storage: settingsFor(container.getConnectionUrl(), {
        accessKeyId: ROOT_USER,
        secretAccessKey: ROOT_PASSWORD,
      }),
      stop: async () => {
        await container.stop();
        logger.log('MinIO container stopped');
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not start the e2e MinIO container with Testcontainers (${reason}). ` +
        'Make sure Docker is running, or set E2E_S3_ENDPOINT, ' +
        'E2E_S3_ACCESS_KEY_ID and E2E_S3_SECRET_ACCESS_KEY to an existing ' +
        `S3-compatible server dedicated to tests (the "${BUCKET}" bucket is ` +
        'created there and made publicly readable).',
    );
  }
};

const externalServer = (): E2eStorage | undefined => {
  const endpoint = process.env.E2E_S3_ENDPOINT;
  if (!endpoint) {
    return undefined;
  }
  const accessKeyId = process.env.E2E_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.E2E_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'E2E_S3_ENDPOINT also needs E2E_S3_ACCESS_KEY_ID and ' +
        'E2E_S3_SECRET_ACCESS_KEY',
    );
  }
  return settingsFor(endpoint.replace(/\/+$/, ''), {
    accessKeyId,
    secretAccessKey,
  });
};

/**
 * Starts one MinIO for the whole e2e run (or uses `E2E_S3_ENDPOINT`) with the
 * public bucket the specs upload to, and returns how to reach it.
 */
export const startStorage = async (): Promise<StartedStorage> => {
  const external = externalServer();
  if (external) {
    logger.log('Using E2E_S3_ENDPOINT instead of a container');
  }
  const started = external
    ? { storage: external, stop: async () => undefined }
    : await startContainer();
  try {
    await createPublicBucket(started.storage);
  } catch (error) {
    await started.stop();
    throw error;
  }
  logger.log(`Bucket "${BUCKET}" ready`);
  return started;
};
