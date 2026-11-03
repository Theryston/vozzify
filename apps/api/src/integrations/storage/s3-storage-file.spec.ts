import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3StorageService } from './s3-storage.service.js';
import { StorageError } from './storage.service.js';

describe('S3 streamed file uploads', () => {
  let dir: string;
  let filePath: string;
  const send = vi.fn();
  const storage = new S3StorageService(
    { send, destroy: vi.fn() },
    {
      bucket: 'vozzify',
      publicUrl: 'https://files.test',
    },
  );

  beforeEach(async () => {
    send.mockReset();
    dir = await mkdtemp(join(tmpdir(), 's3-file-spec-'));
    filePath = join(dir, 'audio.wav');
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes a file stream and known content length to S3, then closes it', async () => {
    let body: Readable | undefined;
    send.mockImplementation(async (command: PutObjectCommand) => {
      expect(command.input).toMatchObject({
        Bucket: 'vozzify',
        Key: 'audio.wav',
        ContentLength: 3,
        ContentType: 'audio/wav',
        ACL: 'public-read',
      });
      if (!(command.input.Body instanceof Readable))
        throw new Error('Expected file stream');
      body = command.input.Body;
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
    });

    await storage.putPublicFile({
      key: 'audio.wav',
      filePath,
      contentType: 'audio/wav',
    });

    expect(body?.destroyed).toBe(true);
    expect(send.mock.calls[0]?.[1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('closes its file stream and wraps an S3 failure', async () => {
    let body: Readable | undefined;
    send.mockImplementation(async (command: PutObjectCommand) => {
      if (command.input.Body instanceof Readable) body = command.input.Body;
      throw new Error('S3 unavailable');
    });

    await expect(
      storage.putPublicFile({
        key: 'audio.wav',
        filePath,
        contentType: 'audio/wav',
      }),
    ).rejects.toMatchObject({
      name: 'StorageError',
      cause: new Error('S3 unavailable'),
    });
    expect(body?.destroyed).toBe(true);
  });

  it('wraps a missing local file without sending an upload', async () => {
    await expect(
      storage.putPublicFile({
        key: 'audio.wav',
        filePath: join(dir, 'missing'),
        contentType: 'audio/wav',
      }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(send).not.toHaveBeenCalled();
  });
});
