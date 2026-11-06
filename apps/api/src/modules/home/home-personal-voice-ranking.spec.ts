import type { HomeTrack, TrackVocalRange } from '@vozzify/contracts';
import type { PersonalTaste } from './home-personal.js';
import {
  blendDiscoveryCandidates,
  byBlendedDesc,
  type DiscoveryTrack,
} from './home-personal-blend.js';

const userRange: TrackVocalRange = { lowest: 60, highest: 72 };
const emptyTaste: PersonalTaste = {
  genreSignals: new Map(),
  totalGenreSignals: 0,
  artistSignals: new Map(),
  totalArtistSignals: 0,
};

const track = (id: string, vocalRange: TrackVocalRange): HomeTrack => ({
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange,
});

const discovery = new Map<string, DiscoveryTrack>([
  ['outside', { trendingScore: 2, genres: [], artistKey: 'outside' }],
  ['fits', { trendingScore: 1, genres: [], artistKey: 'fits' }],
]);

const rankedCandidates = (
  derivedRange: TrackVocalRange | null,
  voiceConfidence = 0,
) =>
  blendDiscoveryCandidates({
    tracks: [
      track('outside', { lowest: 80, highest: 88 }),
      track('fits', { lowest: 62, highest: 70 }),
    ],
    discovery,
    taste: emptyTaste,
    lambda: 1,
    userRange: derivedRange,
    voiceConfidence,
  });

describe('personal voice ranking', () => {
  it('uses a derived range to rank fit above a more popular mismatch', () => {
    const [fits, outside] = rankedCandidates(userRange, 0.8).sort(
      byBlendedDesc,
    );

    expect(fits?.track.id).toBe('fits');
    expect(outside?.track.id).toBe('outside');
    expect(fits?.blended).toBeGreaterThan(outside?.blended ?? 0);
  });

  it('leaves the personal score unchanged when no range is derived', () => {
    const [outside, fits] = rankedCandidates(null);

    expect(outside?.personal).toBe(0);
    expect(fits?.personal).toBe(0);
    expect(outside?.blended).toBe(fits?.blended);
  });
});
