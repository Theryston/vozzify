import { describe, expect, it } from 'vitest';
import { homeStoredRowSchema } from './home-stored-row.js';

const track = (index: number) => ({
  id: `track-${index}`,
  title: `Track ${index}`,
  coverUrl: null,
  artistCredit: [],
  durationMs: null,
  vocalRange: null,
});

describe('stored Home Track Rows', () => {
  it('accepts complete standard Rows up to 48 Tracks', () => {
    const row = {
      id: 'standard-row',
      layout: 'standard',
      title: { key: 'home.rows.newTracks', params: {} },
      items: Array.from({ length: 48 }, (_, index) => track(index)),
    };

    expect(homeStoredRowSchema.safeParse(row).success).toBe(true);
    expect(
      homeStoredRowSchema.safeParse({
        ...row,
        items: [...row.items, track(48)],
      }).success,
    ).toBe(false);
  });

  it('keeps Vocal range required on complete stored vocal Rows', () => {
    const row = {
      id: 'vocal-row',
      layout: 'vocal-range',
      title: { key: 'home.rows.higherVoices', params: {} },
      items: [
        {
          ...track(1),
          vocalRange: { lowest: 48, highest: 72 },
        },
      ],
    };

    expect(homeStoredRowSchema.safeParse(row).success).toBe(true);
    expect(
      homeStoredRowSchema.safeParse({
        ...row,
        items: [{ ...row.items[0], vocalRange: null }],
      }).success,
    ).toBe(false);
  });
});
