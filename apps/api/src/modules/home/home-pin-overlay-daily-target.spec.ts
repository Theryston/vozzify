import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';

const track = (id: string): HomeTrack => ({
  id,
  title: id,
  coverUrl: `https://cdn.example/${id}.webp`,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
});

const dailyTarget: HomeRow = {
  id: 'daily-target',
  layout: 'daily-target',
  title: { key: 'home.rows.dailyTarget', params: {} },
  secondsLeft: 60,
  targetSeconds: 300,
  streakDays: 0,
  completedToday: false,
};

const pin = (position: number): OverlayPin => ({
  id: 'editorial',
  kind: 'row',
  position,
  priority: 1,
  createdAt: 1,
  sponsored: false,
  title: { key: 'home.rows.editorial', params: {} },
  tracks: Array.from({ length: 6 }, (_, index) => track(`pin-${index}`)),
});

describe('daily target overlay precedence', () => {
  it('reserves the slot after a pinned hero ahead of editorial rows', () => {
    const pinnedHero: OverlayPin = {
      ...pin(0),
      id: 'hero',
      kind: 'hero',
    };
    const rows: HomeRow[] = [
      dailyTarget,
      {
        id: 'continue-singing',
        layout: 'standard',
        title: { key: 'home.rows.continueSinging', params: {} },
        items: Array.from({ length: 6 }, (_, index) =>
          track(`resume-${index}`),
        ),
      },
    ];

    const result = applyEditorialPins(rows, [pinnedHero, pin(1)]);

    expect(result.slice(0, 3).map((row) => row.id)).toEqual([
      'pin-hero',
      'daily-target',
      'pin-editorial',
    ]);
  });

  it('puts Daily target first without a hero, ahead of an editorial row', () => {
    const result = applyEditorialPins([dailyTarget], [pin(0)]);

    expect(result.slice(0, 2).map((row) => row.id)).toEqual([
      'daily-target',
      'pin-editorial',
    ]);
  });

  it('retains a one-Track resume Row through the editorial overlay', () => {
    const resume: HomeRow = {
      id: 'continue-singing',
      layout: 'standard',
      title: { key: 'home.rows.continueSinging', params: {} },
      items: [track('resume')],
    };

    const result = applyEditorialPins([dailyTarget, resume], []);

    expect(result.map((row) => row.id)).toEqual([
      'daily-target',
      'continue-singing',
    ]);
  });
});
