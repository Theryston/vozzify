import { Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { PRIVATE_TRACK_UPLOAD_URL_TTL_MS } from './private-track-asset-cleanup.job.js';
import { PrivateTrackAssetCleanupQueue } from './private-track-asset-cleanup.queue.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

@Injectable()
export class PrivateTrackDeletionService {
  private readonly logger = new Logger(PrivateTrackDeletionService.name);

  constructor(
    private readonly repository: PrivateTracksRepository,
    private readonly storage: StorageService,
    private readonly cleanup: PrivateTrackAssetCleanupQueue,
  ) {}

  async delete(userId: string, privateTrackId: string): Promise<void> {
    const existing = await this.repository.findOwned(userId, privateTrackId);
    if (!existing) {
      throw new AppException('NOT_FOUND', 'Private track not found');
    }
    const prefix = `private-tracks/${userId}/${privateTrackId}/`;
    await this.cleanup.schedulePrefixCleanup({
      userId,
      privateTrackId,
      prefix,
      sourceKey: existing.objectKey,
      delayMs: PRIVATE_TRACK_UPLOAD_URL_TTL_MS,
    });
    await this.repository.delete(userId, privateTrackId);
    try {
      await Promise.all([
        this.storage.deletePrivateObject(existing.objectKey),
        this.storage.deletePrivateObjectsWithPrefix(prefix),
        this.storage.deletePrivateObjectsWithPrefix(
          `private-track-derivatives/${userId}/${privateTrackId}/`,
        ),
      ]);
    } catch (error) {
      this.logger.warn(
        `Private track cleanup will retry for ${privateTrackId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
