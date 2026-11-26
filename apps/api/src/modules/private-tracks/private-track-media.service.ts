import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import {
  type ByteRange,
  parsePrivateTrackByteRange,
} from './private-track-byte-range.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

export type PreparedPrivateAudio = {
  body: Readable | null;
  size: number;
  range: ByteRange | null;
  invalidRange: boolean;
};

@Injectable()
export class PrivateTrackMediaService {
  constructor(
    private readonly tracks: PrivateTracksRepository,
    private readonly membership: SubscriptionMembershipService,
    private readonly storage: StorageService,
  ) {}

  async prepareAudio(
    userId: string,
    privateTrackId: string,
    kind: 'music' | 'vocals',
    rangeHeader: string | undefined,
  ): Promise<PreparedPrivateAudio> {
    const track = await this.tracks.findOwned(userId, privateTrackId);
    if (!track) throw new AppException('NOT_FOUND', 'Private track not found');
    if (!(await this.membership.hasPaidMembership(userId))) {
      throw new AppException('FORBIDDEN', 'A Pro membership is required');
    }
    const objectKey =
      kind === 'music' ? track.mediaObjectKey : track.vocalsObjectKey;
    if (track.processingStatus !== 'COMPLETED' || !objectKey) {
      throw new AppException('NOT_FOUND', 'Private audio is not available');
    }

    const { size } = await this.storage.headPrivateObject(objectKey);
    const range = parsePrivateTrackByteRange(rangeHeader, size);
    if (range === 'invalid') {
      return { body: null, size, range: null, invalidRange: true };
    }
    const s3Range = range ? `bytes=${range.start}-${range.end}` : undefined;
    const body = await this.storage.getPrivateObject(objectKey, s3Range);
    return { body, size, range, invalidRange: false };
  }
}
