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

describe('resume expansion chart exceptions', () => {
  it('can overlap the ranked chart while preserving a Hero initial Track shared with that chart', () => {
    const history = Array.from({ length: 15 }, (_, index) =>
      track(`history-${index}`),
    );
    const chartOnly = history[12];
    const heroTrack = history[13];
    if (!chartOnly || !heroTrack) throw new Error('Missing chart fixture');
    const hero: HomeRow = { id: 'hero', layout: 'hero', track: heroTrack };
    const ranked: HomeRow = {
      id: 'top-10-week',
      layout: 'ranked',
      title: { key: 'home.rows.top10Week', params: {} },
      items: [chartOnly, heroTrack, track('chart-extra')],
    };
    const rows = composePersonalHomeRows({
      hero,
      dailyTarget,
      resumes: [row('continue-singing', history.slice(0, 12))],
      socialRows: [],
      publicRows: [ranked],
      recommendations: [hero],
      explorationPoolsByRow: new Map([['continue-singing', history]]),
      expandRecommendationRows: true,
    });
    const resumed = itemsOf(rows, 'continue-singing');
    expect(resumed.map(({ id }) => id)).toContain(chartOnly.id);
    expect(resumed.map(({ id }) => id)).not.toContain(heroTrack.id);
    expect(resumed.map(({ id }) => id)).toEqual(
      history.filter(({ id }) => id !== heroTrack.id).map(({ id }) => id),
    );
  });
});

describe('inherited voice batch diversity after personal exclusions', () => {
  it('reapplies the credited Artist cap when exclusions collapse public batch boundaries', () => {
    const shared = Array.from({ length: 4 }, (_, index) =>
      track(`shared-${index}`, 'shared'),
    );
    const mastered = Array.from({ length: 10 }, (_, index) =>
      track(`mastered-${index}`),
    );
    const fresh = Array.from({ length: 10 }, (_, index) =>
      track(`fresh-${index}`),
    );
    const cards = [
      ...shared.slice(0, 2),
      ...mastered,
      ...shared.slice(2),
      ...fresh,
    ].map((item) => ({ ...item, vocalRange: { lowest: 60, highest: 68 } }));
    const inherited: HomeRow = {
      id: 'by-voice-higher-voices',
      layout: 'vocal-range',
      title: { key: 'home.rows.higherVoices', params: {} },
      items: cards,
    };
    const rows = composePersonalHomeRows({
      hero: undefined,
      dailyTarget,
      resumes: [],
      socialRows: [],
      publicRows: [inherited],
      recommendations: [],
      masteredTrackIds: new Set(mastered.map(({ id }) => id)),
      explorationPoolsByRow: new Map([[inherited.id, cards]]),
      expandRecommendationRows: true,
    });
    const voice = rows.find(({ id }) => id === inherited.id);
    if (voice?.layout !== 'vocal-range')
      throw new Error('Missing inherited voice Row');
    expect(voice.items).toHaveLength(14);
    expectDiverse(voice.items);
    expect(voice.items.some(({ id }) => id.startsWith('mastered-'))).toBe(
      false,
    );
  });
});
