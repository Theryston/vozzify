import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  and,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  max,
  sql,
} from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { trackFavorites } from '../../database/schema/track-favorites.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import { tracks } from '../../database/schema/tracks.js';
import { users } from '../../database/schema/users.js';

type SocialProfileSignals = {
  id: string;
  username: string;
  name: string;
  image: string | null;
  practiceTrackIds: string[];
  favoriteTrackIds: string[];
  practiceLastActivityAt: Date | null;
  favoriteLastActivityAt: Date | null;
};

export type SocialSignals = {
  viewerPracticeTrackIds: string[];
  viewerFavoriteTrackIds: string[];
  profiles: SocialProfileSignals[];
};

type ProfileRecord = {
  id: string;
  username: string;
  name: string;
  image: string | null;
};

type TrackSignal = {
  userId: string;
  trackId: string;
  lastActivityAt: Date | null;
};

const MAX_SOCIAL_PROFILES = 500;
const uniqueFor = (
  rows: { userId: string; trackId: string }[],
  userId: string,
) => [
  ...new Set(
    rows.filter((row) => row.userId === userId).map((row) => row.trackId),
  ),
];

/** Reads a bounded batch of public users' practice and favorite Track sets. */
@Injectable()
export class HomeSocialRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async findSignals(viewerId: string): Promise<SocialSignals> {
    const [viewerPractice, viewerFavorites] = await Promise.all([
      this.findPracticeTracks([viewerId]),
      this.findFavoriteTracks([viewerId]),
    ]);
    const viewerTrackIds = [
      ...new Set([
        ...viewerPractice.map((row) => row.trackId),
        ...viewerFavorites.map((row) => row.trackId),
      ]),
    ];
    const profiles = await this.findProfiles(viewerId, viewerTrackIds);
    const profileIds = profiles.map((profile) => profile.id);
    const [profilePracticeRows, profileFavoriteRows] =
      profileIds.length > 0
        ? await Promise.all([
            this.findPracticeTracks(profileIds),
            this.findFavoriteTracks(profileIds),
          ])
        : [[], []];
    const practiceRows = [...viewerPractice, ...profilePracticeRows];
    const favoriteRows = [...viewerFavorites, ...profileFavoriteRows];
    return {
      viewerPracticeTrackIds: uniqueFor(practiceRows, viewerId),
      viewerFavoriteTrackIds: uniqueFor(favoriteRows, viewerId),
      profiles: profiles.map((profile) => ({
        ...profile,
        practiceTrackIds: uniqueFor(practiceRows, profile.id),
        favoriteTrackIds: uniqueFor(favoriteRows, profile.id),
        practiceLastActivityAt: latestActivityFor(
          profile.id,
          profilePracticeRows,
        ),
        favoriteLastActivityAt: latestActivityFor(
          profile.id,
          profileFavoriteRows,
        ),
      })),
    };
  }

  private async findProfiles(
    viewerId: string,
    viewerTrackIds: string[],
  ): Promise<ProfileRecord[]> {
    const profileIds = await this.findRelevantProfileIds(
      viewerId,
      viewerTrackIds,
    );
    if (profileIds.length === 0) return [];
    const publicUser = and(
      isNotNull(users.username),
      sql`${users.id} <> ${viewerId}`,
    );
    const rows = await this.txHost.tx
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        image: users.image,
      })
      .from(users)
      .where(and(publicUser, inArray(users.id, profileIds)))
      .orderBy(desc(users.updatedAt));
    return rows.filter(
      (profile): profile is typeof profile & { username: string } =>
        profile.username !== null,
    );
  }

  private async findRelevantProfileIds(
    viewerId: string,
    viewerTrackIds: string[],
  ): Promise<string[]> {
    if (viewerTrackIds.length === 0) return [];
    const publicUser = and(
      isNotNull(users.username),
      sql`${users.id} <> ${viewerId}`,
    );
    const practiceMatches = this.txHost.tx
      .select({
        userId: practiceAttempts.userId,
        trackId: practiceAttempts.trackId,
      })
      .from(practiceAttempts)
      .innerJoin(users, eq(users.id, practiceAttempts.userId))
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(
        and(
          publicUser,
          eq(users.showPracticeHistorySection, true),
          inArray(practiceAttempts.trackId, viewerTrackIds),
          hasCompletedProcessing(practiceAttempts.trackId),
        ),
      );
    const favoriteMatches = this.txHost.tx
      .select({
        userId: trackFavorites.userId,
        trackId: trackFavorites.trackId,
      })
      .from(trackFavorites)
      .innerJoin(users, eq(users.id, trackFavorites.userId))
      .where(
        and(
          publicUser,
          eq(users.showFavoritesSection, true),
          inArray(trackFavorites.trackId, viewerTrackIds),
          hasCompletedProcessing(trackFavorites.trackId),
        ),
      );
    const signals = practiceMatches.union(favoriteMatches).as('social_signals');
    const relevantProfiles = await this.txHost.tx
      .select({
        userId: signals.userId,
        commonTracks: countDistinct(signals.trackId),
      })
      .from(signals)
      .groupBy(signals.userId)
      .orderBy(desc(countDistinct(signals.trackId)))
      .limit(MAX_SOCIAL_PROFILES);
    return relevantProfiles.map((profile) => profile.userId);
  }

  private findPracticeTracks(ids: string[]): Promise<TrackSignal[]> {
    return this.txHost.tx
      .selectDistinct({
        userId: practiceAttempts.userId,
        trackId: practiceAttempts.trackId,
        lastActivityAt: max(practiceAttempts.createdAt),
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(
        and(
          inArray(practiceAttempts.userId, ids),
          hasCompletedProcessing(practiceAttempts.trackId),
        ),
      )
      .groupBy(practiceAttempts.userId, practiceAttempts.trackId);
  }

  private findFavoriteTracks(ids: string[]): Promise<TrackSignal[]> {
    return this.txHost.tx
      .selectDistinct({
        userId: trackFavorites.userId,
        trackId: trackFavorites.trackId,
        lastActivityAt: max(trackFavorites.createdAt),
      })
      .from(trackFavorites)
      .where(
        and(
          inArray(trackFavorites.userId, ids),
          hasCompletedProcessing(trackFavorites.trackId),
        ),
      )
      .groupBy(trackFavorites.userId, trackFavorites.trackId);
  }
}

const latestActivityFor = (userId: string, rows: TrackSignal[]): Date | null =>
  rows
    .filter((row) => row.userId === userId)
    .reduce<Date | null>(
      (latest, row) =>
        row.lastActivityAt !== null &&
        (latest === null || row.lastActivityAt > latest)
          ? row.lastActivityAt
          : latest,
      null,
    );
