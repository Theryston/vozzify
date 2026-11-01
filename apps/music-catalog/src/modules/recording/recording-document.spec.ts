import { RECORDINGS_INDEX_SETTINGS } from '../../lib/recordings-index.js';
import {
  artistNamesOf,
  buildDocuments,
  buildRecordingDocument,
  type DocumentParts,
} from './recording-document.js';
import type {
  BatchDetails,
  DocumentRecordingRow,
} from './recording-document-data.js';

const row: DocumentRecordingRow = {
  id: 7,
  mbid: '00000000-0000-4000-8000-000000000100',
  title: 'Yesterday',
  disambiguation: 'remastered',
  artistCreditId: 3,
  artistCreditName: 'The Beatles feat. Friends',
};

const parts = (overrides: Partial<DocumentParts> = {}): DocumentParts => ({
  artistNames: [],
  releaseTitles: [],
  workTitles: [],
  primaryReleaseMbid: null,
  tagLevels: { recording: [], release_group: [], artist: [] },
  ...overrides,
});

const genre = (name: string, count: number) => ({
  name,
  count,
  genreMbid: `00000000-0000-4000-8000-${name.padStart(12, '0')}`,
});

describe('buildRecordingDocument', () => {
  it('searches the title, the printed artist credit and the disambiguation as they are', () => {
    const document = buildRecordingDocument(row, parts());

    expect(document).toMatchObject({
      mbid: row.mbid,
      title: 'Yesterday',
      artistCredit: 'The Beatles feat. Friends',
      disambiguation: 'remastered',
    });
  });

  it('lists the artist names, release titles and Work titles once each, in a fixed order', () => {
    const document = buildRecordingDocument(
      row,
      parts({
        artistNames: ['The Beatles', 'Beatles, The', 'The Beatles', 'Fab Four'],
        releaseTitles: ['Help!', '1', 'Help!', 'Anthology 2'],
        workTitles: ['Yesterday', 'Yesterday'],
      }),
    );

    expect(document.artistAliases).toEqual([
      'Beatles, The',
      'Fab Four',
      'The Beatles',
    ]);
    expect(document.releaseTitles).toEqual(['1', 'Anthology 2', 'Help!']);
    expect(document.workTitles).toEqual(['Yesterday']);
  });

  it('leaves out names that are blank', () => {
    const document = buildRecordingDocument(
      row,
      parts({ artistNames: ['', '  ', 'Fab Four'], releaseTitles: [' '] }),
    );

    expect(document.artistAliases).toEqual(['Fab Four']);
    expect(document.releaseTitles).toEqual([]);
  });

  it('lists the genres of the level getRecording takes them from, most voted first', () => {
    const document = buildRecordingDocument(
      row,
      parts({
        tagLevels: {
          recording: [],
          release_group: [genre('folk', 2), genre('rock', 9)],
          artist: [genre('pop', 50)],
        },
      }),
    );

    expect(document.genres).toEqual(['rock', 'folk']);
  });

  it('has no genres when no level has one', () => {
    expect(buildRecordingDocument(row, parts()).genres).toEqual([]);
  });

  it('has every field the index searches', () => {
    const document = buildRecordingDocument(row, parts());

    for (const attribute of RECORDINGS_INDEX_SETTINGS.searchableAttributes) {
      expect(document).toHaveProperty(attribute);
    }
  });

  it('projects the business score only for an associated Track', () => {
    expect(
      buildRecordingDocument(
        { ...row, trackId: 'track-1', businessScore: 8 },
        parts(),
      ).businessScore,
    ).toBe(8);
    expect(buildRecordingDocument(row, parts()).businessScore).toBeNull();
  });

  it('holds nothing but the MBID and the fields the index searches', () => {
    const document = buildRecordingDocument(row, parts());

    expect(Object.keys(document).sort()).toEqual(
      [
        'mbid',
        'primaryReleaseMbid',
        'trackId',
        'businessScore',
        ...RECORDINGS_INDEX_SETTINGS.searchableAttributes,
      ].sort(),
    );
  });
});

