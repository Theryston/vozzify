import type { HomeRow } from '@vozzify/contracts';
import type {
  HomeCompositionCandidateRow,
  HomeCompositionCandidateTrack,
} from './home-composition-candidates.js';
import { storedPersonalHomeFeedSchema } from './home-feed.js';
import { genreRowId, isGenreRow } from './home-genre-rows.js';
import { composePersonalHomeRows } from './home-personal-composition.js';
import { personalGenreCandidates } from './home-personal-genres.js';
import { composePersonalVisitRows } from './home-personal-visit-composer.js';
import type { OverlayPin } from './home-pin-overlay.js';
import { toComposedHomeRow } from './home-public-visit-composer.js';

const track = (index: number, score = 100): HomeCompositionCandidateTrack => ({
  id: `track-${index.toString().padStart(4, '0')}`,
  title: `Track ${index}`,
  coverUrl: null,
  artistCredit: [{ name: `Artist ${index}`, joinPhrase: '' }],
  durationMs: null,
  vocalRange: { lowest: 60, highest: 72 },
  artistKey: `artist-${index}`,
  artistKeys: [`artist-${index}`],
  hasCover: false,
  isCompleted: true,
  collectiveScore: score,
});
const pool = (
  genre: string,
  items: HomeCompositionCandidateTrack[],
): HomeCompositionCandidateRow => ({
  id: genreRowId(genre),
  genre,
  layout: 'standard',
  title: { key: 'home.rows.popularGenre', params: { genre } },
  items,
});
const emptyTaste = {
  genreSignals: new Map<string, number>(),
  totalGenreSignals: 0,
  artistSignals: new Map<string, number>(),
  totalArtistSignals: 0,
};
const rank = (
  candidates: HomeCompositionCandidateRow[],
  overrides: Partial<Parameters<typeof personalGenreCandidates>[0]> = {},
) =>
  personalGenreCandidates({
    candidates,
    taste: emptyTaste,
    lambda: 0,
    userRange: null,
    voiceConfidence: 0,
    mastered: new Set(),
    ...overrides,
  });
const dailyTarget: HomeRow = {
  id: 'daily-target',
  layout: 'daily-target',
  title: { key: 'home.rows.dailyTarget', params: {} },
  secondsLeft: 300,
  targetSeconds: 300,
  streakDays: 0,
  completedToday: false,
};
const compose = (
  candidates: HomeCompositionCandidateRow[],
  extras: Partial<Parameters<typeof composePersonalHomeRows>[0]> = {},
) =>
  composePersonalHomeRows({
    hero: undefined,
    dailyTarget,
    resumes: [],
    socialRows: [],
    publicRows: [],
    recommendations: [],
    expandRecommendationRows: true,
    genreCandidates: candidates,
    ...extras,
  });
const rowOf = (candidate: HomeCompositionCandidateRow): HomeRow => {
  const row = toComposedHomeRow(candidate);
  if (!row) throw new Error('Invalid fixture');
  return row;
};
const idsOf = (rows: HomeRow[]) =>
  rows.flatMap((row) =>
    row.layout === 'standard' ? row.items.map((track) => track.id) : [],
  );
const sequence = (count: number, offset = 0, score = 100) =>
  Array.from({ length: count }, (_, index) => track(index + offset, score));
const pin = (items: HomeCompositionCandidateTrack[]): OverlayPin => ({
  id: 'editorial',
  kind: 'row',
  position: 2,
  priority: 0,
  createdAt: 0,
  sponsored: false,
  title: { key: 'home.rows.pinned', params: { title: 'Editorial' } },
  tracks: items,
});

