export type PublicObject = {
  /** Where the object lives inside the bucket, e.g. `avatars/{userId}.webp`. */
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type PublicFile = Omit<PublicObject, 'body'> & { filePath: string };

/** The upload a presigned URL allows: one object, at one key, for a limited time. */
export type PresignedPut = {
  key: string;
  contentType: string;
  expiresInSeconds: number;
};

/**
 * A storage backend failed. The SDK's own error is the `cause`, so callers
 * can log it without depending on the SDK.
 */
export class StorageError extends Error {
  override readonly name = 'StorageError';
}

/**
 * Public file storage, as much of it as features need: put an object anyone
 * can read, and know the URL it is served from. Features depend on this class
 * (it doubles as the injection token), never on an SDK, so tests replace it
 * with a mock; `S3StorageService` is the one implementation.
 *
 * Writing an existing key overwrites it. When the URL of the new content must
 * differ from the old one (caches), the caller adds its own query string.
 */
export abstract class StorageService {
  /** @throws {StorageError} when the object could not be stored. */
  abstract putPublicObject(object: PublicObject): Promise<void>;

  /** Stream a caller-owned file without loading the complete object in memory. */
  abstract putPublicFile(file: PublicFile): Promise<void>;

  /**
   * Whether an object is stored under this key. A key that is not there is
   * `false`; any other failure to find out is a `StorageError`.
   */
  abstract objectExists(key: string): Promise<boolean>;

  /** URL the object with this key is served from once stored. */
  abstract publicUrl(key: string): string;

  /**
   * A URL that stores one object at the key with a single PUT, valid for
   * `expiresInSeconds`. A client that uploads through it needs no storage
   * credentials; the object is then served from `publicUrl(key)`.
   *
   * @throws {StorageError} when the URL could not be signed.
   */
  abstract presignPublicPut(put: PresignedPut): Promise<string>;

  /**
   * The bytes of an object stored with `putPublicObject`, read back from its
   * public URL: what a step needs when an earlier step stored its input.
   *
   * @throws {StorageError} when the object could not be read.
   */
  abstract downloadPublicObject(url: string): Promise<Uint8Array<ArrayBuffer>>;
}
