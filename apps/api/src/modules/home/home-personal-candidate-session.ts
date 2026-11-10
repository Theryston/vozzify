import type { HomeRow, HomeTrack, TrackVocalRange } from '@vozzify/contracts';
import type { PersonalHomeRepository } from './home-personal.repository.js';
import type { PersonalTrackCandidate } from './home-personal.repository.types.js';
import { compactPersonalCandidates } from './home-personal-candidate-compaction.js';

type DiscoveryTrack =
  Awaited<
    ReturnType<PersonalHomeRepository['findDiscoveryTracks']>
  > extends Map<string, infer T>
    ? T
    : never;

import { explorationSlotCount } from './home-personal-recommendations.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import {
  HOME_MAX_ROWS,
  HOME_TRACK_ROW_MAX_ITEMS,
  PERSONAL_CANDIDATE_BATCH_SIZE,
} from './home-rules.js';

const SOURCE_ROWS: Readonly<Record<string, string[]>> = {
  popular: ['trending-today', 'recommended-for-you'],
  genres: ['recommended-for-you'],
  newest: ['new-tracks', 'recommended-for-you'],
  singing: ['most-sung', 'recommended-for-you'],
  voice: ['within-your-voice', 'challenge-your-range', 'recommended-for-you'],
  exploration: ['explore'],
};
type SourceState = {
  items: PersonalTrackCandidate[];
  offset: number;
  exhausted: boolean;
  requested: boolean;
  neededRows: Set<string>;
};

/** One background build: cached pages advance only after composition needs more. */
export class PersonalCandidateSession {
  cooccurrenceRow?: Promise<HomeRow | undefined>;
  cooccurrencePool?: HomeTrack[];
  mostSungArtistsRow?: Promise<HomeRow | undefined>;
  private readonly sources = new Map<string, SourceState>();
  private readonly extraTargets = new Map<string, Set<string>>();
  private readonly metadata = new Map<string, DiscoveryTrack>();
  private readonly metadataRead = new Set<string>();
  private readonly collectiveScores = new Map<string, number>();
  private readonly collectiveRead = new Set<string>();

  private selectedTrackIds = new Set<string>();

  constructor(
    private readonly publicRowIds: ReadonlySet<string>,
    private readonly userRange: TrackVocalRange | null = null,
  ) {}

  target(source: string, rowId: string): void {
    const targets = this.extraTargets.get(source) ?? new Set<string>();
    targets.add(rowId);
    this.extraTargets.set(source, targets);
  }

  async load(
    source: string,
    read: (offset: number) => Promise<PersonalTrackCandidate[]>,
  ): Promise<PersonalTrackCandidate[]> {
    const state = this.sources.get(source) ?? {
      items: [],
      offset: 0,
      exhausted: false,
      requested: true,
      neededRows: new Set(this.targets(source)),
    };
    if (state.requested && !state.exhausted) {
      const page = await read(state.offset);
      state.offset += page.length;
      state.exhausted = page.length < PERSONAL_CANDIDATE_BATCH_SIZE;
      state.requested = false;
      state.items = compactPersonalCandidates([...state.items, ...page], {
        source,
        sourceTargetCount: this.targets(source).length,
        neededRows: state.neededRows,
        selectedTrackIds: this.selectedTrackIds,
        userRange: this.userRange,
      });
    }
    this.sources.set(source, state);
    return state.items;
  }

  needsMore(rows: HomeRow[]): boolean {
    this.selectedTrackIds = new Set(rows.flatMap(trackIdsOfRow));
    let requested = false;
    for (const [source, state] of this.sources) {
      if (state.exhausted) continue;
      const targets = this.targets(source);
      state.neededRows = new Set(
        targets.filter((id) => this.needsRow(rows, id)),
      );
      if (state.neededRows.size === 0) continue;
      state.requested = true;
      requested = true;
    }
    return requested;
  }

  async discoveryMetadata(
    ids: string[],
    load: (ids: string[]) => Promise<Map<string, DiscoveryTrack>>,
  ): Promise<Map<string, DiscoveryTrack>> {
    const missing = ids.filter((id) => !this.metadataRead.has(id));
    if (missing.length > 0) {
      for (const [id, track] of await load(missing))
        this.metadata.set(id, track);
      for (const id of missing) this.metadataRead.add(id);
    }
    return new Map(
      ids.flatMap((id) => {
        const track = this.metadata.get(id);
        return track ? [[id, track]] : [];
      }),
    );
  }

  async discoveryScores(
    ids: string[],
    load: (ids: string[]) => Promise<Map<string, number>>,
  ): Promise<Map<string, number>> {
    const missing = ids.filter((id) => !this.collectiveRead.has(id));
    if (missing.length > 0) {
      for (const [id, score] of await load(missing))
        this.collectiveScores.set(id, score);
      for (const id of missing) this.collectiveRead.add(id);
    }
    return new Map(this.collectiveScores);
  }

  private targets(source: string): string[] {
    const applicable = (SOURCE_ROWS[source] ?? []).filter(
      (id) =>
        id === 'recommended-for-you' ||
        id === 'explore' ||
        id.includes('your-voice') ||
        id === 'challenge-your-range' ||
        this.publicRowIds.has(id),
    );
    return [...applicable, ...(this.extraTargets.get(source) ?? [])];
  }

  private needsRow(rows: HomeRow[], id: string): boolean {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return rows.length < HOME_MAX_ROWS;
    if (row.layout !== 'standard' && row.layout !== 'vocal-range') return false;
    const maximum =
      id === 'explore'
        ? Math.min(
            HOME_TRACK_ROW_MAX_ITEMS,
            explorationSlotCount(
              rows
                .filter((candidate) => candidate.id !== 'explore')
                .flatMap(trackIdsOfRow).length,
            ),
          )
        : HOME_TRACK_ROW_MAX_ITEMS;
    return row.items.length < maximum;
  }
}
