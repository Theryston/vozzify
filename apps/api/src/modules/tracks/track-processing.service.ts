import { Injectable, Optional } from '@nestjs/common';
import type {
  ListTrackContributorsQuery,
  TrackContributorEntry,
  TrackContributorsPage,
  TrackProcessingState,
} from '@vozzify/contracts';
import {
  avatarIdentityFields,
  SubscriptionMembershipService,
} from '../plans/subscription-membership.service.js';
import { TrackContributorRepository } from './track-contributor.repository.js';
import {
  decodeTrackContributorCursor,
  encodeTrackContributorCursor,
} from './track-contributor-cursor.js';
import { throwMovedOrMissing } from './track-not-found.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { toTrackProcessing } from './track-processing-view.js';
import { TracksRepository } from './tracks.repository.js';

/**
 * Reads of a Track that its pages share: the state the Processing page shows
 * (the Track header, its latest Processing and its Contributors, which any
 * Track has from the moment it is requested), the Contributors, and the
 * `RESOURCE_MOVED` / `NOT_FOUND` answers for an ID that finds no Track.
 */
@Injectable()
export class TrackProcessingService {
  constructor(
    private readonly tracks: TracksRepository,
    private readonly processings: TrackProcessingRepository,
    private readonly contributors: TrackContributorRepository,
    @Optional() private readonly membership?: SubscriptionMembershipService,
  ) {}

  /**
   * A legacy Track ID answers `RESOURCE_MOVED` with its new ID, so the web
   * redirects; an unknown ID is a real `NOT_FOUND`. Reads never touch the Music
   * catalog.
   */
  async getProcessingState(trackId: string): Promise<TrackProcessingState> {
    const header = await this.tracks.findTrackHeader(trackId);
    if (header === undefined) {
      return this.throwMovedOrMissing(trackId);
    }
    const [latest, page] = await Promise.all([
      this.processings.findLatestProcessing(trackId),
      this.listContributors(trackId, { limit: 3 }),
    ]);
    return {
      track: header,
      processing: latest === undefined ? null : toTrackProcessing(latest),
      contributors: page.items,
      contributorCount: page.total,
    };
  }

  /**
   * One page of the Track's Contributors in first-contribution order, with the
   * total for the counter. `viewerId` (a signed-in viewer) adds whether they
   * follow each Contributor; without it the flag is left out. Unknown and
   * legacy IDs answer as every Track read does (`NOT_FOUND`, or
   * `RESOURCE_MOVED` with the new ID).
   */
  async listContributors(
    trackId: string,
    query: ListTrackContributorsQuery,
    viewerId?: string,
  ): Promise<TrackContributorsPage> {
    await this.assertTrackExists(trackId);
    const { rows, total } = await this.contributors.findContributorsPage(
      trackId,
      {
        cursor:
          query.cursor === undefined
            ? undefined
            : decodeTrackContributorCursor(query.cursor),
        limit: query.limit,
        query: query.q,
        viewerId,
      },
    );
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const paid = await this.membership?.paidMemberIds(
      page.map(({ userId }) => userId),
    );
    const items = page.map(
      (row): TrackContributorEntry => ({
        id: row.id,
        userId: row.userId,
        username: row.username,
        name: row.name,
        image: row.image,
        ...avatarIdentityFields(paid?.has(row.userId), row.avatarRole),
        ...(viewerId === undefined ? {} : { isFollowing: row.isFollowing }),
      }),
    );
    const anchor = hasMore ? rows[query.limit - 1] : undefined;
    return {
      items,
      nextCursor:
        anchor === undefined
          ? null
          : encodeTrackContributorCursor({
              contributedAt:
                anchor.cursorTimestamp ?? anchor.contributedAt.toISOString(),
              contributorId: anchor.id,
            }),
      total,
    };
  }

  /** How many Contributors the Track has, for the counter next to the pile. */
  async contributorCount(trackId: string): Promise<number> {
    await this.assertTrackExists(trackId);
    const { total } = await this.contributors.findContributorsPage(trackId, {
      limit: 1,
    });
    return total;
  }

  /**
   * Answers the same `RESOURCE_MOVED` or `NOT_FOUND` as the read, for a write
   * that needs the Track to exist (a retry).
   */
  async assertTrackExists(trackId: string): Promise<void> {
    const header = await this.tracks.findTrackHeader(trackId);
    if (header === undefined) {
      await this.throwMovedOrMissing(trackId);
    }
  }

  /** See {@link throwMovedOrMissing}. */
  throwMovedOrMissing(trackId: string): Promise<never> {
    return throwMovedOrMissing(this.tracks, trackId);
  }
}
