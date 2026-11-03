import { testMbid } from '../../../test/utils/factories.js';
import { recordingFixture as recording } from '../../../test/utils/recording-fixtures.js';
import { trackRowsFromRecording } from './track-from-recording.js';

const release = (
  mbid: number,
  date: string | null,
  title = `Release ${mbid}`,
) => ({
  mbid: testMbid(100 + mbid),
  title,
  releaseGroup: { mbid: testMbid(200 + mbid), primaryType: 'Album' },
  status: 'Official',
  date,
  country: 'GB',
  mediumPosition: 1,
  trackPosition: 1,
  coverArtUrl: `https://coverartarchive.org/release/${testMbid(100 + mbid)}/front-500`,
});

describe('trackRowsFromRecording', () => {
  it('maps the core row from the Recording', () => {
    const rows = trackRowsFromRecording(recording());

    expect(rows.track).toEqual({
      recordingMbid: testMbid(1),
      primaryReleaseMbid: null,
      title: 'Bohemian Rhapsody',
      lengthMs: 354_000,
      disambiguation: 'single version',
      video: false,
      isrcs: ['GBUM71029604'],
      genres: ['rock'],
      artistCredit: [],
    });
  });

  it('keeps the artist credit in order, under the names it prints', () => {
    const rows = trackRowsFromRecording(
      recording({
        artistCredit: {
          name: 'Queen feat. David Bowie',
          artists: [
            {
              mbid: testMbid(70),
              name: 'Queen',
              creditedName: 'Queen',
              joinPhrase: ' feat. ',
            },
            {
              mbid: testMbid(71),
              name: 'David Bowie',
              creditedName: 'D. Bowie',
              joinPhrase: '',
            },
          ],
        },
      }),
    );

    expect(rows.track.artistCredit).toEqual([
      { name: 'Queen', joinPhrase: ' feat. ', mbid: testMbid(70) },
      { name: 'D. Bowie', joinPhrase: '', mbid: testMbid(71) },
    ]);
  });

  it('keeps one release row per release, in catalog order, with its year', () => {
    const rows = trackRowsFromRecording(
      recording({
        releases: [
          release(2, '1975-10-31'),
          release(1, null),
          // The same release again: the Recording sits on two of its tracks.
          release(2, '1975-10-31'),
        ],
      }),
    );

    expect(rows.releases).toEqual([
      {
        mbid: testMbid(102),
        title: 'Release 2',
        year: 1975,
        coverArtUrl: `https://coverartarchive.org/release/${testMbid(102)}/front-500`,
      },
      {
        mbid: testMbid(101),
        title: 'Release 1',
        year: null,
        coverArtUrl: `https://coverartarchive.org/release/${testMbid(101)}/front-500`,
      },
    ]);
  });

  it('reads the year of a partial date and keeps the release cover', () => {
    const [first] = trackRowsFromRecording(
      recording({ releases: [release(3, '1979')] }),
    ).releases;

    expect(first).toMatchObject({ year: 1979 });
    expect(first?.coverArtUrl).toContain(testMbid(103));
  });

  it('keeps each work once, by MBID, in catalog order', () => {
    const rows = trackRowsFromRecording(
      recording({
        works: [
          { mbid: testMbid(60), title: 'Work B' },
          { mbid: testMbid(61), title: 'Work A' },
          { mbid: testMbid(60), title: 'Work B' },
        ],
      }),
    );

    expect(rows.works).toEqual([
      { mbid: testMbid(60), title: 'Work B' },
      { mbid: testMbid(61), title: 'Work A' },
    ]);
  });

  it('keeps the tags as the catalog chose them', () => {
    const rows = trackRowsFromRecording(
      recording({
        tags: [
          { name: 'classic rock', count: 4 },
          { name: 'opera', count: 2 },
        ],
      }),
    );

    expect(rows.tags).toEqual([
      { name: 'classic rock', count: 4 },
      { name: 'opera', count: 2 },
    ]);
  });

  it('keeps each external link once, by link type and URL', () => {
    const link = {
      url: 'https://open.spotify.com/track/1',
      linkType: 'streaming music',
    };
    const rows = trackRowsFromRecording(
      recording({
        externalUrls: [
          link,
          { url: 'https://musicbrainz.org/recording/1', linkType: 'discogs' },
          link,
        ],
      }),
    );

    expect(rows.externalLinks).toEqual([
      { url: 'https://open.spotify.com/track/1', linkType: 'streaming music' },
      { url: 'https://musicbrainz.org/recording/1', linkType: 'discogs' },
    ]);
  });

  it('maps a Recording without any companion data to empty rows', () => {
    const rows = trackRowsFromRecording(
      recording({ genres: [], tags: [], tagsSource: null }),
    );

    expect(rows).toMatchObject({
      releases: [],
      works: [],
      tags: [],
      externalLinks: [],
      track: { genres: [] },
    });
  });
});