describe('personal collective genre composition', () => {
  it('keeps global order without evidence and uses established taste for genre priority and Track order', () => {
    const popular = pool('popular', sequence(12));
    const preferred = pool('preferred', sequence(12, 100, 90));
    expect(
      compose(rank([preferred, popular]))
        .filter(isGenreRow)
        .map((row) => row.id),
    ).toEqual([popular.id, preferred.id]);
    const taste = {
      ...emptyTaste,
      genreSignals: new Map([['preferred', 1]]),
      totalGenreSignals: 1,
      artistSignals: new Map([['artist-111', 1]]),
      totalArtistSignals: 1,
    };
    const personalized = compose(
      rank([popular, preferred], { taste, lambda: 0.8 }),
    );
    const first = personalized.filter(isGenreRow)[0];
    expect(first?.id).toBe(preferred.id);
    expect(idsOf(first ? [first] : [])[0]).toBe('track-0111');
    expect(idsOf(personalized)).toHaveLength(24);
  });

  it('uses evidence-qualified voice for genre priority without changing collective admission', () => {
    const outside = pool(
      'outside',
      sequence(12).map((item) => ({
        ...item,
        vocalRange: { lowest: 30, highest: 90 },
      })),
    );
    const within = pool('within', sequence(12, 100, 90));
    const candidates = [outside, within];
    const without = compose(
      rank(candidates, {
        lambda: 0.8,
        userRange: { lowest: 60, highest: 72 },
        voiceConfidence: 0,
      }),
    );
    expect(without.filter(isGenreRow)[0]?.id).toBe(outside.id);
    const withVoice = compose(
      rank(candidates, {
        lambda: 0.8,
        userRange: { lowest: 60, highest: 72 },
        voiceConfidence: 1,
      }),
    );
    expect(withVoice.filter(isGenreRow)[0]?.id).toBe(within.id);
    expect(idsOf(withVoice)).toHaveLength(24);
  });

  it('protects all existing and genre initials before expansion and rejects eleven strong candidates', () => {
    const strong = sequence(72);
    const candidate = pool('pop', strong.slice(12));
    const regular = {
      ...pool('regular', strong),
      id: 'recommended-for-you',
      genre: undefined,
      title: { key: 'home.rows.forYou', params: {} },
    };
    const existing = rowOf({ ...regular, items: strong.slice(0, 12) });
    const result = compose(rank([candidate]), {
      recommendations: [existing],
      explorationPoolsByRow: new Map([[existing.id, strong]]),
    });
    const genre = result.find(isGenreRow);
    if (genre?.layout !== 'standard') throw new Error('Missing genre');
    expect(genre.items.slice(0, 12).map((item) => item.id)).toEqual(
      strong.slice(12, 24).map((item) => item.id),
    );
    const ordinary = result.find((row) => row.id === existing.id);
    if (ordinary?.layout !== 'standard') throw new Error('Missing ordinary');
    expect(ordinary.items).toHaveLength(48);
    expect(genre.items).toHaveLength(24);
    expect(new Set(idsOf(result)).size).toBe(72);
    expect(compose(rank([pool('thin', sequence(11))]))).toEqual([dailyTarget]);
  });

  it('recomputes residual mean and overlap after mastered, chart and resume reservations', () => {
    const shared = sequence(12);
    const higher = pool('higher', [...shared, ...sequence(12, 100, 10)]);
    const medium = pool('medium', sequence(12, 200, 50));
    const resume = rowOf({
      ...pool('resume', shared),
      id: 'continue-singing',
      genre: undefined,
      title: { key: 'home.rows.continueSinging', params: {} },
    });
    expect(
      compose(rank([higher, medium]), { resumes: [resume] })
        .filter(isGenreRow)
        .map((row) => row.id),
    ).toEqual([medium.id, higher.id]);
    const mastered = new Set(shared.map((item) => item.id));
    expect(
      compose(rank([pool('thin', shared)], { mastered })).filter(isGenreRow),
    ).toEqual([]);
    const chart: HomeRow = {
      id: 'top-10-this-week',
      layout: 'ranked',
      title: { key: 'home.rows.top10ThisWeek', params: {} },
      items: shared.slice(0, 3),
    };
    expect(
      compose(rank([pool('chart-overlap', shared)]), {
        publicRows: [chart],
      }).filter(isGenreRow),
    ).toEqual([]);
    const a = pool('a', [...shared, ...sequence(12, 300, 10)]);
    const b = pool('b', shared);
    expect(
      compose(rank([b, a]))
        .filter(isGenreRow)
        .map((row) => row.id),
    ).toEqual([a.id]);
  });

  it('retains complete readable private pools and strips blend metadata from cards', () => {
    const candidates = rank([pool('pop', sequence(25))]);
    const stored = storedPersonalHomeFeedSchema.parse({
      audience: 'personal',
      locale: 'en',
      version: 'personal',
      algorithmVersion: 9,
      generatedAt: new Date().toISOString(),
      rows: compose(candidates),
      genreCandidates: candidates,
    });
    expect(stored.genreCandidates?.[0]?.items).toHaveLength(25);
    expect(stored.genreCandidates?.[0]?.items[0]?.personalBlendedScore).toBe(1);
    const genre = stored.rows.find(isGenreRow);
    if (genre?.layout !== 'standard') throw new Error('Missing genre');
    expect(genre.items[0]).not.toHaveProperty('personalBlendedScore');
    expect(genre.items[0]).not.toHaveProperty('collectiveScore');
  });

  it('considers all genres within remaining capacity and preserves canonical same-name Artist keys', () => {
    const candidates = rank(
      Array.from({ length: 26 }, (_, index) =>
        pool(
          `genre-${index.toString().padStart(2, '0')}`,
          sequence(12, index * 12),
        ),
      ),
    );
    const result = compose(candidates);
    expect(result).toHaveLength(24);
    expect(result.filter(isGenreRow)).toHaveLength(23);
    expect(result.at(-1)?.id).toBe(candidates[22]?.id);
    const canonical = rank([
      pool(
        'canonical',
        sequence(25).map((item, index) => ({
          ...item,
          artistCredit: [{ name: 'Same name', joinPhrase: '' }],
          artistKey: `mbid-${index % 6}`,
          artistKeys: [`mbid-${index % 6}`],
        })),
      ),
    ]);
    const artistKeysByTrack = new Map(
      canonical.flatMap((row) =>
        row.items.map((item) => [item.id, item.artistKeys ?? []] as const),
      ),
    );
    const canonicalRows = compose(canonical, { artistKeysByTrack });
    expect(idsOf(canonicalRows)).toHaveLength(25);
    expect(
      idsOf(
        composePersonalVisitRows(canonicalRows, canonical, [pin([track(999)])]),
      ),
    ).toHaveLength(26);
  });

  it('requalifies every stored genre after Pins and can select a genre absent from the snapshot', () => {
    const common = sequence(1);
    const first = pool('first', [...common, ...sequence(11, 10)]);
    const second = pool('second', [...common, ...sequence(12, 100, 90)]);
    const candidates = rank([first, second]);
    const onlyFirst = compose(candidates).filter((row) => row.id !== second.id);
    const overlaid = composePersonalVisitRows(onlyFirst, candidates, [
      pin([track(10)]),
    ]);
    expect(overlaid.filter(isGenreRow).map((row) => row.id)).toEqual([
      second.id,
    ]);
    expect(idsOf(overlaid).filter((id) => id !== 'track-0010')).toHaveLength(
      13,
    );
  });
  it('keeps six credited Artists after exploration even when a genre has uncredited Tracks', () => {
    const credited = sequence(11).map((item, index) => ({
      ...item,
      artistKey: `artist-${Math.floor(index / 2)}`,
      artistKeys: [`artist-${Math.floor(index / 2)}`],
      artistCredit: [
        { name: `Artist ${Math.floor(index / 2)}`, joinPhrase: '' },
      ],
    }));
    const singleton = credited.pop();
    if (!singleton) throw new Error('Missing singleton');
    credited.splice(3, 0, singleton);
    const all = [
      ...credited,
      ...sequence(2, 100).map((item) => ({ ...item, artistCredit: [] })),
    ];
    const candidates = [pool('credited', all)];
    const artistKeysByTrack = new Map(
      all.map((item) => [item.id, item.artistKeys ?? []] as const),
    );
    const tasteByTrack = new Map(all.slice(0, 12).map((item) => [item.id, 1]));
    const result = compose(candidates, {
      expandRecommendationRows: false,
      artistKeysByTrack,
      tasteByTrack,
      explorationSeed: 'a',
    });
    const row = result.find(isGenreRow);
    if (row?.layout !== 'standard') throw new Error('Missing credited genre');
    expect(
      new Set(
        row.items
          .slice(0, 12)
          .flatMap((item) => item.artistCredit.map((credit) => credit.name)),
      ).size,
    ).toBeGreaterThanOrEqual(6);
  });
  it('reevaluates rejected genre pools when a Pin removes an unused blocking collaboration', () => {
    const collaboration = {
      ...track(0),
      artistKeys: ['A', 'B'],
      artistCredit: [
        { name: 'A', joinPhrase: ' & ' },
        { name: 'B', joinPhrase: '' },
      ],
    };
    const others = sequence(12, 1).map((item, index) => ({
      ...item,
      artistKey: String.fromCharCode(65 + Math.floor(index / 2)),
      artistKeys: [String.fromCharCode(65 + Math.floor(index / 2))],
      artistCredit: [
        {
          name: String.fromCharCode(65 + Math.floor(index / 2)),
          joinPhrase: '',
        },
      ],
    }));
    const candidates = [pool('blocked', [collaboration, ...others])];
    const baseline = compose(candidates);
    expect(baseline.filter(isGenreRow)).toEqual([]);
    const editorial = pin([collaboration, ...sequence(5, 999)]);
    const shown = composePersonalVisitRows(baseline, candidates, [editorial]);
    const genre = shown.find(isGenreRow);
    if (genre?.layout !== 'standard')
      throw new Error('Pin must release the valid genre initial');
    expect(genre.items.map((item) => item.id)).toEqual(
      others.map((item) => item.id),
    );
  });
});
