import { readFile } from 'node:fs/promises';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { inject } from 'vitest';
import { createDatabase, createPool } from '../src/database/database.js';
import { copyPrivateTrackAssets } from '../src/database/private-track-asset-migration.js';
import { privateTracks } from '../src/database/schema/private-tracks.js';
import { S3StorageService } from '../src/integrations/storage/s3-storage.service.js';
import { resetDatabase } from './utils/database.js';
import { createPasswordUser } from './utils/factories.js';

it('publishes referenced legacy objects without copying them twice', async () => {
  const pool = createPool(inject('databaseUrl'));
  const db = createDatabase(pool);
  const settings = inject('storage');
  const {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
    privateBucket,
  } = settings;
  const storage = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  try {
    await resetDatabase(db);
    const owner = await createPasswordUser(db);
    const key = `private-tracks/${owner.id}/legacy/ensaio com acento á.wav`;
    await db.insert(privateTracks).values({
      userId: owner.id,
      objectKey: key,
      originalFilename: 'ensaio.wav',
      title: 'Legacy upload',
      durationMs: 1_000,
      mediaObjectKey: key,
    });
    const bytes = await readFile(
      new URL('../../web/e2e/fixtures/a4-440hz.wav', import.meta.url),
    );
    await storage.send(
      new PutObjectCommand({
        Bucket: privateBucket,
        Key: key,
        Body: bytes,
        ContentType: 'audio/wav',
      }),
    );

    const migration = {
      db,
      storage,
      sourceBucket: privateBucket,
      targetBucket: bucket,
    };
    await expect(copyPrivateTrackAssets(migration)).resolves.toBe(1);
    await expect(copyPrivateTrackAssets(migration)).resolves.toBe(0);
    const assets = new S3StorageService(storage, settings);
    const response = await fetch(assets.publicUrl(key));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  } finally {
    storage.destroy();
    await pool.end();
  }
});
