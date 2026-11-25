import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { StorageError } from './storage.service.js';

type S3Sender = Pick<S3Client, 'send'>;
const REQUEST_TIMEOUT_MS = 15_000;

/** Owns private bucket reads and cleanup for the S3 storage adapter. */
export class S3PrivateObjects {
  constructor(
    private readonly client: S3Sender,
    private readonly bucket: string,
  ) {}

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (error) {
      throw new StorageError(`Could not delete private object "${key}"`, {
        cause: error,
      });
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      const objects = page.Contents?.flatMap((object) =>
        object.Key === undefined ? [] : [{ Key: object.Key }],
      );
      if (objects?.length) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
          { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
      }
      continuationToken = page.NextContinuationToken;
    } while (continuationToken);
  }

  async head(key: string): Promise<{ size: number }> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (result.ContentLength === undefined) {
        throw new Error('Private object size is unavailable');
      }
      return { size: result.ContentLength };
    } catch (error) {
      throw new StorageError(`Could not inspect private object "${key}"`, {
        cause: error,
      });
    }
  }

  async get(key: string, range: string | undefined): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range === undefined ? {} : { Range: range }),
        }),
        { abortSignal: AbortSignal.timeout(2 * 60_000) },
      );
      if (!result.Body) throw new Error('The private object has no body');
      return Readable.fromWeb(
        result.Body.transformToWebStream() as unknown as NodeReadableStream<Uint8Array>,
      );
    } catch (error) {
      throw new StorageError(`Could not stream private object "${key}"`, {
        cause: error,
      });
    }
  }
}
