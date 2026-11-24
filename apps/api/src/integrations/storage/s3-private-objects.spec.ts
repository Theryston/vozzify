import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3PrivateObjects } from './s3-private-objects.js';

const privateBucket = 'vozzify-private';

describe('S3PrivateObjects', () => {
  const send = vi.fn();
  let objects: S3PrivateObjects;

  beforeEach(() => {
    vi.resetAllMocks();
    send.mockResolvedValue({});
    objects = new S3PrivateObjects(
      { send } as unknown as Pick<S3Client, 'send'>,
      privateBucket,
    );
  });

  it('reads only the requested object byte range', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    });
    send.mockResolvedValue({
      Body: { transformToWebStream: () => source },
    });

    const body = await objects.get('private-track/audio.wav', 'bytes=10-11');
    const chunks = [];
    for await (const chunk of body) chunks.push(chunk);

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2]));
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: privateBucket,
      Key: 'private-track/audio.wav',
      Range: 'bytes=10-11',
    });
  });

  it('reads private object size with HEAD', async () => {
    send.mockResolvedValue({ ContentLength: 512 });

    await expect(objects.head('private-track/audio.wav')).resolves.toEqual({
      size: 512,
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('deletes an exact key and paginates prefix cleanup', async () => {
    await objects.delete('private-track/audio.wav');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);

    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'private-track/one' }],
        NextContinuationToken: 'next',
      })
      .mockResolvedValueOnce({ Contents: [] });
    await objects.deletePrefix('private-track/');

    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectsCommand);
    expect(send.mock.calls[3]?.[0]).toMatchObject({
      input: { ContinuationToken: 'next' },
    });
  });
});
