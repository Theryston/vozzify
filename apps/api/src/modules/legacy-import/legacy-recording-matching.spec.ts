import { testMbid } from '../../../test/utils/factories.js';
import { recordingFixture } from '../../../test/utils/recording-fixtures.js';
import type { LegacyTrack } from './legacy-recording.js';
import {
  chooseRecordingMatch,
  matchLegacyTrack,
} from './legacy-recording-matching.js';

const legacyTrack = (overrides: Partial<LegacyTrack> = {}): LegacyTrack => ({
  id: 'legacy-track-1',
  ytId: 'youtube123',
  title: 'Bohemian Rhapsody',
  durationSeconds: 354,
  duration: '5:54',
  albumId: 'legacy-album-1',
  albumName: 'A Night at the Opera',
  albumYtId: 'legacy-album-youtube',
  creatorId: 'legacy-user-1',
  createdAt: new Date('2020-01-01T00:00:00Z'),
  dependentFavorites: 0,
  dependentViews: 0,
  artists: [{ id: 'legacy-artist-1', name: 'Queen', ytId: 'queen-youtube' }],
  ...overrides,
});

describe('legacy recording matching', () => {
  it('rejects a title-only candidate', () => {
    const recording = recordingFixture({
      artistCredit: { name: 'Another artist', artists: [] },
      lengthMs: null,
    });

    expect(matchLegacyTrack(legacyTrack({ ytId: null }), recording)).toBeNull();
  });

  it('accepts an alternate legacy version that resolves to a studio Recording', () => {
    const recording = recordingFixture({
      artistCredit: {
        name: 'Queen',
        artists: [
          {
            mbid: testMbid(20),
            name: 'Queen',
            creditedName: 'Queen',
            joinPhrase: '',
          },
        ],
      },
    });

    expect(
      matchLegacyTrack(
        legacyTrack({ title: 'Bohemian Rhapsody (Live)' }),
        recording,
      )?.recording.mbid,
    ).toBe(recording.mbid);
  });

  it('rejects a known acoustic Recording for a studio source', () => {
    const recording = recordingFixture({
      title: 'Bohemian Rhapsody (Acoustic)',
      artistCredit: {
        name: 'Queen',
        artists: [
          {
            mbid: testMbid(20),
            name: 'Queen',
            creditedName: 'Queen',
            joinPhrase: '',
          },
        ],
      },
    });

    expect(matchLegacyTrack(legacyTrack(), recording)).toBeNull();
  });

  it('does not mistake the word acoustic in a song title for its version', () => {
    const recording = recordingFixture({
      title: 'Acoustic track (Acoustic)',
      artistCredit: {
        name: 'Queen',
        artists: [
          {
            mbid: testMbid(20),
            name: 'Queen',
            creditedName: 'Queen',
            joinPhrase: '',
          },
        ],
      },
    });

    expect(
      matchLegacyTrack(
        legacyTrack({ title: 'Acoustic track', albumName: null }),
        recording,
      ),
    ).toBeNull();
  });

  it('requires an exact YouTube identity instead of a matching URL substring', () => {
    const recording = recordingFixture({
      lengthMs: null,
      externalUrls: [
        { url: 'https://example.com/youtube123', linkType: 'other' },
      ],
    });

    expect(
      matchLegacyTrack(
        legacyTrack({ artists: [], durationSeconds: null, duration: null }),
        recording,
      ),
    ).toBeNull();
  });

  it('chooses deterministically when match scores tie', () => {
    const first = recordingFixture({ mbid: testMbid(2) });
    const second = recordingFixture({ mbid: testMbid(1) });

    expect(
      chooseRecordingMatch([
        { recording: first, score: 70, rationale: 'evidence' },
        { recording: second, score: 70, rationale: 'evidence' },
      ])?.recording.mbid,
    ).toBe(second.mbid);
  });
});
