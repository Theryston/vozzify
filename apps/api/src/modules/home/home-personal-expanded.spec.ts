import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { composePersonalHomeRows } from './home-personal-composition.js';
import { personalCompositionCandidates } from './home-personal-composition-candidates.js';
import { resumeRows } from './home-personal-resume-rows.js';
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
const dailyTarget: HomeRow = {
  id: 'daily-target',
  layout: 'daily-target',
  title: { key: 'home.rows.dailyTarget', params: {} },
  secondsLeft: 60,
  targetSeconds: 300,
  streakDays: 1,
  completedToday: false,
};
const compose = (recommendations: HomeRow[], pools: Map<string, HomeTrack[]>) =>
  composePersonalHomeRows({
    hero: undefined,
    dailyTarget,
    resumes: [],
    socialRows: [],
    publicRows: [],
    recommendations,
    explorationPoolsByRow: pools,
    expandRecommendationRows: true,
  });
const itemsOf = (rows: HomeRow[], id: string) => {
  const found = rows.find((candidate) => candidate.id === id);
  if (found?.layout !== 'standard') throw new Error(`Missing ${id}`);
  return found.items;
};

describe('expanded personal composition', () => {
  it('protects every retained initial allocation before expanding to 48', () => {
    const first = Array.from({ length: 60 }, (_, i) => track(`first-${i}`));
    const protectedItems = first.slice(12, 24);
    const rows = compose(
      [
        row('because-you-sang', first.slice(0, 12)),
        row('new-tracks', protectedItems),
      ],
      new Map([
        ['because-you-sang', first],
        ['new-tracks', protectedItems],
      ]),
    );
    expect(itemsOf(rows, 'because-you-sang')).toHaveLength(48);
    expect(itemsOf(rows, 'new-tracks')).toEqual(protectedItems);
    expect(
      itemsOf(rows, 'because-you-sang').some((item) =>
        protectedItems.includes(item),
      ),
    ).toBe(false);
    expect(rows[0]).toBe(dailyTarget);
  });
});

const expectDiverse = (items: HomeTrack[]) => {
  for (let offset = 0; offset < items.length; offset += 12) {
    const counts = new Map<string, number>();
    for (const item of items.slice(offset, offset + 12))
      for (const credit of item.artistCredit)
        counts.set(credit.name, (counts.get(credit.name) ?? 0) + 1);
    expect([...counts.values()].every((count) => count <= 2)).toBe(true);
  }
};

