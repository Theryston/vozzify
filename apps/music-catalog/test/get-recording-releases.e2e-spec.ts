import type { Recording } from '@vozzify/contracts';
import { useTestServer } from './utils/create-test-server.js';
import { requestRecording } from './utils/get-recording-client.js';
import {
  addRecording,
  type FixtureRecording,
  mbid,
} from './utils/musicbrainz.js';
import {
  addRelease,
  addTrack,
  type ReleaseInput,
} from './utils/musicbrainz-relations.js';
import { useReadyCatalog } from './utils/use-ready-catalog.js';
import { useTestClient } from './utils/use-test-client.js';

describe('getRecording: releases, works and links (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);

  useReadyCatalog(server);

  const recordingOf = async (): Promise<FixtureRecording> =>
    addRecording(server().db, { mbid: mbid(100), name: 'Song' });

  const releasesOf = async (): Promise<Recording['releases']> => {
    const response = await requestRecording(client(), { mbid: mbid(100) });
    if (!response.ok) {
      throw new Error(`Unexpected failure: ${response.error.code}`);
    }
    return response.result.releases;
  };

  // A release the Recording is on, at the first track of the first medium.
  const releaseWith = async (
    recording: FixtureRecording,
    input: Omit<ReleaseInput, 'artistCredit'>,
    track: { mediumPosition?: number; position?: number } = {},
  ): Promise<void> => {
    const release = await addRelease(server().db, {
      ...input,
      artistCredit: recording.artistCredit,
    });
    await addTrack(server().db, { release, recording, ...track });
  };

  it('lists every release the Recording is on, oldest first, undated last', async () => {
    const recording = await recordingOf();
    await releaseWith(recording, { name: 'Undated', mbid: mbid(201) });
    await releaseWith(recording, {
      name: 'Reissue',
      mbid: mbid(202),
      events: [{ country: 'US', year: 2011 }],
    });
    await releaseWith(recording, {
      name: 'Original',
      mbid: mbid(203),
      events: [{ country: 'GB', year: 1975, month: 11, day: 21 }],
    });

    const releases = await releasesOf();

    expect(releases.map((release) => release.title)).toEqual([
      'Original',
      'Reissue',
      'Undated',
    ]);
  });

  it('shows a release with its earliest release event, keeping the precision of the date', async () => {
    const recording = await recordingOf();
    await releaseWith(recording, {
      name: 'Worldwide',
      mbid: mbid(201),
      events: [
        { country: 'US', year: 1976, month: 2 },
        { country: 'GB', year: 1975 },
        { country: 'JP', year: 1975, month: 6, day: 1 },
      ],
    });

    const [release] = await releasesOf();

    expect(release).toMatchObject({ date: '1975', country: 'GB' });
  });

  it('uses the event of an unknown country when it is the earliest', async () => {
    const recording = await recordingOf();
    await releaseWith(recording, {
      name: 'Somewhere',
      mbid: mbid(201),
      events: [
        { year: 1970, month: 3 },
        { country: 'FR', year: 1980 },
      ],
    });

    const [release] = await releasesOf();

    expect(release).toMatchObject({ date: '1970-03', country: null });
  });

  it('answers a release with no event or type with nulls', async () => {
    const recording = await recordingOf();
    await releaseWith(recording, { name: 'Bare', mbid: mbid(201) });

    const [release] = await releasesOf();

    expect(release).toMatchObject({
      date: null,
      country: null,
      status: null,
      releaseGroup: { primaryType: null },
    });
  });

  it('gives the position of the Recording on its medium and track', async () => {
    const recording = await recordingOf();
    await releaseWith(
      recording,
      { name: 'Box set', mbid: mbid(201) },
      { mediumPosition: 3, position: 7 },
    );

    const [release] = await releasesOf();

    expect(release).toMatchObject({ mediumPosition: 3, trackPosition: 7 });
  });

  it('lists a release once per track the Recording is on', async () => {
    const recording = await recordingOf();
    const release = await addRelease(server().db, {
      name: 'Twice',
      mbid: mbid(201),
      artistCredit: recording.artistCredit,
    });
    await addTrack(server().db, { release, recording, position: 4 });
    await addTrack(server().db, { release, recording, position: 9 });

    const releases = await releasesOf();

    expect(releases.map((r) => r.trackPosition)).toEqual([4, 9]);
  });

  it('builds the cover art URL from the release MBID', async () => {
    const recording = await recordingOf();
    await releaseWith(recording, { name: 'Covered', mbid: mbid(201) });

    const [release] = await releasesOf();

    expect(release?.coverArtUrl).toBe(
      `https://assets.vozzify.com/cover-art-archive/release/${mbid(201)}/front-500`,
    );
  });

  it('does not list releases of other Recordings', async () => {
    const recording = await recordingOf();
    const other = await addRecording(server().db, {
      mbid: mbid(101),
      name: 'Other',
    });
    await releaseWith(recording, { name: 'Mine', mbid: mbid(201) });
    await releaseWith(other, { name: 'Theirs', mbid: mbid(202) });

    const releases = await releasesOf();

    expect(releases.map((release) => release.title)).toEqual(['Mine']);
  });
});
