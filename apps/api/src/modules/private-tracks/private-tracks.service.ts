import { basename } from 'node:path';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { MyPrivateTracks, PrivateTrack } from '@vozzify/contracts';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

type Upload = { path: string; originalname: string };

@Injectable()
export class PrivateTracksService {
  constructor(
    private readonly repository: PrivateTracksRepository,
    private readonly audio: PrivateAudioInspector,
    private readonly storage: StorageService,
    private readonly membership: SubscriptionMembershipService,
  ) {}

  async list(userId: string): Promise<MyPrivateTracks> {
    const [canSubmit, rows] = await Promise.all([
      this.membership.hasPaidMembership(userId),
      this.repository.list(userId),
    ]);
    return { canSubmit, tracks: rows.map(toPrivateTrack) };
  }

  async submit(userId: string, file: Upload): Promise<PrivateTrack> {
    if (!(await this.membership.hasPaidMembership(userId))) {
      throw new ForbiddenException(
        'A Pro membership is required to upload audio',
      );
    }
    const [metadata, contentSha256] = await Promise.all([
      this.audio.inspect(file.path),
      this.audio.hash(file.path),
    ]);
    const filename = basename(file.originalname.replaceAll('\\', '/'));
    const title = metadata.title || filename;
    const objectKey = `${userId}/${contentSha256}`;
    await this.storage.putPrivateFile({
      key: objectKey,
      filePath: file.path,
      contentType: 'application/octet-stream',
    });
    const row = await this.repository.save({
      userId,
      contentSha256,
      objectKey,
      originalFilename: filename,
      title,
      artist: metadata.artist,
      durationMs: metadata.durationMs,
    });
    return toPrivateTrack(row);
  }
}

const toPrivateTrack = (row: {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  createdAt: Date;
}): PrivateTrack => ({
  id: row.id,
  title: row.title,
  artist: row.artist,
  durationMs: row.durationMs,
  createdAt: row.createdAt.toISOString(),
});
