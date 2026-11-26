import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import {
  createS3Client,
  createUrlPresigner,
  S3StorageService,
} from './s3-storage.service.js';
import { StorageService } from './storage.service.js';
import { resolveStorageConfig } from './storage-config.js';

@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ENV],
      // Throws while the app boots when the S3 variables are missing.
      useFactory: (env: Env) => {
        const config = resolveStorageConfig(env);
        const client = createS3Client(config);
        return new S3StorageService(client, config, createUrlPresigner(client));
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
