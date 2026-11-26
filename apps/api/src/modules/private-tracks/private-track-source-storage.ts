import { Injectable } from '@nestjs/common';
import {
  type PrivateFile,
  StorageService,
} from '../../integrations/storage/storage.service.js';
import { PRIVATE_TRACK_UPLOAD_URL_TTL_MS } from './private-track-asset-cleanup.job.js';
import { PrivateTrackAssetCleanupQueue } from './private-track-asset-cleanup.queue.js';

@Injectable()
export class PrivateTrackSourceStorage {
  constructor(
    private readonly storage: StorageService,
    private readonly cleanup: PrivateTrackAssetCleanupQueue,
  ) {}

  async putPrivateFile(file: PrivateFile): Promise<void> {
    await this.cleanup.schedulePrivateObjectCleanup(
      file.key,
      PRIVATE_TRACK_UPLOAD_URL_TTL_MS,
    );
    await this.storage.putPrivateFile(file);
  }

  deletePrivateObject(key: string): Promise<void> {
    return this.storage.deletePrivateObject(key);
  }

  publicUrl(key: string): string {
    return this.storage.publicUrl(key);
  }
}

export type PrivateTrackSourceStoragePort = Pick<
  StorageService,
  'putPrivateFile' | 'deletePrivateObject' | 'publicUrl'
>;
