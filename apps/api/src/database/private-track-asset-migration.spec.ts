import type { S3Client } from '@aws-sdk/client-s3';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { Database } from './database.js';
import { copyPrivateTrackAssets } from './private-track-asset-migration.js';

const missing = Object.assign(new Error('Missing destination'), {
  name: 'NotFound',
});

const migration = () => {
  const findMany = vi.fn<() => Promise<unknown[]>>();
  const send =
    vi.fn<
      (command: HeadObjectCommand | CopyObjectCommand) => Promise<unknown>
    >();
  return {
    findMany,
    send,
    input: {
      db: { query: { privateTracks: { findMany } } } as unknown as Database,
      storage: { send } as unknown as Pick<S3Client, 'send'>,
      sourceBucket: 'legacy',
      targetBucket: 'shared',
    },
  };
};

describe('copyPrivateTrackAssets', () => {
  it('walks all pages and skips pending YouTube sources and existing targets', async () => {
    const { findMany, send, input } = migration();
    const pending = {
      id: 'pending-youtube',
      youtubeVideoId: 'video-id',
      objectKey: 'private/youtube.wav',
      mediaObjectKey: null,
      vocalsObjectKey: null,
      pitchCurveObjectKey: null,
    };
    const ready = {
      ...pending,
      youtubeVideoId: null,
      objectKey: 'private/source.wav',
      mediaObjectKey: 'private/source.wav',
      vocalsObjectKey: 'private/vocals à.wav',
    };
    findMany
      .mockResolvedValueOnce(Array.from({ length: 100 }, () => pending))
      .mockResolvedValueOnce([ready]);
    send
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({});

    await expect(copyPrivateTrackAssets(input)).resolves.toBe(1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      HeadObjectCommand,
      HeadObjectCommand,
      CopyObjectCommand,
    ]);
    expect(send.mock.calls[2]?.[0].input).toEqual({
      Bucket: 'shared',
      CopySource: 'legacy/private/vocals%20%C3%A0.wav',
      Key: 'private/vocals à.wav',
    });
  });

  it('rejects a copy to the source bucket before touching storage', async () => {
    const { input, findMany } = migration();
    await expect(
      copyPrivateTrackAssets({ ...input, targetBucket: 'legacy' }),
    ).rejects.toThrow('The original and shared asset buckets must differ');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('propagates a destination permission error instead of overwriting', async () => {
    const { input, findMany, send } = migration();
    findMany.mockResolvedValueOnce([
      {
        id: 'upload',
        youtubeVideoId: null,
        objectKey: 'private/source.wav',
        mediaObjectKey: null,
        vocalsObjectKey: null,
        pitchCurveObjectKey: null,
      },
    ]);
    const denied = new Error('Access denied');
    send.mockRejectedValueOnce(denied);
    await expect(copyPrivateTrackAssets(input)).rejects.toBe(denied);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
