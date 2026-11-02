import { assembleRecording } from './assemble-recording.js';
import type {
  RecordingDetails,
  RecordingRow,
  ReleaseEventRow,
  ReleaseRow,
} from './recording-data.js';

const row: RecordingRow = {
  id: 7,
  mbid: '00000000-0000-4000-8000-000000000100',
  title: 'Song',
  lengthMs: 200_000,
  disambiguation: 'live',
  video: true,
  artistCreditId: 3,
  artistCreditName: 'A & B',
};

const details = (
  overrides: Partial<RecordingDetails> = {},
): RecordingDetails => ({
  artists: [],
  isrcs: [],
  releases: [],
  releaseEvents: [],
  works: [],
  externalUrls: [],
  tagLevels: { recording: [], release_group: [], artist: [] },
  ...overrides,
});

const release = (n: number, fields: Partial<ReleaseRow> = {}): ReleaseRow => ({
  id: n,
  mbid: `00000000-0000-4000-8000-00000000020${n}`,
  title: `Release ${n}`,
  releaseGroupMbid: `00000000-0000-4000-8000-00000000030${n}`,
  primaryType: 'Album',
  status: 'Official',
  mediumPosition: 1,
  trackPosition: 1,
  ...fields,
});

const event = (
  releaseId: number,
  fields: Partial<ReleaseEventRow>,
): ReleaseEventRow => ({
  releaseId,
  country: null,
  year: null,
  month: null,
  day: null,
  ...fields,
});

describe('assembleRecording', () => {
  it('copies the core fields and the artist credit', () => {
    const artists = [
      { mbid: 'a1', name: 'A', creditedName: 'A.', joinPhrase: ' & ' },
      { mbid: 'a2', name: 'B', creditedName: 'B', joinPhrase: '' },
    ];

    const recording = assembleRecording(row, details({ artists }));

    expect(recording).toMatchObject({
      mbid: row.mbid,
      title: 'Song',
      lengthMs: 200_000,
      disambiguation: 'live',
      video: true,
      artistCredit: { name: 'A & B', artists },
    });
  });

  it('passes on ISRCs, works and external URLs', () => {
    const given = details({
      isrcs: ['GBUM71029604'],
      works: [{ mbid: 'w1', title: 'Work' }],
      externalUrls: [{ url: 'https://example.com/a', linkType: 'streaming' }],
    });

    expect(assembleRecording(row, given)).toMatchObject({
      isrcs: given.isrcs,
      works: given.works,
      externalUrls: given.externalUrls,
    });
  });

  it('gives each release its own earliest event, its cover art and its positions', () => {
    const recording = assembleRecording(
      row,
      details({
        releases: [
          release(1, { mediumPosition: 2, trackPosition: 5 }),
          release(2, { primaryType: null, status: null }),
        ],
        releaseEvents: [
          event(1, { country: 'US', year: 2000, month: 1 }),
          event(1, { country: 'GB', year: 1999 }),
          event(2, { country: 'FR', year: 2010, month: 5, day: 2 }),
        ],
      }),
    );

    expect(recording.releases).toEqual([
      {
        mbid: release(1).mbid,
        title: 'Release 1',
        releaseGroup: {
          mbid: release(1).releaseGroupMbid,
          primaryType: 'Album',
        },
        status: 'Official',
        date: '1999',
        country: 'GB',
        mediumPosition: 2,
        trackPosition: 5,
        coverArtUrl: `https://assets.vozzify.com/cover-art-archive/release/${release(1).mbid}/front-500`,
      },
      {
        mbid: release(2).mbid,
        title: 'Release 2',
        releaseGroup: { mbid: release(2).releaseGroupMbid, primaryType: null },
        status: null,
        date: '2010-05-02',
        country: 'FR',
        mediumPosition: 1,
        trackPosition: 1,
        coverArtUrl: `https://assets.vozzify.com/cover-art-archive/release/${release(2).mbid}/front-500`,
      },
    ]);
  });

  it('leaves a release without events undated and without a country', () => {
    const recording = assembleRecording(
      row,
      details({
        releases: [release(1)],
        releaseEvents: [event(2, { country: 'FR', year: 2010 })],
      }),
    );

    expect(recording.releases[0]).toMatchObject({ date: null, country: null });
  });

  it('orders releases oldest first, undated last, then by title, MBID and position', () => {
    const recording = assembleRecording(
      row,
      details({
        releases: [
          release(1, { title: 'Undated' }),
          release(2, { title: 'B same day' }),
          release(3, { title: 'A same day' }),
          release(4, { title: 'Oldest' }),
          release(5, { title: 'A same day', trackPosition: 2 }),
          release(6, { title: 'A same day', trackPosition: 1 }),
        ],
        releaseEvents: [
          event(2, { year: 2000 }),
          event(3, { year: 2000 }),
          event(4, { year: 1990 }),
          event(5, { year: 2000 }),
          event(6, { year: 2000 }),
        ],
      }),
    );

    expect(recording.releases.map((r) => r.mbid)).toEqual(
      [4, 3, 5, 6, 2, 1].map((n) => release(n).mbid),
    );
  });

  it('puts a release on two tracks in track order', () => {
    const same = { id: 1, mbid: release(1).mbid, title: 'Twice' };
    const recording = assembleRecording(
      row,
      details({
        releases: [
          release(1, { ...same, mediumPosition: 2, trackPosition: 1 }),
          release(1, { ...same, mediumPosition: 1, trackPosition: 9 }),
          release(1, { ...same, mediumPosition: 1, trackPosition: 3 }),
        ],
      }),
    );

    expect(
      recording.releases.map((r) => [r.mediumPosition, r.trackPosition]),
    ).toEqual([
      [1, 3],
      [1, 9],
      [2, 1],
    ]);
  });

  it('takes genres, tags and their source from the genre fallback', () => {
    const recording = assembleRecording(
      row,
      details({
        tagLevels: {
          recording: [],
          release_group: [
            { name: 'rock', count: 4, genreMbid: 'g1' },
            { name: 'live', count: 1, genreMbid: null },
          ],
          artist: [],
        },
      }),
    );

    expect(recording).toMatchObject({
      tagsSource: 'release_group',
      genres: [{ mbid: 'g1', name: 'rock', count: 4 }],
      tags: [{ name: 'live', count: 1 }],
    });
  });
});
