import { type ComposableTrack, composeHomeRows } from './home-feed-composer.js';
import { homeFixtureGuardrails } from './home-fixture-guardrails.js';

const track = (id: string, artistKey = `artist-${id}`): ComposableTrack => ({
  id,
  artistKey,
  hasCover: true,
  isCompleted: true,
});

describe('bounded Home composer guardrails', () => {
  it('measures coverage, duplicate exposure, Artist share and discarded Rows', () => {
    const hotArtist = (id: string) => track(id, 'hot-artist');
    const sharedTracks = Array.from({ length: 5 }, (_, index) =>
      track(`b${index}`),
    );
    const candidates = [
      {
        id: 'first',
        layout: 'standard' as const,
        items: [
          hotArtist('a0'),
          hotArtist('a1'),
          hotArtist('a2'),
          track('a3'),
          track('a4'),
          track('a5'),
          track('a6'),
        ],
      },
      {
        id: 'discarded',
        layout: 'standard' as const,
        items: [track('a0'), ...sharedTracks],
      },
      {
        id: 'last',
        layout: 'standard' as const,
        items: [...sharedTracks, track('c0')],
      },
    ];
    const startedAt = performance.now();
    const selectedRows = composeHomeRows(candidates);
    const selectionLatencyMs = performance.now() - startedAt;

    const guardrails = homeFixtureGuardrails({
      candidates,
      selectedRows,
      selectionLatencyMs,
    });
    expect(guardrails).toMatchObject({
      candidateCoverage: 12 / 13,
      duplicateExposure: 0,
      maximumArtistShare: 2 / 12,
      discardedRows: 1,
    });
    expect(Number.isFinite(guardrails.selectionLatencyMs)).toBe(true);
  });
});
