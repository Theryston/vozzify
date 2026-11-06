import { assembleRecording } from './assemble-recording.js';
import type {
  RecordingDetails,
  RecordingRow,
  ReleaseEventRow,
  ReleaseRow,
} from './recording-data.js';

const recording: RecordingRow = {
  id: 1,
  mbid: '00000000-0000-4000-8000-000000000001',
  title: 'Don’t',
  lengthMs: null,
  disambiguation: '',
  video: false,
  artistCreditId: 1,
  artistCreditName: 'Ed Sheeran',
};

const release = (id: number, fields: Partial<ReleaseRow> = {}): ReleaseRow => ({
  id,
  mbid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  title: '×',
  releaseGroupMbid: '00000000-0000-4000-8000-000000000100',
  primaryType: 'Album',
  status: 'Official',
  mediumPosition: 1,
  trackPosition: 1,
  coverRank: 0,
  ...fields,
});

const event = (
  releaseId: number,
  date: { year: number; month?: number; day?: number },
): ReleaseEventRow => ({
  releaseId,
  country: null,
  year: date.year,
  month: date.month ?? null,
  day: date.day ?? null,
});

const assemble = (releases: ReleaseRow[], releaseEvents: ReleaseEventRow[]) => {
  const details: RecordingDetails = {
    artists: [],
    isrcs: [],
    releases,
    releaseEvents,
    works: [],
    externalUrls: [],
    tagLevels: { recording: [], release_group: [], artist: [] },
  };
  return assembleRecording(recording, details).releases;
};

describe('the primary release used for Recording covers', () => {
  it.each([
    ['a compilation', 4],
    ['a release without a credited artist in common', 2],
    ['a non-Official release', 1],
  ])(
    'prefers an artist’s Official release over %s with an earlier date',
    (_, coverRank) => {
      const releases = assemble(
        [release(1, { title: 'Bravo Hits 87', coverRank }), release(2)],
        [event(1, { year: 2014 }), event(2, { year: 2014, month: 6, day: 20 })],
      );

      expect(releases.map((item) => item.mbid)).toEqual([
        release(2).mbid,
        release(1).mbid,
      ]);
      expect(releases[0]).not.toHaveProperty('coverRank');
    },
  );

  it('does not treat an incomplete year as earlier than a known day in that year', () => {
    const releases = assemble(
      [release(1, { title: 'A year-only edition' }), release(2)],
      [event(1, { year: 2014 }), event(2, { year: 2014, month: 6, day: 20 })],
    );

    expect(releases[0]?.mbid).toBe(release(2).mbid);
    expect(releases[1]?.date).toBe('2014');
  });

  it('does not treat an incomplete month as earlier than a known day in that month', () => {
    const releases = assemble(
      [release(1), release(2)],
      [
        event(1, { year: 2014, month: 6 }),
        event(2, { year: 2014, month: 6, day: 20 }),
      ],
    );

    expect(releases[0]?.mbid).toBe(release(2).mbid);
    expect(releases[1]?.date).toBe('2014-06');
  });

  it('keeps earlier years and months ahead of later periods', () => {
    const releases = assemble(
      [release(1), release(2), release(3)],
      [
        event(1, { year: 2014, month: 6, day: 20 }),
        event(2, { year: 2013 }),
        event(3, { year: 2014, month: 5 }),
      ],
    );

    expect(releases.map((item) => item.mbid)).toEqual(
      [2, 3, 1].map((id) => release(id).mbid),
    );
  });

  it('uses the earliest confirmed event even when the display event has only a year', () => {
    const releases = assemble(
      [release(1), release(2)],
      [
        event(1, { year: 2014 }),
        event(1, { year: 2014, month: 1, day: 1 }),
        event(2, { year: 2014, month: 6, day: 20 }),
      ],
    );

    expect(releases[0]?.mbid).toBe(release(1).mbid);
    expect(releases[0]?.date).toBe('2014');
    expect(releases[0]).not.toHaveProperty('coverDate');
  });

  it('retains a usable fallback when only compilations contain the Recording', () => {
    const releases = assemble(
      [release(1, { coverRank: 6 }), release(2, { coverRank: 6 })],
      [event(1, { year: 2015 }), event(2, { year: 2014 })],
    );

    expect(releases[0]?.mbid).toBe(release(2).mbid);
    expect(releases[0]?.coverArtUrl).toBe(
      `https://assets.vozzify.com/cover-art-archive/release/${release(2).mbid}/front-500`,
    );
  });

  it('puts undated releases last within a preference and breaks ties deterministically', () => {
    const releases = assemble(
      [
        release(5, { title: 'A undated' }),
        release(4, { title: 'B same day' }),
        release(3, { trackPosition: 2 }),
        release(2),
        release(3, { mediumPosition: 2 }),
        release(3, { trackPosition: 1 }),
      ],
      [2, 3, 4].map((id) => event(id, { year: 2014, month: 6, day: 20 })),
    );

    expect(
      releases.map((item) => [
        item.mbid,
        item.mediumPosition,
        item.trackPosition,
      ]),
    ).toEqual([
      [release(4).mbid, 1, 1],
      [release(2).mbid, 1, 1],
      [release(3).mbid, 1, 1],
      [release(3).mbid, 1, 2],
      [release(3).mbid, 2, 1],
      [release(5).mbid, 1, 1],
    ]);
  });
});
