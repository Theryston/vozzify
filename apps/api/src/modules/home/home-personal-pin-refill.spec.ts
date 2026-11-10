import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { homeCompositionCandidatesSchema } from './home-composition-candidates.js';
import { composePersonalHomeRows } from './home-personal-composition.js';
import { personalCompositionCandidates } from './home-personal-composition-candidates.js';
import { composePersonalVisitRows } from './home-personal-visit-composer.js';

const track = (id: string, artist = id): HomeTrack => ({
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: artist, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
});
const row = (id: string, items: HomeTrack[]): HomeRow => ({
  id,
  layout: 'standard',
  title: { key: 'home.rows.forYou', params: {} },
  items,
});
const daily: HomeRow = {
  id: 'daily-target',
  layout: 'daily-target',
  title: { key: 'home.rows.dailyTarget', params: {} },
  secondsLeft: 60,
  targetSeconds: 300,
  streakDays: 1,
  completedToday: false,
};
const pin = (tracks: HomeTrack[]) => ({
  id: 'live',
  kind: 'row' as const,
  position: 1,
  priority: 1,
  createdAt: 1,
  sponsored: false,
  title: { key: 'home.rows.pinned', params: { title: 'Pinned' } },
  tracks,
});

const explorationScenario = () => {
  const pools = {
    first: Array.from({ length: 12 }, (_, index) =>
      track(`first-${index}`, `exposed-${index % 6}`),
    ),
    second: [
      ...Array.from({ length: 100 }, (_, index) => track(`second-${index}`)),
      ...Array.from({ length: 12 }, (_, index) =>
        track(`surprise-${index}`, `exposed-${index % 6}`),
      ),
    ],
  };
  const tasteByTrack = new Map(
    Object.values(pools)
      .flat()
      .map((item) => [item.id, item.id.startsWith('surprise-') ? 0 : 1]),
  );
  const rows = composePersonalHomeRows({
    hero: undefined,
    dailyTarget: daily,
    resumes: [],
    socialRows: [],
    publicRows: [],
    recommendations: [
      row('first', pools.first),
      row('second', pools.second.slice(0, 12)),
    ],
    explorationPoolsByRow: new Map(Object.entries(pools)),
    tasteByTrack,
    expandRecommendationRows: true,
    explorationSeed: 'seed0',
  });
  const candidates = personalCompositionCandidates({
    rows,
    sourcePoolsByRow: pools,
    artistKeysByTrack: new Map(),
    mastered: new Set(),
    tasteByTrack,
    explorationSeed: 'seed0',
  });
  return {
    rows,
    candidates: homeCompositionCandidatesSchema.parse(candidates),
  };
};

