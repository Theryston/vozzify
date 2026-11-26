import { Injectable } from '@nestjs/common';
import type {
  PrivateTrackDetail,
  UpdatePrivateTrackMetadataBody,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateTrackMetadataRepository } from './private-track-metadata.repository.js';
import { PrivateTrackRecordingService } from './private-track-recording.service.js';
import { PrivateTracksService } from './private-tracks.service.js';

@Injectable()
export class PrivateTrackMetadataService {
  constructor(
    private readonly tracks: PrivateTrackMetadataRepository,
    private readonly details: PrivateTracksService,
    private readonly membership: SubscriptionMembershipService,
    private readonly recordings: PrivateTrackRecordingService,
  ) {}

  async update(
    userId: string,
    privateTrackId: string,
    body: UpdatePrivateTrackMetadataBody,
  ): Promise<PrivateTrackDetail> {
    if (!(await this.tracks.isOwner(userId, privateTrackId))) {
      throw new AppException('NOT_FOUND', 'Private track not found');
    }
    if (!(await this.membership.hasPaidMembership(userId))) {
      throw new AppException(
        'FORBIDDEN',
        'A Pro membership is required to edit a private track',
      );
    }
    const recordingLink = await this.resolveLink(body.recordingMbid);
    const saved = await this.tracks.saveOwnerMetadata(userId, privateTrackId, {
      titleOverride: body.title,
      artistOverride: body.artist,
      recordingLink,
    });
    if (!saved) throw new AppException('NOT_FOUND', 'Private track not found');
    return this.details.getDetail(userId, privateTrackId);
  }

  private async resolveLink(
    mbid: UpdatePrivateTrackMetadataBody['recordingMbid'],
  ) {
    if (mbid === undefined) return undefined;
    if (mbid === null) return { kind: 'unlinked' } as const;
    const found = await this.recordings.lookup(mbid);
    if (!found) throw new AppException('NOT_FOUND', 'Recording not found');
    return { kind: 'linked', recording: found.recording } as const;
  }
}
