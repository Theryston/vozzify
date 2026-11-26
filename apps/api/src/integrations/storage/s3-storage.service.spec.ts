import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createS3Client, S3StorageService } from './s3-storage.service.js';
import { StorageError, StorageService } from './storage.service.js';

const config = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'vozzify',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  forcePathStyle: true,
  publicUrl: 'https://files.example.com',
};

describe('S3StorageService', () => {
  const send = vi.fn();
  const destroy = vi.fn();
  let service: S3StorageService;

  beforeEach(() => {
    send.mockReset().mockResolvedValue({});
    destroy.mockReset();
    service = new S3StorageService({ send, destroy }, config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a StorageService', () => {
    expect(service).toBeInstanceOf(StorageService);
  });

  describe('putPublicObject', () => {
    const object = {
      key: 'avatars/user-1.webp',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/webp',
    };

    it('uploads the bytes as a publicly readable object', async () => {
      await service.putPublicObject(object);

      expect(send).toHaveBeenCalledOnce();
      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'vozzify',
        Key: 'avatars/user-1.webp',
        Body: object.body,
        ContentType: 'image/webp',
        ACL: 'public-read',
      });
    });

    it('gives up on a storage server that never answers', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');

      await service.putPublicObject(object);

      expect(timeout).toHaveBeenCalledWith(15_000);
      expect(send.mock.calls[0]?.[1]).toEqual({
        abortSignal: timeout.mock.results[0]?.value,
      });
    });

    it('wraps SDK failures without exposing SDK types', async () => {
      const failure = new Error('AccessDenied: credentials rejected');
      send.mockRejectedValue(failure);

      const error = await service.putPublicObject(object).catch((e) => e);

      expect(error).toBeInstanceOf(StorageError);
      expect(error).toMatchObject({
        name: 'StorageError',
        message: 'Could not store "avatars/user-1.webp"',
        cause: failure,
      });
    });
  });

  describe('publicUrl', () => {
    it('joins the public base URL and the key', () => {
      expect(service.publicUrl('avatars/user-1.webp')).toBe(
        'https://files.example.com/avatars/user-1.webp',
      );
    });

    it('keeps the base path, for path-style servers', () => {
      const pathStyle = new S3StorageService(
        { send, destroy },
        { ...config, publicUrl: 'http://localhost:9000/vozzify' },
      );
      expect(pathStyle.publicUrl('a/b.png')).toBe(
        'http://localhost:9000/vozzify/a/b.png',
      );
    });

    it('encodes each segment so the URL addresses the same object', () => {
      expect(service.publicUrl('avatars/a b#c?d%e/ção.webp')).toBe(
        'https://files.example.com/avatars/a%20b%23c%3Fd%25e/%C3%A7%C3%A3o.webp',
      );
    });
  });

  describe('objectExists', () => {
    it('is true for a key that is stored, found by a HEAD of its bucket and key', async () => {
      await expect(service.objectExists('track-audio/a.wav')).resolves.toBe(
        true,
      );

      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'vozzify',
        Key: 'track-audio/a.wav',
      });
    });

    it('is false for a key that is not stored', async () => {
      const notFound = new Error('NotFound');
      notFound.name = 'NotFound';
      send.mockRejectedValue(notFound);

      await expect(service.objectExists('track-audio/a.wav')).resolves.toBe(
        false,
      );
    });

    it('fails with a StorageError when the server cannot answer', async () => {
      send.mockRejectedValue(new Error('connection reset'));

      const failure = service.objectExists('track-audio/a.wav');

      await expect(failure).rejects.toBeInstanceOf(StorageError);
      await expect(failure).rejects.toThrow(
        'Could not check "track-audio/a.wav"',
      );
    });
  });

  describe('deletePrivateObject', () => {
    it('deletes one private track object from the shared bucket', async () => {
      await service.deletePrivateObject('private-tracks/user-1/source');

      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'vozzify',
        Key: 'private-tracks/user-1/source',
      });
    });

    it('wraps deletion failures as StorageError', async () => {
      send.mockRejectedValue(new Error('permission denied'));

      await expect(
        service.deletePrivateObject('private-tracks/user-1/source'),
      ).rejects.toMatchObject({
        name: 'StorageError',
        message:
          'Could not delete private object "private-tracks/user-1/source"',
      });
    });
  });

  describe('deletePrivateObjectsWithPrefix', () => {
    it('deletes every paginated key under the private prefix', async () => {
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'private-tracks/u1/e1/source' }],
          IsTruncated: true,
          NextContinuationToken: 'next-page',
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Contents: [{ Key: 'private-tracks/u1/e1/notes.json' }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({});

      await service.deletePrivateObjectsWithPrefix('private-tracks/u1/e1/');

      expect(send.mock.calls.map(([command]) => command)).toEqual([
        expect.any(ListObjectsV2Command),
        expect.any(DeleteObjectsCommand),
        expect.any(ListObjectsV2Command),
        expect.any(DeleteObjectsCommand),
      ]);
      expect(send.mock.calls[0]?.[0].input).toMatchObject({
        Bucket: 'vozzify',
        Prefix: 'private-tracks/u1/e1/',
      });
      expect(send.mock.calls[2]?.[0].input).toMatchObject({
        ContinuationToken: 'next-page',
      });
    });

    it('treats an empty prefix as already clean', async () => {
      send.mockResolvedValue({ Contents: [], IsTruncated: false });

      await expect(
        service.deletePrivateObjectsWithPrefix('private-tracks/u1/e1/'),
      ).resolves.toBeUndefined();

      expect(send).toHaveBeenCalledOnce();
    });
  });

  it('closes the client when the app shuts down', () => {
    service.onModuleDestroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('createS3Client', () => {
  it('points the client at an S3-compatible server', async () => {
    const client = createS3Client(config);

    expect(await client.config.region()).toBe('us-east-1');
    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.credentials()).toMatchObject({
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    });
    expect(await client.config.endpoint?.()).toMatchObject({
      protocol: 'http:',
      hostname: 'localhost',
      port: 9000,
    });
  });

  it('talks to AWS when there is no endpoint', () => {
    const client = createS3Client({
      ...config,
      endpoint: undefined,
      forcePathStyle: false,
    });

    expect(client.config.endpoint).toBeUndefined();
    expect(client.config.forcePathStyle).toBe(false);
  });
});
