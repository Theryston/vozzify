import { basename } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type {
  MyPrivateTracksPage,
  MyPrivateTracksQuery,
  PrivateTrack,
  PrivateTrackDetail,
} from '@vozzify/contracts';
import {
  decodeTupleCursor,
  encodeTupleCursor,
} from '../../common/cursor/tuple-cursor.js';
import { AppException } from '../../common/errors/app-exception.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PRIVATE_TRACK_UPLOAD_URL_TTL_MS } from './private-track-asset-cleanup.job.js';
import { PrivateTrackAssetCleanupQueue } from './private-track-asset-cleanup.queue.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

type Upload = { path: string; originalname: string };

@Injectable()
export class PrivateTracksService {
  private readonly logger = new Logger(PrivateTracksService.name);
  @Inject(PrivateTrackAssetCleanupQueue)
  private cleanup: PrivateTrackAssetCleanupQueue | undefined;

  constructor(
    private readonly repository: PrivateTracksRepository,
    private readonly audio: PrivateAudioInspector,
    private readonly storage: StorageService,
    private readonly membership: SubscriptionMembershipService,
  ) {}

  async listPage(
    userId: string,
    query: MyPrivateTracksQuery,
  ): Promise<MyPrivateTracksPage> {
    const [canSubmit, rows] = await Promise.all([
      this.membership.hasPaidMembership(userId),
      this.repository.listPage(userId, {
        after: query.cursor
          ? decodePrivateTrackCursor(query.cursor)
          : undefined,
        limit: query.limit,
      }),
    ]);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      canSubmit,
      items: page.map(toPrivateTrack),
      nextCursor:
        hasMore && last
          ? encodeTupleCursor([last.createdAt.toISOString(), last.id])
          : null,
    };
  }

  async getDetail(userId: string, id: string): Promise<PrivateTrackDetail> {
    const row = await this.repository.findOwned(userId, id);
    if (!row) throw new AppException('NOT_FOUND', 'Private track not found');
    const canPractice = await this.membership.hasPaidMembership(userId);
    const notes =
      canPractice && row.processingStatus === 'COMPLETED'
        ? await this.repository.listNotes(row.id)
        : [];
    return {
      ...toPrivateTrack(row),
      ownerId: row.userId,
      processing: {
        status: toProcessingStatus(row.processingStatus),
        progress: row.processingProgress,
      },
      locked: !canPractice,
      notes,
    };
  }

  async submit(userId: string, file: Upload): Promise<PrivateTrack> {
    if (!(await this.membership.hasPaidMembership(userId))) {
      throw new AppException(
        'FORBIDDEN',
        'A Pro membership is required to upload audio',
      );
    }
    const [metadata, contentSha256] = await Promise.all([
      this.audio.inspect(file.path),
      this.audio.hash(file.path),
    ]);
    const filename = basename(file.originalname.replaceAll('\\', '/'));
    const title = metadata.title || filename;
    const privateTrackId = createId();
    const objectKey = `private-tracks/${userId}/${privateTrackId}/source`;
    await this.storage.putPrivateFile({
      key: objectKey,
      filePath: file.path,
      contentType: 'application/octet-stream',
    });
    await this.scheduleCandidateCleanup(objectKey, privateTrackId);
    const row = await this.repository.save({
      id: privateTrackId,
      userId,
      contentSha256,
      objectKey,
      originalFilename: filename,
      title,
      artist: metadata.artist,
      durationMs: metadata.durationMs,
    });
    if (row.discardedUploadKey) {
      await this.removeDiscardedUpload(row.discardedUploadKey, privateTrackId);
    }
    return toPrivateTrack(row);
  }

  private async scheduleCandidateCleanup(
    objectKey: string,
    privateTrackId: string,
  ): Promise<void> {
    if (!this.cleanup) return;
    try {
      await this.cleanup.schedulePrivateObjectCleanup(
        objectKey,
        PRIVATE_TRACK_UPLOAD_URL_TTL_MS,
      );
    } catch (error) {
      await this.storage
        .deletePrivateObject(objectKey)
        .catch((cleanupError: unknown) => {
          this.logger.warn(
            `Could not remove an unassociated private source ${privateTrackId}`,
            cleanupError instanceof Error
              ? cleanupError.stack
              : String(cleanupError),
          );
        });
      throw error;
    }
  }

  private async removeDiscardedUpload(
    objectKey: string,
    privateTrackId: string,
  ): Promise<void> {
    try {
      await this.storage.deletePrivateObject(objectKey);
    } catch (error) {
      this.logger.warn(
        `Deferred cleanup will remove duplicate private source ${privateTrackId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

const decodePrivateTrackCursor = (cursor: string) => {
  const [createdAt, id] = decodeTupleCursor(cursor);
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== createdAt) {
    throw new AppException('VALIDATION_FAILED', 'Invalid cursor');
  }
  return { createdAt: date, id };
};

const toPrivateTrack = (row: {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  createdAt: Date;
  processingStatus?: string;
  processingProgress?: number;
}): PrivateTrack => ({
  id: row.id,
  title: row.title,
  artist: row.artist,
  durationMs: row.durationMs,
  createdAt: row.createdAt.toISOString(),
  ...(row.processingStatus === undefined
    ? {}
    : {
        processing: {
          status: toProcessingStatus(row.processingStatus),
          progress: row.processingProgress ?? 0,
        },
      }),
});

const toProcessingStatus = (
  status: string,
): PrivateTrackDetail['processing']['status'] => {
  if (
    status === 'EXTRACTING_VOCALS' ||
    status === 'DETECTING_NOTES' ||
    status === 'COMPLETED' ||
    status === 'FAILED'
  ) {
    return status;
  }
  return 'QUEUED';
};
