import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { HomeRow, Locale } from '@vozzify/contracts';
import { AttemptsService } from '../attempts/attempts.service.js';
import { StreaksService } from '../streaks/streaks.service.js';
import { UsersService } from '../users/users.service.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import { isMasteredTrack, personalLambda } from './home-personal.js';
import {
  PersonalHomeRepository,
  type UserTrackSignal,
} from './home-personal.repository.js';
import type { UserTasteActivity } from './home-personal.repository.types.js';
import { tasteSignalsOf } from './home-personal-activity.js';
import { buildPersonalVoiceAndDiscoveryRows } from './home-personal-candidate-rows.js';
import {
  buildPersonalExplorationRow,
  composePersonalHomeRows,
  requirePersonalTasteRows,
  reservedChartTrackIds,
} from './home-personal-composition.js';
import { dailyTargetRow } from './home-personal-daily-target.js';
import {
  decayedSignalCount,
  decayedTaste,
  type TasteSignal,
} from './home-personal-recommendations.js';
import { resumeRows, trackIdsOfRow } from './home-personal-resume-rows.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { personalTrackPool } from './home-personal-voice.js';
import { DEFAULT_HOME_LOCALE, HOME_ALGORITHM_VERSION } from './home-rules.js';
import { HomeSocialService } from './home-social.service.js';

const versionOf = (userId: string, locale: Locale, rows: HomeRow[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        audience: 'personal',
        algorithmVersion: HOME_ALGORITHM_VERSION,
        userId,
        locale,
        rows,
      }),
    )
    .digest('hex')
    .slice(0, 16);

const withRows = (trackIds: ReadonlySet<string>, rows: HomeRow[]) =>
  new Set([...trackIds, ...rows.flatMap(trackIdsOfRow)]);

/**
 * Builds one User's personal feed. The public feed is the base: its Tracks
 * are re-ranked by the blend of their normalized popularity with the User's
 * taste, mastered Tracks are filtered out of the discovery rows, and the
 * resume rows and the daily target strip lead. A User with no data gets the
 * public rows (λ = 0 keeps their order) plus the strip.
 */
@Injectable()
export class PersonalHomeBuilder {
  @Optional()
  @Inject(AttemptsService)
  private readonly attempts?: AttemptsService;

  @Inject(PersonalHomeTasteRowsService)
  private readonly tasteRows: PersonalHomeTasteRowsService | undefined;

  @Optional()
  @Inject(HomeSocialService)
  private readonly social?: HomeSocialService;

  constructor(
    private readonly feeds: HomeFeedService,
    private readonly personal: PersonalHomeRepository,
    private readonly streaks: StreaksService,
    private readonly users: UsersService,
  ) {}

  async build(
    userId: string,
    locale: Locale = DEFAULT_HOME_LOCALE,
  ): Promise<StoredPersonalHomeFeed> {
    const [{ feed }, signals, favorites, settings, userRange] =
      await Promise.all([
        this.feeds.currentPublic(locale),
        this.personal.findUserTrackSignals(userId),
        this.personal.findUserFavoriteSignals(userId),
        this.users.getPracticeSettings(userId),
        this.attempts?.vocalRange(userId) ?? Promise.resolve(null),
      ]);
    const activities = await requirePersonalTasteRows(
      this.tasteRows,
    ).findUserTasteActivities(userId);
    const socialRows = await (this.social?.rowsFor(userId) ??
      Promise.resolve([]));
    const rows = await this.buildRows({
      userId,
      publicRows: feed.rows,
      signals,
      favorites,
      activities,
      socialRows,
      timeZone: settings.timeZone,
      userRange,
    });
    return this.linkArtistPages({
      audience: 'personal',
      locale,
      version: versionOf(userId, locale, rows),
      algorithmVersion: HOME_ALGORITHM_VERSION,
      rows,
      generatedAt: new Date().toISOString(),
    });
  }

