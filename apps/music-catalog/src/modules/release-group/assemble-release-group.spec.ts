import {
  assembleReleaseGroup,
  firstReleaseYear,
  type ReleaseGroupParts,
} from './assemble-release-group.js';
import type {
  MediumTrackRow,
  ReleaseGroupRow,
  ReleaseWithEvents,
} from './release-group-data.js';

const MBID = '00000000-0000-4000-8000-000000000300';
const RELEASE = '00000000-0000-4000-8000-000000000200';
const QUEEN = '00000000-0000-4000-8000-000000000001';
const ROCK = '00000000-0000-4000-8000-000000000501';
const RECORDING_1 = '00000000-0000-4000-8000-000000000101';
const RECORDING_2 = '00000000-0000-4000-8000-000000000102';
const RECORDING_3 = '00000000-0000-4000-8000-000000000103';

const row: ReleaseGroupRow = {
  id: 7,
  mbid: MBID,
  title: 'A Night at the Opera',
  primaryType: 'Album',
  artistCreditId: 3,
  artistCreditName: 'Queen',
};

const release = (
  fields: Partial<ReleaseWithEvents> = {},
): ReleaseWithEvents => ({
  id: 1,
  mbid: RELEASE,
  title: 'A Night at the Opera',
  status: 'Official',
  events: [],
  ...fields,
});

const parts = (
  overrides: Partial<ReleaseGroupParts> = {},
): ReleaseGroupParts => ({
  row,
  artists: [],
  secondaryTypes: [],
  genres: [],
  releases: [],
  representative: undefined,
  media: [],
  ...overrides,
});

describe('firstReleaseYear', () => {
  it('is the earliest year of any release event, from every release', () => {
    const releases = [
      release({ id: 1, events: [{ year: 1985, month: 1, day: 1 }] }),
      release({
        id: 2,
        status: 'Bootleg',
        events: [{ year: 1975, month: null, day: null }],
      }),
      release({ id: 3, events: [{ year: null, month: null, day: null }] }),
    ];

    expect(firstReleaseYear(releases)).toBe(1975);
  });

  it('is null when no release event has a year', () => {
    expect(firstReleaseYear([release({ events: [] })])).toBeNull();
    expect(firstReleaseYear([])).toBeNull();
  });
});

describe('assembleReleaseGroup', () => {
  it('builds the header from the row, the artists, the types and the genres', () => {
    const result = assembleReleaseGroup(
      parts({
        artists: [
          {
            mbid: QUEEN,
            name: 'Queen',
            creditedName: 'Queen',
            joinPhrase: '',
          },
        ],
        secondaryTypes: ['Live'],
        genres: [
          { name: 'live', count: 9, genreMbid: null },
          { name: 'rock', count: 5, genreMbid: ROCK },
        ],
      }),
    );

    expect(result).toEqual({
      mbid: MBID,
      title: 'A Night at the Opera',
      primaryType: 'Album',
      secondaryTypes: ['Live'],
      firstReleaseYear: null,
      genres: [{ mbid: ROCK, name: 'rock', count: 5 }],
      artistCredit: {
        name: 'Queen',
        artists: [
          {
            mbid: QUEEN,
            name: 'Queen',
            creditedName: 'Queen',
            joinPhrase: '',
          },
        ],
      },
      coverArtUrl: `https://assets.vozzify.com/cover-art-archive/release-group/${MBID}/front-500`,
      representativeRelease: null,
    });
  });

  it('shows the representative release with its media, grouped and in position order', () => {
    const media: MediumTrackRow[] = [
      {
        mediumPosition: 1,
        mediumTitle: 'Side A',
        trackPosition: 1,
        recordingMbid: RECORDING_1,
      },
      {
        mediumPosition: 1,
        mediumTitle: 'Side A',
        trackPosition: 2,
        recordingMbid: RECORDING_2,
      },
      {
        mediumPosition: 2,
        mediumTitle: '',
        trackPosition: 1,
        recordingMbid: RECORDING_3,
      },
    ];
    const representative = release({ id: 1, title: 'Opera (2011)' });

    const result = assembleReleaseGroup(
      parts({ releases: [representative], representative, media }),
    );

    expect(result.representativeRelease).toEqual({
      mbid: RELEASE,
      title: 'Opera (2011)',
      media: [
        {
          position: 1,
          title: 'Side A',
          tracks: [
            { position: 1, recordingMbid: RECORDING_1 },
            { position: 2, recordingMbid: RECORDING_2 },
          ],
        },
        {
          position: 2,
          title: '',
          tracks: [{ position: 1, recordingMbid: RECORDING_3 }],
        },
      ],
    });
  });

  it('takes the first release year from the releases, not only the representative one', () => {
    const representative = release({
      id: 1,
      events: [{ year: 1991, month: null, day: null }],
    });
    const older = release({
      id: 2,
      status: 'Bootleg',
      events: [{ year: 1975, month: 11, day: 21 }],
    });

    const result = assembleReleaseGroup(
      parts({
        releases: [representative, older],
        representative,
      }),
    );

    expect(result.firstReleaseYear).toBe(1975);
  });
});
