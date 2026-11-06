import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';

const track = (id: string): HomeTrack => ({
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
});

const pin = (id: string, position: number): OverlayPin => ({
  id,
  kind: 'row',
  position,
  priority: 1,
  createdAt: 1,
  sponsored: false,
  title: { key: 'home.rows.editorial', params: {} },
  tracks: Array.from({ length: 6 }, (_, index) => track(`${id}-${index}`)),
});

const standard = (id: string, items: HomeTrack[]): HomeRow => ({
  id,
  layout: 'standard',
  title: { key: `home.rows.${id}`, params: {} },
  items,
});

describe('personal editorial pin overlay', () => {
  it('keeps a quality people row within the first page after fixed pins', () => {
    const people: HomeRow = {
      id: 'people-who-sing-what-you-sing',
      layout: 'people',
      title: { key: 'home.rows.people', params: {} },
      items: Array.from({ length: 3 }, (_, index) => ({
        id: `person-${index}`,
        username: `singer-${index}`,
        name: `Singer ${index}`,
        image: null,
        commonTracks: 3,
      })),
    };
    const rows: HomeRow[] = [
      { id: 'hero', layout: 'hero', track: track('hero') },
      {
        id: 'daily-target',
        layout: 'daily-target',
        title: { key: 'home.rows.dailyTarget', params: {} },
        secondsLeft: 60,
        targetSeconds: 300,
        streakDays: 0,
        completedToday: false,
      },
      standard('continue-singing', [track('resume')]),
      standard('sing-again', [track('mastered')]),
      standard(
        'trending-today',
        Array.from({ length: 6 }, (_, i) => track(`trend-${i}`)),
      ),
      standard(
        'new-tracks',
        Array.from({ length: 6 }, (_, i) => track(`new-${i}`)),
      ),
      people,
    ];

    const result = applyEditorialPins(
      rows,
      [pin('first', 2), pin('second', 3)],
      'personal',
    );

    expect(result.slice(0, 6).map((row) => row.id)).toEqual([
      'hero',
      'daily-target',
      'pin-first',
      'pin-second',
      'people-who-sing-what-you-sing',
      'continue-singing',
    ]);
  });

  it('retains three-item personal standard Rows after an unrelated pin', () => {
    const rows = [
      standard('trending-today', [track('one'), track('two'), track('three')]),
    ];

    const personal = applyEditorialPins(
      rows,
      [pin('unrelated', 0)],
      'personal',
    );
    const publicRows = applyEditorialPins(rows, [pin('unrelated', 0)]);

    expect(personal.map((row) => row.id)).toEqual([
      'pin-unrelated',
      'trending-today',
    ]);
    expect(publicRows.map((row) => row.id)).toEqual(['pin-unrelated']);
  });
});
