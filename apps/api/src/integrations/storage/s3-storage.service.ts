import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  type PresignedPut,
  type PublicFile,
  type PublicObject,
  StorageError,
  StorageService,
} from './storage.service.js';
import type { StorageConfig } from './storage-config.js';

// Without a deadline, a storage server that stops answering would hold a
// request open indefinitely.
const REQUEST_TIMEOUT_MS = 15_000;

/** The part of the SDK client used here, so tests can pass a fake. */
type S3Sender = Pick<S3Client, 'send' | 'destroy'>;

/** Signs a PUT of the command into a URL valid for `expiresIn` seconds. */
export type UrlPresigner = (
  command: PutObjectCommand,
  expiresIn: number,
) => Promise<string>;

/**
 * The SDK's presigner over a client's credentials. It sends no request: the
 * URL is signed locally, so it only needs the client's configuration.
 */
export const createUrlPresigner =
  (client: S3Client): UrlPresigner =>
  (command, expiresIn) =>
    getSignedUrl(client, command, { expiresIn });

/** A HEAD of a missing key fails with the SDK's `NotFound`. */
const isNotFound = (error: unknown): boolean =>
  error instanceof Error && error.name === 'NotFound';

export const createS3Client = (config: StorageConfig): S3Client =>
  new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

/**
 * `StorageService` on any S3 API: AWS S3 in production, MinIO locally and in
 * the e2e tests. The only class that touches the AWS SDK.
 */
export class S3StorageService
  extends StorageService
  implements OnModuleDestroy
{
  constructor(
    private readonly client: S3Sender,
    private readonly config: Pick<StorageConfig, 'bucket' | 'publicUrl'>,
    // Without it, presigning fails (see `createUrlPresigner`).
    private readonly presigner?: UrlPresigner,
  ) {
    super();
  }

  async presignPublicPut({
    key,
    contentType,
    expiresInSeconds,
  }: PresignedPut): Promise<string> {
    if (this.presigner === undefined) {
      throw new StorageError(`Cannot presign "${key}": no presigner is set`);
    }
    try {
      return await this.presigner(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: contentType,
        }),
        expiresInSeconds,
      );
    } catch (error) {
      throw new StorageError(`Could not presign "${key}"`, { cause: error });
    }
  }

  async putPublicObject({
    key,
    body,
    contentType,
  }: PublicObject): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ACL: 'public-read',
        }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (error) {
      throw new StorageError(`Could not store "${key}"`, { cause: error });
    }
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw new StorageError(`Could not check "${key}"`, { cause: error });
    }
  }

  async putPublicFile({
    key,
    filePath,
    contentType,
  }: PublicFile): Promise<void> {
    let body: ReturnType<typeof createReadStream> | undefined;
    try {
      const { size } = await stat(filePath);
      body = createReadStream(filePath);
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: contentType,
          ACL: 'public-read',
        }),
        { abortSignal: AbortSignal.timeout(2 * 60_000) },
      );
    } catch (error) {
      throw new StorageError(`Could not store "${key}"`, { cause: error });
    } finally {
      body?.destroy();
    }
  }

  publicUrl(key: string): string {
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `${this.config.publicUrl}/${path}`;
  }

  /** Read over HTTP from the public URL, which needs no credentials. */
  async downloadPublicObject(url: string): Promise<Uint8Array<ArrayBuffer>> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new StorageError(`Could not download ${url}`, { cause: error });
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
