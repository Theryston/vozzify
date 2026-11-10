import { Injectable } from '@nestjs/common';
import type {
  HomeArtist,
  HomeArtistsRow,
  HomeRow,
  HomeRowTitle,
  HomeTrack,
  TrackVocalRange,
} from '@vozzify/contracts';
import { AttemptsService } from '../attempts/attempts.service.js';
import type { MostSungArtistActivity } from '../attempts/profile-chips-ranking.js';
import type { PersonalTaste } from './home-personal.js';
import {
  PersonalHomeRepository,
  type UserTrackSignal,
} from './home-personal.repository.js';
import type { UserTasteActivity } from './home-personal.repository.types.js';
import {
  loadExplorationCandidates,
  loadGenreTasteCandidates,
  loadPersonalDiscoveryCandidates,
} from './home-personal-discovery-candidates.js';
import {
  decayedSignalCount,
  explorationSlotCount,
  rankTasteArtists,
  type TasteSignal,
  tasteMatch,
  topGenres,
} from './home-personal-recommendations.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import {
  artistKeyOf,
  composeTasteTrackRow,
  homeTrackOf,
} from './home-personal-taste-track-rows.js';
import {
  HOME_RECOMMENDATION_ROW_MIN_ITEMS,
  HOME_ROW_RULES,
  HOME_TRACK_PAGE_SIZE,
} from './home-rules.js';

const MIN_TASTE_SIGNALS = 3;
const CO_OCCURRENCE_SOURCE_LIMIT = 12;

const title = (key: string): HomeRowTitle => ({ key, params: {} });

@Injectable()
export class PersonalHomeTasteRowsService {
  constructor(
    private readonly personal: PersonalHomeRepository,
    private readonly tasteRepository: PersonalHomeTasteRepository,
    private readonly attempts: AttemptsService,
  ) {}

  findUserTasteActivities(userId: string): Promise<UserTasteActivity[]> {
    return this.tasteRepository.findUserTasteActivities(userId);
  }

  async findDiscoveryCandidates(
    taste: PersonalTaste,
    options: {
      excludedTrackIds: ReadonlySet<string>;
      userRange?: TrackVocalRange | null;
      expandRecommendationRows?: boolean;
    } = {
      excludedTrackIds: new Set(),
    },
  ): Promise<{
    tracks: HomeTrack[];
    byRow: Record<string, HomeTrack[]>;
  }> {
    const { popular, matched, newest, mostSung, voice } =
      await loadPersonalDiscoveryCandidates({
        personal: this.personal,
        tasteRepository: this.tasteRepository,
        taste,
        excludedTrackIds: [...options.excludedTrackIds],
        userRange: options.userRange,
        expanded: options.expandRecommendationRows,
      });
    const byRow = {
      'trending-today': popular.map(homeTrackOf),
      'most-sung': mostSung.map(homeTrackOf),
      'new-tracks': newest.map(homeTrackOf),
      'more-of-your-genres': matched.map(homeTrackOf),
      'within-your-voice': voice.map(homeTrackOf),
      'challenge-your-range': voice.map(homeTrackOf),
    };
    const unique = new Map(
      [...popular, ...matched, ...newest, ...mostSung, ...voice].map(
        (track) => [track.id, track],
      ),
    );
    return {
      tracks: [...unique.values()].map(homeTrackOf),
      byRow,
    };
  }

  async build(options: {
    userId: string;
    signals: UserTrackSignal[];
    tasteSignals: TasteSignal[];
    taste: PersonalTaste;
    mastered: ReadonlySet<string>;
    usedTrackIds: Set<string>;
    publicRows: HomeRow[];
    sourcePoolsByRow?: Record<string, HomeTrack[]>;
  }): Promise<HomeRow[]> {
    if (decayedSignalCount(options.tasteSignals) < MIN_TASTE_SIGNALS) {
      return [];
    }
    const rows: HomeRow[] = [];
    const cooccurrence = await this.becauseYouSangRow(options);
    if (cooccurrence) rows.push(cooccurrence);
    this.reserveRows([cooccurrence], options.usedTrackIds);

    const genres = await this.genreTasteRow(options);
    if (genres) rows.push(genres);
    this.reserveRows([genres], options.usedTrackIds);

    const artists = await this.mostSungArtistsRow(options.userId);
    if (artists) rows.push(artists);
    return rows;
  }

  private reserveRows(
    rows: (HomeRow | undefined)[],
    usedTrackIds: Set<string>,
  ): void {
    for (const row of rows) {
      if (!row) continue;
      for (const id of trackIdsOfRow(row)) usedTrackIds.add(id);
    }
  }

  async explorationRow(options: {
    taste: PersonalTaste;
    tasteSignals: TasteSignal[];
    mastered: ReadonlySet<string>;
    usedTrackIds: ReadonlySet<string>;
    sourcePoolsByRow?: Record<string, HomeTrack[]>;
    visibleTrackSlots: number;
  }): Promise<HomeRow | undefined> {
    if (decayedSignalCount(options.tasteSignals) < MIN_TASTE_SIGNALS) {
      return undefined;
    }
    return this.buildExplorationRow(options);
  }

