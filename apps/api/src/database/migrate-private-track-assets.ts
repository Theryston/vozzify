import { Logger } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { createS3Client } from '../integrations/storage/s3-storage.service.js';
import { resolveStorageConfig } from '../integrations/storage/storage-config.js';
import { createDatabase, createPool } from './database.js';
import { copyPrivateTrackAssets } from './private-track-asset-migration.js';

const env = loadEnv();
const logger = new Logger('PrivateTrackAssetMigration');
const config = resolveStorageConfig(env);
const pool = createPool(env.DATABASE_URL);
const storage = createS3Client(config);
try {
  const copied = await copyPrivateTrackAssets({
    db: createDatabase(pool),
    storage,
    sourceBucket: env.S3_PRIVATE_BUCKET ?? `${config.bucket}-private`,
    targetBucket: config.bucket,
  });
  logger.log(`Copied ${copied} private track assets to ${config.bucket}`);
} finally {
  storage.destroy();
  await pool.end();
}