describe('personal batch diversity after expansion', () => {
  it('resets Artist counts at logical boundaries even when the initial Row is partial', () => {
    const initial = [track('a0', 'shared'), track('a1', 'shared'), track('b0')];
    const remaining = Array.from({ length: 36 }, (_, index) =>
      track(`later-${index}`, index < 7 ? 'shared' : `artist-${index}`),
    );
    const rows = compose(
      [row('recommended-for-you', initial)],
      new Map([['recommended-for-you', [...initial, ...remaining]]]),
    );
    const selected = itemsOf(rows, 'recommended-for-you');
    expect(selected.length).toBeGreaterThan(12);
    expectDiverse(selected);
    expect(
      selected
        .slice(0, 12)
        .filter((item) => item.artistCredit[0]?.name === 'shared'),
    ).toHaveLength(2);
    expect(
      selected
        .slice(12)
        .some((item) => item.artistCredit[0]?.name === 'shared'),
    ).toBe(true);
    expect(new Set(selected.map(({ id }) => id)).size).toBe(selected.length);
  });

  it('keeps collaborations diverse after confidence ordering and exploration substitutions', () => {
    const cards = Array.from({ length: 48 }, (_, index) =>
      track(`candidate-${index}`, `artist-${index % 12}`),
    );
    for (const card of cards.filter((_, index) => index % 6 === 0))
      card.artistCredit.push({ name: 'collaborator', joinPhrase: '' });
    const rows = composePersonalHomeRows({
      hero: undefined,
      dailyTarget,
      resumes: [],
      socialRows: [],
      publicRows: [],
      recommendations: [row('recommended-for-you', cards.slice(0, 12))],
      explorationPoolsByRow: new Map([['recommended-for-you', cards]]),
      tasteByTrack: new Map(
        cards.map((card, index) => [card.id, index % 3 === 0 ? 0 : 1]),
      ),
      expandRecommendationRows: true,
      explorationSeed: 'stable-user',
    });
    const selected = itemsOf(rows, 'recommended-for-you');
    expect(selected).toHaveLength(48);
    expectDiverse(selected);
  });

  it('keeps resume history and mastery memberships disjoint with the Artist exception', () => {
    const signals = Array.from({ length: 55 }, (_, index) => ({
      trackId: `history-${index}`,
      attempts: 1,
      bestAccuracy: index < 50 ? 0.7 : 0.95,
      lastAttemptAt: new Date(Date.now() - index * 1000),
      genres: [],
      artistKey: 'shared',
      title: `History ${index}`,
      coverUrl: null,
      artistCredit: [{ name: 'shared', joinPhrase: '' }],
      durationMs: null,
      vocalRangeLowest: null,
      vocalRangeHighest: null,
    }));
    const mastered = new Set(signals.slice(50).map(({ trackId }) => trackId));
    const rows = resumeRows(signals, mastered, true);
    expect(itemsOf(rows, 'continue-singing').map(({ id }) => id)).toEqual(
      signals.slice(0, 48).map(({ trackId }) => trackId),
    );
    expect(itemsOf(rows, 'sing-again').map(({ id }) => id)).toEqual(
      signals.slice(50).map(({ trackId }) => trackId),
    );
  });
});

describe('personal expansion after capacity and live Pins', () => {
  it('releases the initial contents of capacity-excluded Rows', () => {
    const first = Array.from({ length: 60 }, (_, index) =>
      track(`first-${index}`),
    );
    const displaced = first.slice(12, 15);
    const recommendations = [
      row('first', first.slice(0, 12)),
      ...Array.from({ length: 22 }, (_, index) =>
        row(`other-${index}`, [
          track(`other-${index}-0`),
          track(`other-${index}-1`),
          track(`other-${index}-2`),
        ]),
      ),
      row('capacity-excluded', displaced),
    ];
    const composed = compose(recommendations, new Map([['first', first]]));
    expect(composed).toHaveLength(24);
    expect(composed.some(({ id }) => id === 'capacity-excluded')).toBe(false);
    expect(itemsOf(composed, 'first').map(({ id }) => id)).toEqual(
      expect.arrayContaining(displaced.map(({ id }) => id)),
    );
  });

  it('reapplies batch diversity and replenishes source-specific Tracks after live Pin exclusions', () => {
    const pool = Array.from({ length: 80 }, (_, index) =>
      track(`candidate-${index}`, `artist-${index % 12}`),
    );
    const rows = compose(
      [row('recommended-for-you', pool.slice(0, 12))],
      new Map([['recommended-for-you', pool]]),
    );
    const candidates = personalCompositionCandidates({
      rows,
      sourcePoolsByRow: { 'recommended-for-you': pool },
      artistKeysByTrack: new Map(),
      mastered: new Set(),
    });
    const pinned = pool.slice(0, 5);
    const shown = composePersonalVisitRows(rows, candidates, [
      {
        id: 'live',
        kind: 'row',
        position: 1,
        priority: 1,
        createdAt: 1,
        sponsored: false,
        title: { key: 'home.rows.pinned', params: { title: 'Pinned' } },
        tracks: pinned,
      },
    ]);
    const selected = itemsOf(shown, 'recommended-for-you');
    expect(selected).toHaveLength(48);
    expect(
      selected.some((item) => pinned.some((pin) => pin.id === item.id)),
    ).toBe(false);
    expectDiverse(selected);
  });
});
