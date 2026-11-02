import { useTestServer } from './utils/create-test-server.js';
import { requestReleaseGroup } from './utils/get-release-group-client.js';
import { addArtist, addRecording, mbid } from './utils/musicbrainz.js';
import {
  addGenre,
  addRelease,
  addReleaseGroupRedirect,
  addSecondaryType,
  addTag,
  addTrack,
} from './utils/musicbrainz-relations.js';
import { useReadyCatalog } from './utils/use-ready-catalog.js';
import { useTestClient } from './utils/use-test-client.js';

const coverOf = (releaseGroupMbid: string): string =>
  `https://assets.vozzify.com/cover-art-archive/release-group/${releaseGroupMbid}/front-500`;

describe('getReleaseGroup: the release group (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);

  useReadyCatalog(server);

  it('returns the header of a release group with its artists, types, genres and first year', async () => {
    const db = server().db;
    const queen = await addArtist(db, { name: 'Queen', mbid: mbid(1) });
    const recording = await addRecording(db, {
      mbid: mbid(100),
      name: 'Bohemian Rhapsody',
      artists: [{ artist: queen }],
    });
    const release = await addRelease(db, {
      mbid: mbid(200),
      releaseGroupMbid: mbid(300),
      name: 'A Night at the Opera',
      artistCredit: recording.artistCredit,
      primaryType: 'Album',
      status: 'Official',
      events: [{ country: 'GB', year: 1975, month: 11, day: 21 }],
    });
    await addSecondaryType(db, release.releaseGroup, 'Compilation');
    await addSecondaryType(db, release.releaseGroup, 'Live');
    await addGenre(db, { name: 'rock', mbid: mbid(500) });
    await addTag(
      db,
      { releaseGroup: release.releaseGroup },
      { name: 'rock', count: 5 },
    );
    await addTag(
      db,
      { releaseGroup: release.releaseGroup },
      { name: 'live', count: 9 },
    );

    const response = await requestReleaseGroup(client(), { mbid: mbid(300) });

    expect(response).toEqual({
      id: expect.any(String),
      ok: true,
      result: {
        mbid: mbid(300),
        title: 'A Night at the Opera',
        primaryType: 'Album',
        secondaryTypes: ['Compilation', 'Live'],
        firstReleaseYear: 1975,
        genres: [{ mbid: mbid(500), name: 'rock', count: 5 }],
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
        coverArtUrl: coverOf(mbid(300)),
        representativeRelease: {
          mbid: mbid(200),
          title: 'A Night at the Opera',
          media: [],
        },
      },
    });
  });

  it('lists the media of the representative release, each track with its Recording', async () => {
    const db = server().db;
    const queen = await addArtist(db, { name: 'Queen', mbid: mbid(1) });
    const first = await addRecording(db, {
      mbid: mbid(100),
      name: 'Side one',
      artists: [{ artist: queen }],
    });
    const second = await addRecording(db, {
      mbid: mbid(101),
      name: 'Side two',
      artists: [{ artist: queen }],
    });
    const release = await addRelease(db, {
      mbid: mbid(200),
      releaseGroupMbid: mbid(300),
      name: 'A Night at the Opera',
      artistCredit: first.artistCredit,
      status: 'Official',
    });
    await addTrack(db, {
      release,
      recording: second,
      mediumPosition: 2,
      position: 1,
      mediumTitle: 'Bonus',
    });
    await addTrack(db, {
      release,
      recording: first,
      mediumPosition: 1,
      position: 1,
      mediumTitle: 'Side A',
    });

    const response = await requestReleaseGroup(client(), { mbid: mbid(300) });

    expect(response).toMatchObject({
      ok: true,
      result: {
        representativeRelease: {
          media: [
            {
              position: 1,
              title: 'Side A',
              tracks: [{ position: 1, recordingMbid: mbid(100) }],
            },
            {
              position: 2,
              title: 'Bonus',
              tracks: [{ position: 1, recordingMbid: mbid(101) }],
            },
          ],
        },
      },
    });
  });

  it('chooses the same representative release on every call: the earliest Official one, ties by MBID', async () => {
    const db = server().db;
    const queen = await addArtist(db, { name: 'Queen', mbid: mbid(1) });
    const recording = await addRecording(db, {
      mbid: mbid(100),
      name: 'Bohemian Rhapsody',
      artists: [{ artist: queen }],
    });
    const common = {
      artistCredit: recording.artistCredit,
      name: 'A Night at the Opera',
      status: 'Official',
    };
    // The three releases share one release group: the fixture inserts a new
    // release group per call unless it is given one.
    const { releaseGroup } = await addRelease(db, {
      ...common,
      releaseGroupMbid: mbid(300),
      mbid: mbid(220),
      events: [{ country: 'GB', year: 1980 }],
    });
    await addRelease(db, {
      ...common,
      releaseGroup,
      mbid: mbid(205),
      events: [{ country: 'US', year: 1980 }],
    });
    await addRelease(db, {
      ...common,
      releaseGroup,
      mbid: mbid(201),
      status: 'Bootleg',
      events: [{ year: 1970 }],
    });

    const first = await requestReleaseGroup(client(), {
      mbid: mbid(300),
    });
    const second = await requestReleaseGroup(client(), {
      mbid: mbid(300),
    });

    expect(first).toMatchObject({
      ok: true,
      result: {
        representativeRelease: { mbid: mbid(205) },
        firstReleaseYear: 1970,
      },
    });
    // Each request has its own id, so the two answers are compared by result.
    expect(second).toMatchObject({
      ok: true,
      result: first.ok ? first.result : undefined,
    });
  });

  it('falls back to the earliest release of any status when no release of the group is Official', async () => {
    const db = server().db;
    const queen = await addArtist(db, { name: 'Queen', mbid: mbid(1) });
    const recording = await addRecording(db, {
      mbid: mbid(100),
      name: 'Bohemian Rhapsody',
      artists: [{ artist: queen }],
    });
    await addRelease(db, {
      mbid: mbid(200),
      releaseGroupMbid: mbid(300),
      name: 'A Night at the Opera',
      artistCredit: recording.artistCredit,
      status: 'Bootleg',
      events: [{ year: 1974 }],
    });

    const response = await requestReleaseGroup(client(), { mbid: mbid(300) });

    expect(response).toMatchObject({
      ok: true,
      result: {
        representativeRelease: {
          mbid: mbid(200),
          title: 'A Night at the Opera',
          media: [],
        },
        firstReleaseYear: 1974,
      },
    });
  });

  it('keeps every field when the catalog knows nothing more about the release group', async () => {
    const db = server().db;
    const artist = await addArtist(db, { name: 'Nobody', mbid: mbid(1) });
    const recording = await addRecording(db, {
      mbid: mbid(100),
      name: 'Untitled',
      artists: [{ artist }],
    });
    await addRelease(db, {
      mbid: mbid(200),
      releaseGroupMbid: mbid(300),
      name: 'Untitled',
      artistCredit: recording.artistCredit,
    });

    const response = await requestReleaseGroup(client(), { mbid: mbid(300) });

    expect(response).toEqual({
      id: expect.any(String),
      ok: true,
      result: {
        mbid: mbid(300),
        title: 'Untitled',
        primaryType: null,
        secondaryTypes: [],
        firstReleaseYear: null,
        genres: [],
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
        coverArtUrl: coverOf(mbid(300)),
        // The only release is the fallback: it has no status, not even Official.
        representativeRelease: {
          mbid: mbid(200),
          title: 'Untitled',
          media: [],
        },
      },
    });
  });

  it('answers RELEASE_GROUP_NOT_FOUND for an MBID it does not know', async () => {
    const response = await requestReleaseGroup(client(), { mbid: mbid(404) });

    expect(response).toEqual({
      id: expect.any(String),
      ok: false,
      error: {
        code: 'RELEASE_GROUP_NOT_FOUND',
        message: `No release group has the MBID ${mbid(404)}`,
      },
    });
  });

  it('answers RELEASE_GROUP_MOVED with the new MBID for a release group MusicBrainz merged', async () => {
    const db = server().db;
    const queen = await addArtist(db, { name: 'Queen', mbid: mbid(1) });
    const recording = await addRecording(db, {
      mbid: mbid(100),
      name: 'Bohemian Rhapsody',
      artists: [{ artist: queen }],
    });
    const release = await addRelease(db, {
      mbid: mbid(200),
      releaseGroupMbid: mbid(300),
      name: 'A Night at the Opera',
      artistCredit: recording.artistCredit,
    });
    await addReleaseGroupRedirect(db, mbid(301), release.releaseGroup);

    const response = await requestReleaseGroup(client(), { mbid: mbid(301) });

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'RELEASE_GROUP_MOVED', newMbid: mbid(300) },
    });
  });

  it.each([
    ['no payload', undefined],
    ['an MBID that is not a UUID', { mbid: 'night' }],
  ])('answers VALIDATION_FAILED for %s', async (_label, payload) => {
    const response = await requestReleaseGroup(client(), payload);

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});
