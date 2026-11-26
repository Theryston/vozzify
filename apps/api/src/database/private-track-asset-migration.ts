import type { S3Client } from '@aws-sdk/client-s3';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { asc, gt } from 'drizzle-orm';
import type { Database } from './database.js';
import { privateTracks } from './schema/private-tracks.js';

const PAGE_SIZE = 100;
const STORAGE_TIMEOUT_MS = 120_000;

type AssetMigration = {
  db: Database;
  storage: Pick<S3Client, 'send'>;
  sourceBucket: string;
  targetBucket: string;
};

export async function copyPrivateTrackAssets(
  migration: AssetMigration,
): Promise<number> {
  const { db, sourceBucket, targetBucket } = migration;
  if (sourceBucket === targetBucket) {
    throw new Error('The original and shared asset buckets must differ');
  }
  let copied = 0;
  let after: string | undefined;
  for (;;) {
    const page = await db.query.privateTracks.findMany({
      columns: {
        id: true,
        youtubeVideoId: true,
        objectKey: true,
        mediaObjectKey: true,
        vocalsObjectKey: true,
        pitchCurveObjectKey: true,
      },
      where: after === undefined ? undefined : gt(privateTracks.id, after),
      orderBy: asc(privateTracks.id),
      limit: PAGE_SIZE,
    });
    for (const row of page) {
      copied += await copyTrackObjects(migration, [
        row.youtubeVideoId === null ? row.objectKey : null,
        row.mediaObjectKey,
        row.vocalsObjectKey,
        row.pitchCurveObjectKey,
      ]);
    }
    if (page.length < PAGE_SIZE) return copied;
    after = page.at(-1)?.id;
  }
}

async function copyTrackObjects(
  { storage, sourceBucket, targetBucket }: AssetMigration,
  keys: (string | null)[],
): Promise<number> {
  let copied = 0;
  for (const key of new Set(keys)) {
    if (!key || (await alreadyCopied(storage, targetBucket, key))) continue;
    const path = key.split('/').map(encodeURIComponent).join('/');
    await storage.send(
      new CopyObjectCommand({
        Bucket: targetBucket,
        Key: key,
        CopySource: `${sourceBucket}/${path}`,
      }),
      { abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) },
    );
    copied += 1;
  }
  return copied;
}

async function alreadyCopied(
  storage: Pick<S3Client, 'send'>,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFound') return false;
    throw error;
  }
}
