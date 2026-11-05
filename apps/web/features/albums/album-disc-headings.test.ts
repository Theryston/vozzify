import type { AlbumTrack } from '@vozzify/contracts';
import { describe, expect, it } from 'vitest';

import { albumTrackGroupBy, discHeading } from './album-disc-headings';

// Labels that name their shape, so a test can see which heading was chosen.
const labels = {
  numbered: (number: number) => `numbered:${number}`,
  named: (number: number, title: string) => `named:${number}:${title}`,
};

const track = (id: string, disc: AlbumTrack['disc']): AlbumTrack => ({
  id,
  title: id,
  coverUrl: null,
  lengthMs: null,
  disambiguation: '',
  video: false,
  isrcs: [],
  artists: [{ id: 'artist-1', name: 'Queen' }],
  genres: [],
  disc,
});

describe('discHeading', () => {
  it('shows the disc number for a disc without a name', () => {
    expect(discHeading({ position: 1, title: null }, labels)).toBe(
      'numbered:1',
    );
  });

  it('shows the disc number and name for a named disc', () => {
    expect(discHeading({ position: 2, title: 'Bonus Disc' }, labels)).toBe(
      'named:2:Bonus Disc',
    );
  });
});

describe('albumTrackGroupBy', () => {
  const groupBy = albumTrackGroupBy(labels);

  it('heads each track with the heading of its own disc', () => {
    expect(groupBy(track('a', { position: 1, title: null }))).toBe(
      'numbered:1',
    );
    expect(groupBy(track('b', { position: 2, title: 'Bonus Disc' }))).toBe(
      'named:2:Bonus Disc',
    );
  });

  it('gives tracks of one disc one heading, so they share a group', () => {
    const first = groupBy(track('a', { position: 1, title: null }));
    const second = groupBy(track('b', { position: 1, title: null }));

    expect(first).toBe(second);
  });
});
