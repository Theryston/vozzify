import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type {
  MyPrivateTracksPage,
  MyPrivateTracksQuery,
  PrivateTrack,
  PrivateTrackDetail,
  PrivateTrackProcessingState,
} from '@vozzify/contracts';
import {
  decodeTupleCursor,
  encodeTupleCursor,
} from '../../common/cursor/tuple-cursor.js';
import { AppException } from '../../common/errors/app-exception.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateAudioInspector } from './private-audio.js';
import {
  displayPrivateTrack,
  type PrivateTrackDisplaySource,
} from './private-track-display-metadata.js';
import { privateTrackMediaKey } from './private-track-object-keys.js';
import type { PrivateTrackSourceStoragePort } from './private-track-source-storage.js';
import { PrivateTrackSourceStorage } from './private-track-source-storage.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

type Upload = { path: string; originalname: string };

@Injectable()
export class PrivateTracksService {
  private readonly logger = new Logger(PrivateTracksService.name);

  constructor(
    private readonly repository: PrivateTracksRepository,
    private readonly audio: PrivateAudioInspector,
    @Inject(PrivateTrackSourceStorage)
    private readonly storage: PrivateTrackSourceStoragePort,
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
    const { recording } = displayPrivateTrack(row);
    return {
      ...toPrivateTrack(row),
      ownerId: row.userId,
      processing: processingOf(row),
      locked: !canPractice,
      ...(canPractice && row.youtubeVideoId
        ? { youtubeVideoId: row.youtubeVideoId }
        : {}),
      ...(canPractice && recording ? { recording } : {}),
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
    const mediaObjectKey = metadata.hasVideo
      ? privateTrackMediaKey(userId, privateTrackId)
      : null;
    const objectKey =
      mediaObjectKey ?? `private-tracks/${userId}/${privateTrackId}/source`;
    await this.storeSource(file.path, objectKey, metadata.hasVideo === true);
    const row = await this.repository.save({
      id: privateTrackId,
      userId,
      contentSha256,
      objectKey,
      ...(mediaObjectKey && { mediaObjectKey }),
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

  async prepareRetry(
    userId: string,
    id: string,
  ): Promise<{ processing: PrivateTrackProcessingState; retryId?: string }> {
    const track = await this.repository.findOwned(userId, id);
    if (!track) throw new AppException('NOT_FOUND', 'Private track not found');
    if (!(await this.membership.hasPaidMembership(userId))) {
      throw new AppException(
        'FORBIDDEN',
        'A Pro membership is required to retry private track processing',
      );
    }
    if (track.processingStatus !== 'FAILED') {
      return { processing: processingOf(track) };
    }
    const retryId = randomUUID();
    const updated = await this.repository.resetFailedProcessing({
      userId,
      id,
      previousRetryId: track.processingRetryId,
      retryId,
    });
    if (updated) {
      return { processing: { status: 'QUEUED', progress: 0 }, retryId };
    }
    const current = await this.repository.findOwned(userId, id);
    if (!current)
      throw new AppException('NOT_FOUND', 'Private track not found');
    return { processing: processingOf(current) };
  }

  private async storeSource(
    filePath: string,
    objectKey: string,
    hasVideo: boolean,
  ): Promise<void> {
    if (!hasVideo) {
      await this.storage.putPrivateFile({
        key: objectKey,
        filePath,
        contentType: 'application/octet-stream',
      });
      return;
    }

    const directory = await mkdtemp(join(tmpdir(), 'vozzify-private-video-'));
    const wavPath = join(directory, 'music.wav');
    try {
      // The detector-ready WAV is the only retained source for a video.
      await this.audio.extractVideoAudio(filePath, wavPath);
      await this.storage.putPrivateFile({
        key: objectKey,
        filePath: wavPath,
        contentType: 'audio/wav',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
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

function processingOf(row: {
  processingStatus: string;
  processingProgress: number;
}): PrivateTrackProcessingState {
  return {
    status: toProcessingStatus(row.processingStatus),
    progress: row.processingProgress,
  };
}

export const toPrivateTrack = (
  row: PrivateTrackDisplaySource & {
    id: string;
    durationMs: number;
    createdAt: Date;
    processingStatus?: string;
    processingProgress?: number;
  },
): PrivateTrack => {
  const { title, artist } = displayPrivateTrack(row);
  return {
    id: row.id,
    title,
    artist,
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
  };
};

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
