import { describe, expect, it } from 'vitest';
import type { UserFavoriteSignal } from './home-personal.repository.js';
import type { UserTasteActivity } from './home-personal.repository.types.js';
import { personalBreadth, tasteSignalsOf } from './home-personal-activity.js';

const activity = (trackId: string, createdAt: string): UserTasteActivity => ({
  trackId,
  genres: ['rock'],
  artistKey: 'artist',
  createdAt: new Date(createdAt),
});

const favorite = (trackId: string, createdAt: string): UserFavoriteSignal => ({
  trackId,
  genres: ['pop'],
  artistKey: 'favorite-artist',
  createdAt: new Date(createdAt),
});

const dayKeyOf = (date: Date): string => date.toISOString().slice(0, 10);

describe('personal taste evidence', () => {
  it('caps repeat weight per Track and local Practice day', () => {
    const signals = tasteSignalsOf(
      [
        activity('track-a', '2026-11-01T12:00:00.000Z'),
        activity('track-a', '2026-11-01T14:00:00.000Z'),
        activity('track-a', '2026-11-01T16:00:00.000Z'),
        activity('track-a', '2026-11-01T18:00:00.000Z'),
        activity('track-a', '2026-11-01T20:00:00.000Z'),
        activity('track-a', '2026-11-02T12:00:00.000Z'),
      ],
      [],
      dayKeyOf,
      'UTC',
    );

    expect(signals.map((signal) => signal.weight)).toEqual([1.3, 1]);
  });

  it('counts distinct Track and day evidence including favorite-only history', () => {
    expect(
      personalBreadth({
        activities: [],
        favorites: [
          favorite('track-a', '2026-11-01T12:00:00.000Z'),
          favorite('track-b', '2026-11-01T14:00:00.000Z'),
          favorite('track-a', '2026-11-02T14:00:00.000Z'),
        ],
        timeZone: 'UTC',
        dayKeyOf,
      }),
    ).toEqual({ distinctTracks: 2, activeDays: 2 });
  });

  it('does not add confidence evidence for repeats of one Track on one day', () => {
    const activities = [
      activity('track-a', '2026-11-01T12:00:00.000Z'),
      activity('track-a', '2026-11-01T14:00:00.000Z'),
      activity('track-a', '2026-11-01T16:00:00.000Z'),
    ];

    expect(
      personalBreadth({
        activities,
        favorites: [],
        timeZone: 'UTC',
        dayKeyOf,
      }),
    ).toEqual({ distinctTracks: 1, activeDays: 1 });
    expect(tasteSignalsOf(activities, [], dayKeyOf, 'UTC')[0]?.weight).toBe(
      1.2,
    );
  });
});
