import { Injectable } from '@nestjs/common';
import { type TrackHeader, trackHeaderSchema } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import {
  displayPrivateTrack,
  type PrivateTrackDisplaySource,
} from './private-track-display-metadata.js';
import { PrivateTrackPracticeRepository } from './private-track-practice.repository.js';

@Injectable()
export class PrivateTrackPracticeAccessService {
  constructor(
    private readonly tracks: PrivateTrackPracticeRepository,
    private readonly membership: SubscriptionMembershipService,
  ) {}

  /** Must run in the practice write's transaction so deletion waits for it. */
  async assertCanPractice(userId: string, id: string): Promise<void> {
    const track = await this.tracks.lockOwned(userId, id);
    if (!track) throw new AppException('NOT_FOUND', 'Private track not found');
    if (!(await this.membership.hasPaidMembership(userId))) {
      throw new AppException('FORBIDDEN', 'A Pro membership is required');
    }
    if (track.processingStatus !== 'COMPLETED') {
      throw new AppException('NOT_FOUND', 'Private practice is not available');
    }
  }

  /** One owner-scoped metadata read per history page, including locked Tracks. */
  async listOwnedHistoryHeaders(
    userId: string,
    ids: string[],
  ): Promise<Map<string, TrackHeader>> {
    if (ids.length === 0) return new Map();
    const rows = await this.tracks.findOwnedForHistory(userId, [
      ...new Set(ids),
    ]);
    return new Map(rows.map((row) => [row.id, historyHeader(row)]));
  }
}

function historyHeader(
  track: PrivateTrackDisplaySource & { id: string },
): TrackHeader {
  const { title, artistCredit, coverUrl } = trackHeaderSchema.shape;
  const display = displayPrivateTrack(track);
  const artist = display.artist.slice(
    0,
    artistCredit.element.shape.name.maxLength ?? undefined,
  );
  const cover = coverUrl.safeParse(display.recording?.coverUrl ?? null);
  return {
    id: track.id,
    title: (display.title || track.id).slice(0, title.maxLength ?? undefined),
    artistCredit: artist ? [{ name: artist, joinPhrase: '' }] : [],
    coverUrl: cover.success ? cover.data : null,
  };
}