  private async buildRows(options: {
    userId: string;
    publicRows: HomeRow[];
    signals: UserTrackSignal[];
    favorites: Awaited<
      ReturnType<PersonalHomeRepository['findUserFavoriteSignals']>
    >;
    activities: UserTasteActivity[];
    socialRows: HomeRow[];
    timeZone: string | null;
    userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  }): Promise<HomeRow[]> {
    const {
      userId,
      publicRows,
      signals,
      favorites,
      activities,
      socialRows,
      timeZone,
      userRange,
    } = options;
    const tasteSignals = tasteSignalsOf(activities, favorites);
    const taste = decayedTaste(tasteSignals);
    const signalCount = decayedSignalCount(tasteSignals);
    const lambda = personalLambda(signalCount);
    const mastered = new Set(
      signals
        .filter((signal) => isMasteredTrack(signal.bestAccuracy))
        .map((signal) => signal.trackId),
    );
    const resumes = resumeRows(signals, mastered);
    const dailyTarget = await dailyTargetRow(this.streaks, userId, timeZone);
    const recommendations = await this.recommendationRows({
      userId,
      publicRows,
      signals,
      tasteSignals,
      taste,
      lambda,
      mastered,
      leadingRows: [...resumes, ...socialRows],
      userRange,
    });
    return composePersonalHomeRows({
      hero: recommendations.find((row) => row.layout === 'hero'),
      dailyTarget,
      resumes,
      socialRows,
      publicRows,
      recommendations,
    });
  }

  private async recommendationRows(options: {
    userId: string;
    publicRows: HomeRow[];
    signals: UserTrackSignal[];
    tasteSignals: TasteSignal[];
    taste: ReturnType<typeof decayedTaste>;
    lambda: number;
    mastered: ReadonlySet<string>;
    leadingRows: HomeRow[];
    userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  }): Promise<HomeRow[]> {
    const {
      userId,
      publicRows,
      signals,
      tasteSignals,
      taste,
      lambda,
      mastered,
      leadingRows,
      userRange,
    } = options;
    const reservedTrackIds = reservedChartTrackIds(publicRows);
    const usedTrackIds = new Set([
      ...leadingRows.flatMap(trackIdsOfRow),
      ...reservedTrackIds,
    ]);
    const tasteRows = await this.buildTasteRows({
      userId,
      signals,
      tasteSignals,
      taste,
      mastered,
      usedTrackIds,
      publicRows,
    });
    const { voiceRows, discoveryRows } = await this.voiceAndDiscoveryRows({
      publicRows,
      taste,
      lambda,
      mastered,
      userRange,
      usedTrackIds,
      reservedTrackIds,
    });
    const finalUsedTrackIds = withRows(usedTrackIds, discoveryRows);
    const exploration = await buildPersonalExplorationRow(this.tasteRows, {
      taste,
      tasteSignals,
      mastered,
      usedTrackIds: finalUsedTrackIds,
      visibleTrackSlots: [
        ...leadingRows,
        ...tasteRows,
        ...voiceRows,
        ...discoveryRows,
      ].flatMap(trackIdsOfRow).length,
    });
    return [
      ...tasteRows,
      ...voiceRows,
      ...(exploration ? [exploration] : []),
      ...discoveryRows,
    ];
  }

  private async buildTasteRows(options: {
    userId: string;
    signals: UserTrackSignal[];
    tasteSignals: TasteSignal[];
    taste: ReturnType<typeof decayedTaste>;
    mastered: ReadonlySet<string>;
    usedTrackIds: Set<string>;
    publicRows: HomeRow[];
  }): Promise<HomeRow[]> {
    return requirePersonalTasteRows(this.tasteRows).build(options);
  }

  private async findDiscoveryTracks(publicRows: HomeRow[]) {
    const pool = personalTrackPool(publicRows);
    return this.personal.findDiscoveryTracks([
      ...new Set(pool.map((track) => track.id)),
    ]);
  }

  private async voiceAndDiscoveryRows(options: {
    publicRows: HomeRow[];
    taste: ReturnType<typeof decayedTaste>;
    lambda: number;
    mastered: ReadonlySet<string>;
    userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
    usedTrackIds: Set<string>;
    reservedTrackIds: ReadonlySet<string>;
  }) {
    const discovery = await this.findDiscoveryTracks(options.publicRows);
    return buildPersonalVoiceAndDiscoveryRows({
      publicRows: options.publicRows,
      discovery,
      taste: options.taste,
      lambda: options.lambda,
      mastered: options.mastered,
      userRange: options.userRange,
      usedTrackIds: options.usedTrackIds,
      reservedTrackIds: options.reservedTrackIds,
    });
  }

  @Transactional()
  async refreshCommunityCooccurrence(): Promise<void> {
    await this.personal.refreshCommunityCooccurrence();
  }

  private async linkArtistPages(
    feed: StoredPersonalHomeFeed,
  ): Promise<StoredPersonalHomeFeed> {
    if (!this.feeds.withArtistLinks) return feed;
    return { ...feed, rows: await this.feeds.withArtistLinks(feed.rows) };
  }
}