describe('personal live Pin refill', () => {
  it.each([3, 25])(
    'retains a Row with %i replacements after all selected Tracks are pinned',
    (replacementCount) => {
      const selected = Array.from({ length: 6 }, (_, index) =>
        track(`selected-${index}`),
      );
      const replacements = Array.from(
        { length: replacementCount },
        (_, index) => track(`replacement-${index}`),
      );
      const rows = [daily, row('recommended-for-you', selected)];
      const candidates = personalCompositionCandidates({
        rows,
        sourcePoolsByRow: {
          'recommended-for-you': [...selected, ...replacements],
        },
        artistKeysByTrack: new Map(),
        mastered: new Set(),
      });
      const shown = composePersonalVisitRows(rows, candidates, [pin(selected)]);
      const recovered = shown.find(({ id }) => id === 'recommended-for-you');
      if (recovered?.layout !== 'standard')
        throw new Error('Source-eligible Row was dropped');
      expect(recovered.items.map(({ id }) => id)).toEqual(
        replacements.map(({ id }) => id),
      );
    },
  );

  it('preserves the complete personal order and exploration when a Pin has no overlapping Tracks', () => {
    const { rows, candidates } = explorationScenario();
    const shown = composePersonalVisitRows(rows, candidates, [
      pin([track('unrelated')]),
    ]);
    expect(shown.filter(({ id }) => !id.startsWith('pin-'))).toEqual(rows);
  });
  it('replenishes a pinned exploration Track using the saved taste and daily seed', () => {
    const { rows, candidates } = explorationScenario();
    const second = rows.find(({ id }) => id === 'second');
    if (second?.layout !== 'standard') throw new Error('Missing second Row');
    const surprising = second.items.filter(({ id }) =>
      id.startsWith('surprise-'),
    );
    expect(surprising).toHaveLength(6);
    const pinned = surprising[0];
    if (!pinned) throw new Error('Missing exploration Track');
    const shown = composePersonalVisitRows(rows, candidates, [pin([pinned])]);
    const restored = shown.find(({ id }) => id === 'second');
    if (restored?.layout !== 'standard')
      throw new Error('Missing refilled Row');
    expect(restored.items).toHaveLength(48);
    expect(
      restored.items.filter(({ id }) => id.startsWith('surprise-')),
    ).toHaveLength(6);
    expect(restored.items.some(({ id }) => id === pinned.id)).toBe(false);
  });
  it('releases resume expansion tails for another retained initial batch after Pins', () => {
    const history = Array.from({ length: 30 }, (_, index) =>
      track(`history-${index}`),
    );
    const rows = [
      daily,
      row('continue-singing', [...history.slice(0, 12), ...history.slice(24)]),
      row('most-sung', history.slice(12, 24)),
    ];
    const candidates = personalCompositionCandidates({
      rows,
      sourcePoolsByRow: { 'continue-singing': history, 'most-sung': history },
      artistKeysByTrack: new Map(),
      mastered: new Set(),
    });
    const shown = composePersonalVisitRows(rows, candidates, [
      pin(history.slice(12, 24)),
    ]);
    const resumed = shown.find(({ id }) => id === 'continue-singing');
    const singing = shown.find(({ id }) => id === 'most-sung');
    if (resumed?.layout !== 'standard' || singing?.layout !== 'standard')
      throw new Error('Resume expansion hid a useful ordinary initial batch');
    expect(resumed.items.map(({ id }) => id)).toEqual(
      history.slice(0, 12).map(({ id }) => id),
    );
    expect(singing.items.map(({ id }) => id)).toEqual(
      history.slice(24).map(({ id }) => id),
    );
  });
});

describe('canonical resume history after capacity changes', () => {
  it('restores released ordinary Tracks at their original history positions', () => {
    const history = Array.from({ length: 30 }, (_, index) =>
      track(`history-${index}`),
    );
    const entities: HomeRow[] = Array.from({ length: 21 }, (_, index) => ({
      id: `artists-${index}`,
      layout: 'artists',
      title: { key: 'home.rows.featuredArtists', params: {} },
      items: Array.from({ length: 3 }, (_, item) => ({
        id: `artist-${index}-${item}`,
        name: `Artist ${index}-${item}`,
      })),
    }));
    const rows = [
      daily,
      row('continue-singing', [...history.slice(0, 12), ...history.slice(24)]),
      ...entities,
      row('most-sung', history.slice(12, 24)),
    ];
    const candidates = personalCompositionCandidates({
      rows,
      sourcePoolsByRow: { 'continue-singing': history, 'most-sung': history },
      artistKeysByTrack: new Map(),
      mastered: new Set(),
    });
    const shown = composePersonalVisitRows(rows, candidates, [
      pin([track('unrelated')]),
    ]);
    expect(shown.some(({ id }) => id === 'most-sung')).toBe(false);
    const resumed = shown.find(({ id }) => id === 'continue-singing');
    if (resumed?.layout !== 'standard') throw new Error('Missing resume');
    expect(resumed.items.map(({ id }) => id)).toEqual(
      history.map(({ id }) => id),
    );
  });
});