describe('artistNamesOf', () => {
  const artistRow = (
    overrides: Partial<Parameters<typeof artistNamesOf>[0][number]> = {},
  ) => ({
    artistCreditId: 3,
    name: 'The Beatles',
    sortName: 'Beatles, The',
    aliasName: null,
    aliasSortName: null,
    ...overrides,
  });

  it('gives the name and the sort name of each artist', () => {
    expect(artistNamesOf([artistRow()])).toEqual([
      'The Beatles',
      'Beatles, The',
    ]);
  });

  it('adds the name and the sort name of every alias', () => {
    const names = artistNamesOf([
      artistRow({ aliasName: 'Fab Four', aliasSortName: 'Four, Fab' }),
      artistRow({ aliasName: 'Los Beatles', aliasSortName: 'Beatles, Los' }),
    ]);

    expect(names).toEqual(
      expect.arrayContaining([
        'The Beatles',
        'Beatles, The',
        'Fab Four',
        'Four, Fab',
        'Los Beatles',
        'Beatles, Los',
      ]),
    );
  });

  it('gives no names for no artists', () => {
    expect(artistNamesOf([])).toEqual([]);
  });
});

describe('buildDocuments', () => {
  const recordingRow = (
    overrides: Partial<DocumentRecordingRow>,
  ): DocumentRecordingRow => ({
    id: 1,
    mbid: 'mbid-1',
    title: 'Title',
    disambiguation: '',
    artistCreditId: 10,
    artistCreditName: 'Artist',
    ...overrides,
  });

  const details = (overrides: Partial<BatchDetails> = {}): BatchDetails => ({
    artistNames: [],
    releaseTitles: [],
    primaryReleases: [],
    workTitles: [],
    genres: { recording: [], releaseGroup: [], artist: [] },
    ...overrides,
  });

  it('builds one document per Recording, in the order of the rows', () => {
    const documents = buildDocuments(
      [
        recordingRow({ id: 1, mbid: 'one' }),
        recordingRow({ id: 2, mbid: 'two' }),
      ],
      details(),
    );

    expect(documents.map((document) => document.mbid)).toEqual(['one', 'two']);
  });

  it('gives each Recording only its own release and Work titles', () => {
    const documents = buildDocuments(
      [recordingRow({ id: 1 }), recordingRow({ id: 2, mbid: 'two' })],
      details({
        releaseTitles: [
          { recordingId: 1, title: 'Album of one' },
          { recordingId: 2, title: 'Album of two' },
        ],
        workTitles: [{ recordingId: 2, title: 'Work of two' }],
      }),
    );

    expect(documents[0]).toMatchObject({
      releaseTitles: ['Album of one'],
      workTitles: [],
    });
    expect(documents[1]).toMatchObject({
      releaseTitles: ['Album of two'],
      workTitles: ['Work of two'],
    });
  });

  it('gives Recordings that share an artist credit the same artist names, and no others', () => {
    const artistRow = (artistCreditId: number, name: string) => ({
      artistCreditId,
      name,
      sortName: name,
      aliasName: null,
      aliasSortName: null,
    });

    const documents = buildDocuments(
      [
        recordingRow({ id: 1, artistCreditId: 10 }),
        recordingRow({ id: 2, artistCreditId: 10 }),
        recordingRow({ id: 3, artistCreditId: 20 }),
      ],
      details({
        artistNames: [artistRow(10, 'First'), artistRow(20, 'Second')],
      }),
    );

    expect(documents.map((document) => document.artistAliases)).toEqual([
      ['First'],
      ['First'],
      ['Second'],
    ]);
  });

  it('takes each Recording’s genres from its own level, then its release groups’, then its artists’', () => {
    const vote = (name: string) => ({
      name,
      count: 3,
      genreMbid: `genre-${name}`,
    });
    const forRecording = (recordingId: number, name: string) => ({
      recordingId,
      ...vote(name),
    });
    const forCredit = (artistCreditId: number, name: string) => ({
      artistCreditId,
      ...vote(name),
    });

    const documents = buildDocuments(
      [
        recordingRow({ id: 1, artistCreditId: 10 }),
        recordingRow({ id: 2, artistCreditId: 20 }),
        recordingRow({ id: 3, artistCreditId: 30 }),
      ],
      details({
        genres: {
          recording: [forRecording(1, 'own')],
          releaseGroup: [forRecording(1, 'ignored'), forRecording(2, 'group')],
          artist: [
            forCredit(10, 'ignored-too'),
            forCredit(20, 'ignored-as-well'),
            forCredit(30, 'artist'),
          ],
        },
      }),
    );

    expect(documents.map((document) => document.genres)).toEqual([
      ['own'],
      ['group'],
      ['artist'],
    ]);
  });

  it('builds no documents for no Recordings', () => {
    expect(buildDocuments([], details())).toEqual([]);
  });
});