  private async becauseYouSangRow(options: {
    userId: string;
    signals: UserTrackSignal[];
    mastered: ReadonlySet<string>;
    usedTrackIds: ReadonlySet<string>;
    sourcePoolsByRow?: Record<string, HomeTrack[]>;
  }): Promise<HomeRow | undefined> {
    const sources = await this.personal.findUserSungTrackSources(
      options.userId,
      CO_OCCURRENCE_SOURCE_LIMIT,
    );
    if (sources.length === 0) return undefined;
    const pairs = await this.personal.findCommunityCooccurrence(
      sources.map((source) => source.trackId),
    );
    if (pairs.length === 0) return undefined;
    const grouped = new Map<string, typeof pairs>();
    for (const pair of pairs) {
      const current = grouped.get(pair.sourceTrackId) ?? [];
      current.push(pair);
      grouped.set(pair.sourceTrackId, current);
    }
    const targetIds = [...grouped.values()].flatMap((pairs) =>
      pairs.map((pair) => pair.targetTrackId),
    );
    const cards = await this.personal.findCommunityTrackCards(targetIds);
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    for (const source of sources) {
      const signal = options.signals.find(
        (candidate) => candidate.trackId === source.trackId,
      );
      if (!signal) continue;
      const rankedIds = (grouped.get(source.trackId) ?? [])
        .sort(
          (a, b) =>
            b.score - a.score ||
            (b.singers ?? 0) - (a.singers ?? 0) ||
            a.targetTrackId.localeCompare(b.targetTrackId),
        )
        .map((pair) => pair.targetTrackId);
      const row = composeTasteTrackRow({
        id: 'because-you-sang',
        title: {
          key: 'home.rows.becauseYouSang',
          params: { trackTitle: signal.title },
        },
        cards: rankedIds.flatMap((id) => {
          const card = cardsById.get(id);
          return card ? [card] : [];
        }),
        mastered: options.mastered,
        used: options.usedTrackIds,
        sourcePoolsByRow: options.sourcePoolsByRow,
      });
      if (row) return row;
    }
    return undefined;
  }

  private async genreTasteRow(options: {
    taste: PersonalTaste;
    mastered: ReadonlySet<string>;
    usedTrackIds: ReadonlySet<string>;
    sourcePoolsByRow?: Record<string, HomeTrack[]>;
  }): Promise<HomeRow | undefined> {
    const genres = topGenres(options.taste);
    const excludedTrackIds = [
      ...new Set([...options.mastered, ...options.usedTrackIds]),
    ];
    const cards = await loadGenreTasteCandidates(
      this.tasteRepository,
      genres,
      excludedTrackIds,
      options.sourcePoolsByRow !== undefined,
    );
    return composeTasteTrackRow({
      id: 'more-of-your-genres',
      title: title('home.rows.moreOfYourGenres'),
      cards: cards.sort(
        (a, b) =>
          tasteMatch(b.genres, artistKeyOf(b), options.taste) -
            tasteMatch(a.genres, artistKeyOf(a), options.taste) ||
          b.trendingScore - a.trendingScore ||
          a.id.localeCompare(b.id),
      ),
      taste: options.taste,
      mastered: options.mastered,
      used: options.usedTrackIds,
      sourcePoolsByRow: options.sourcePoolsByRow,
    });
  }

  private async mostSungArtistsRow(
    userId: string,
  ): Promise<HomeRow | undefined> {
    const activities: MostSungArtistActivity[] =
      await this.attempts.mostSungArtistActivities(userId);
    const artists = rankTasteArtists(
      activities.map((activity) => ({
        artistId: activity.artist.id,
        name: activity.artist.name,
        attempts: 1,
        lastAttemptAt: activity.lastAttemptAt,
      })),
    ).slice(0, HOME_ROW_RULES.artists.maxItems);
    if (artists.length < HOME_ROW_RULES.artists.minItems) return undefined;
    return {
      id: 'your-most-sung-artists',
      layout: 'artists',
      title: title('home.rows.yourMostSungArtists'),
      items: artists.map(
        (artist): HomeArtist => ({
          id: artist.artistId,
          name: artist.name,
        }),
      ),
    } satisfies HomeArtistsRow;
  }

  private async buildExplorationRow(options: {
    taste: PersonalTaste;
    mastered: ReadonlySet<string>;
    usedTrackIds: ReadonlySet<string>;
    sourcePoolsByRow?: Record<string, HomeTrack[]>;
    visibleTrackSlots: number;
  }): Promise<HomeRow | undefined> {
    const slots = Math.min(
      HOME_TRACK_PAGE_SIZE,
      explorationSlotCount(options.visibleTrackSlots),
    );
    if (slots < HOME_RECOMMENDATION_ROW_MIN_ITEMS) return undefined;
    const candidates = await loadExplorationCandidates(this.personal, {
      taste: options.taste,
      excludedTrackIds: [...options.mastered, ...options.usedTrackIds],
      expanded: options.sourcePoolsByRow !== undefined,
    });
    const unfamiliar = candidates.filter(
      (candidate) =>
        tasteMatch(candidate.genres, artistKeyOf(candidate), options.taste) ===
          0 &&
        !options.mastered.has(candidate.id) &&
        !options.usedTrackIds.has(candidate.id),
    );
    if (options.sourcePoolsByRow)
      options.sourcePoolsByRow.explore = unfamiliar.map(homeTrackOf);
    const row = composeTasteTrackRow({
      id: 'explore',
      title: title('home.rows.explore'),
      cards: unfamiliar.slice(0, slots),
      mastered: options.mastered,
      used: options.usedTrackIds,
    });
    return row;
  }
}
