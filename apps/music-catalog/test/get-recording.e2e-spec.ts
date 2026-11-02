import { useTestServer } from './utils/create-test-server.js';
import { requestRecording } from './utils/get-recording-client.js';
import { addArtist, addIsrc, addRecording, mbid } from './utils/musicbrainz.js';
import {
  addExternalUrl,
  addGenre,
  addRelease,
  addTag,
  addTrack,
  addWork,
} from './utils/musicbrainz-relations.js';
import { useReadyCatalog } from './utils/use-ready-catalog.js';
import { useTestClient } from './utils/use-test-client.js';

describe('getRecording: the Recording (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);

  useReadyCatalog(server);

  it('returns the core fields of a Recording and its artist credit', async () => {
    const db = server().db;
    const simon = await addArtist(db, { name: 'Simon', mbid: mbid(1) });
    const garfunkel = await addArtist(db, { name: 'Garfunkel', mbid: mbid(2) });
    await addRecording(db, {
      mbid: mbid(100),
      name: 'The Sound of Silence',
      artists: [
        { artist: simon, creditedName: 'Paul Simon', joinPhrase: ' & ' },
        { artist: garfunkel },
      ],
      lengthMs: 185_000,
      disambiguation: 'single version',
      video: true,
    });

    const response = await requestRecording(client(), { mbid: mbid(100) });

    expect(response).toMatchObject({
      ok: true,
      result: {
        mbid: mbid(100),
        title: 'The Sound of Silence',
        lengthMs: 185_000,
        disambiguation: 'single version',
        video: true,
        artistCredit: {
          name: 'Paul Simon & Garfunkel',
          artists: [
            {
              mbid: mbid(1),
              name: 'Simon',
              creditedName: 'Paul Simon',
              joinPhrase: ' & ',
            },
            {
              mbid: mbid(2),
              name: 'Garfunkel',
              creditedName: 'Garfunkel',
              joinPhrase: '',
            },
          ],
        },
      },
    });
  });

  it('answers a Recording without a lyrics field', async () => {
    await addRecording(server().db, { mbid: mbid(100), name: 'Untitled' });

    const response = await requestRecording(client(), { mbid: mbid(100) });

    expect(response.ok).toBe(true);
    expect(response.ok && response.result).not.toHaveProperty('lyrics');
  });

  it('keeps every field when the catalog knows nothing more about the Recording', async () => {
    const artist = await addArtist(server().db, {
      name: 'Nobody',
      mbid: mbid(1),
    });
    await addRecording(server().db, {
      mbid: mbid(100),
      name: 'Untitled',
      artists: [{ artist }],
    });

    const response = await requestRecording(client(), { mbid: mbid(100) });

    expect(response).toEqual({
      id: expect.any(String),
      ok: true,
      result: {
        mbid: mbid(100),
        title: 'Untitled',
        lengthMs: null,
        disambiguation: '',
        video: false,
        isrcs: [],
        artistCredit: {
          name: 'Nobody',
          artists: [
            {
              mbid: mbid(1),
              name: 'Nobody',
              creditedName: 'Nobody',
              joinPhrase: '',
            },
          ],
        },
        releases: [],
        works: [],
        genres: [],
        tags: [],
        tagsSource: null,
        externalUrls: [],
      },
    });
  });

  it('returns everything known about a fully populated Recording', async () => {
    const db = server().db;
    const queen = await addArtist(db, { name: 'Queen', mbid: mbid(1) });
    const recording = await addRecording(db, {
      mbid: mbid(100),
      name: 'Bohemian Rhapsody',
      artists: [{ artist: queen }],
      lengthMs: 354_000,
      disambiguation: '2011 remaster',
    });
    await addIsrc(db, recording, 'GBUM71029604');
    await addIsrc(db, recording, 'GBUM71029601');
    const release = await addRelease(db, {
      mbid: mbid(200),
      releaseGroupMbid: mbid(300),
      name: 'A Night at the Opera',
      artistCredit: recording.artistCredit,
      primaryType: 'Album',
      status: 'Official',
      events: [{ country: 'GB', year: 1975, month: 11, day: 21 }],
    });
    await addTrack(db, { release, recording, mediumPosition: 1, position: 11 });
    await addWork(db, recording, {
      mbid: mbid(400),
      name: 'Bohemian Rhapsody (composition)',
    });
    await addExternalUrl(db, recording, {
      url: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
      linkType: 'free streaming',
    });
    await addGenre(db, { name: 'rock', mbid: mbid(500) });
    await addTag(db, { recording }, { name: 'rock', count: 12 });
    await addTag(db, { recording }, { name: 'operatic', count: 3 });

    const response = await requestRecording(client(), { mbid: mbid(100) });

    expect(response).toMatchObject({ ok: true });
    expect(response.ok && response.result).toEqual({
      mbid: mbid(100),
      title: 'Bohemian Rhapsody',
      lengthMs: 354_000,
      disambiguation: '2011 remaster',
      video: false,
      isrcs: ['GBUM71029601', 'GBUM71029604'],
      artistCredit: {
        name: 'Queen',
        artists: [
          {
            mbid: mbid(1),
            name: 'Queen',
            creditedName: 'Queen',
            joinPhrase: '',
          },
        ],
      },
      releases: [
        {
          mbid: mbid(200),
          title: 'A Night at the Opera',
          releaseGroup: { mbid: mbid(300), primaryType: 'Album' },
          status: 'Official',
          date: '1975-11-21',
          country: 'GB',
          mediumPosition: 1,
          trackPosition: 11,
          coverArtUrl: `https://assets.vozzify.com/cover-art-archive/release/${mbid(200)}/front-500`,
        },
      ],
      works: [{ mbid: mbid(400), title: 'Bohemian Rhapsody (composition)' }],
      genres: [{ mbid: mbid(500), name: 'rock', count: 12 }],
      tags: [{ name: 'operatic', count: 3 }],
      tagsSource: 'recording',
      externalUrls: [
        {
          url: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
          linkType: 'free streaming',
        },
      ],
    });
  });

  it('answers many requests in flight on one connection', async () => {
    const db = server().db;
    for (const n of [1, 2, 3]) {
      await addRecording(db, { mbid: mbid(100 + n), name: `Song ${n}` });
    }

    const responses = await Promise.all(
      [1, 2, 3].map((n) => requestRecording(client(), { mbid: mbid(100 + n) })),
    );

    expect(responses.map((r) => r.ok && r.result.title)).toEqual([
      'Song 1',
      'Song 2',
      'Song 3',
    ]);
  });
});
