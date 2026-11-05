import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { MusicCatalogReleaseGroup, Recording } from '@vozzify/contracts';
import {
  artistFixture,
  queenAndBowieCredit,
  releaseGroupFixture,
  representativeMedium,
} from '../../../test/utils/catalog-fixtures.js';
import { testMbid } from '../../../test/utils/factories.js';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { recordingFixture } from '../../../test/utils/recording-fixtures.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import { AlbumsService } from '../albums/albums.service.js';
import { ArtistsService } from '../artists/artists.service.js';
import { TrackAlbumCoverService } from '../tracks/track-album-cover.service.js';
import { TrackMetadataImportService } from './track-metadata-import.service.js';

// One import of a Track's Recording: the Artists it is credited to, and the
// Albums (release groups) it is on, each with its cover and its place. The
// catalog, the services that write and the cover archive are fakes at their
// boundaries; the transactions run on a stand-in client.

const RECORDING = testMbid(1);
const MERGED_RECORDING = testMbid(2);
const OTHER_RECORDING = testMbid(3);
const QUEEN = testMbid(41);
const BOWIE = testMbid(42);
const OPERA = testMbid(40);
const HITS = testMbid(50);

/** What the catalog answers for one `type:mbid`; an MBID with no answer is not known. */
type Answer =
  | { status: 'found'; entity: { mbid: string } }
  | { status: 'not-found' }
  | { status: 'moved'; newMbid: string };

const catalogAnswers = new Map<string, Answer>();
const answerKey = (type: string, mbid: string): string => `${type}:${mbid}`;

/** Makes the catalog know an entity under its MBID. */
const knowEntity = (type: string, entity: { mbid: string }): void => {
  catalogAnswers.set(answerKey(type, entity.mbid), {
    status: 'found',
    entity,
  });
};

const artistId = (mbid: string): string => `artist-${mbid}`;
const albumId = (mbid: string): string => `album-${mbid}`;

const catalog = { lookup: vi.fn() };
const artists = {
  upsertArtist: vi.fn(),
  linkTrackArtists: vi.fn(),
  replaceTrackArtistCreditResolutions: vi.fn(),
};
const albums = {
  upsertAlbum: vi.fn(),
  setAlbumCoverUrl: vi.fn(),
  replaceAlbumArtists: vi.fn(),
  upsertAlbumDiscs: vi.fn(),
  placeTrackOnAlbum: vi.fn(),
};
const covers = { storeCover: vi.fn() };

/** The messages the import logged as warnings. */
const warnings: string[] = [];

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A credit of one Artist, named as given. */
const soloCredit = (mbid: string, name: string): Recording['artistCredit'] => ({
  name,
  artists: [{ mbid, name, creditedName: name, joinPhrase: '' }],
});

/** The Recording's place on one release of an Album (the release itself is not used). */
const onRelease = (
  releaseGroupMbid: string,
  mediumPosition = 1,
  trackPosition = 1,
): Recording['releases'][number] => ({
  mbid: testMbid(31),
  title: 'A Night at the Opera',
  releaseGroup: { mbid: releaseGroupMbid, primaryType: 'Album' },
  status: 'Official',
  date: null,
  country: null,
  mediumPosition,
  trackPosition,
  coverArtUrl: `https://coverartarchive.org/release/${testMbid(31)}/front-500`,
});

/** The catalog knows the Recording on Opera alone, and Opera as the group given. */
const knowRecordingOnOpera = (
  group: MusicCatalogReleaseGroup = releaseGroupFixture({ mbid: OPERA }),
): void => {
  knowEntity(
    'getRecording',
    recordingFixture({ mbid: RECORDING, releases: [onRelease(OPERA)] }),
  );
  knowEntity('getReleaseGroup', group);
};

/** The catalog knows the Recording credited to Queen and David Bowie, on no Album. */
const knowQueenAndBowieRecording = (): void => {
  knowEntity(
    'getRecording',
    recordingFixture({
      mbid: RECORDING,
      artistCredit: queenAndBowieCredit(),
      releases: [],
    }),
  );
};

/**
 * Counts the calls held at once. Each call is held for a moment, so the peak
 * shows how many ran together.
 */
const gauge = () => {
  const usage = { active: 0, peak: 0 };
  const hold = async (): Promise<void> => {
    usage.active += 1;
    usage.peak = Math.max(usage.peak, usage.active);
    await pause(2);
    usage.active -= 1;
  };
  return { usage, hold };
};

describe('TrackMetadataImportService', () => {
  let service: TrackMetadataImportService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    catalogAnswers.clear();
    warnings.length = 0;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
    catalog.lookup.mockImplementation(
      async (type: string, mbid: string) =>
        catalogAnswers.get(answerKey(type, mbid)) ?? { status: 'not-found' },
    );
    artists.upsertArtist.mockImplementation(async (artist: { mbid: string }) =>
      artistId(artist.mbid),
    );
    artists.linkTrackArtists.mockResolvedValue(undefined);
    artists.replaceTrackArtistCreditResolutions.mockResolvedValue(undefined);
    albums.upsertAlbum.mockImplementation(async (album: { mbid: string }) => ({
      id: albumId(album.mbid),
      hasCover: false,
    }));
    albums.setAlbumCoverUrl.mockResolvedValue(undefined);
    albums.replaceAlbumArtists.mockResolvedValue(undefined);
    albums.upsertAlbumDiscs.mockResolvedValue(undefined);
    albums.placeTrackOnAlbum.mockResolvedValue(undefined);
    covers.storeCover.mockImplementation(
      async (id: string) => `https://cdn.test/${id}.webp`,
    );
    knowEntity('getArtist', artistFixture());
    knowEntity(
      'getArtist',
      artistFixture({ mbid: BOWIE, name: 'David Bowie' }),
    );

    const fake = fakeTransactionalDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        TrackMetadataImportService,
        { provide: MusicCatalogClient, useValue: catalog },
        { provide: ArtistsService, useValue: artists },
        { provide: AlbumsService, useValue: albums },
        { provide: TrackAlbumCoverService, useValue: covers },
      ],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(fake.pool)
      .overrideProvider(DATABASE)
      .useValue(fake.db)
      .compile();
    service = moduleRef.get(TrackMetadataImportService);
  });

  afterEach(async () => {
    await moduleRef.close();
    vi.restoreAllMocks();
  });

  it("links the Recording's Artists to the Track in credit order", async () => {
    knowQueenAndBowieRecording();

    const links = await service.importMetadata('track-1', RECORDING);

    expect(artists.linkTrackArtists).toHaveBeenCalledWith('track-1', [
      artistId(QUEEN),
      artistId(BOWIE),
    ]);
    expect(artists.replaceTrackArtistCreditResolutions).toHaveBeenCalledWith(
      'track-1',
      [
        { creditMbid: QUEEN, artistId: artistId(QUEEN) },
        { creditMbid: BOWIE, artistId: artistId(BOWIE) },
      ],
    );
    expect(links).toEqual({
      artistIds: [artistId(QUEEN), artistId(BOWIE)],
      albumIds: [],
    });
  });

  it('imports each Album of the Recording with its header, genres and credit', async () => {
    knowEntity(
      'getRecording',
      recordingFixture({ mbid: RECORDING, releases: [onRelease(OPERA)] }),
    );
    knowEntity(
      'getReleaseGroup',
      releaseGroupFixture({ mbid: OPERA, artistCredit: queenAndBowieCredit() }),
    );

    await service.importMetadata('track-1', RECORDING);

    expect(albums.upsertAlbum).toHaveBeenCalledWith({
      mbid: OPERA,
      title: 'A Night at the Opera',
      primaryType: 'Album',
      secondaryTypes: [],
      year: 1975,
      genres: ['rock'],
    });
    expect(albums.replaceAlbumArtists).toHaveBeenCalledWith(albumId(OPERA), [
      artistId(QUEEN),
      artistId(BOWIE),
    ]);
  });

  it('places the Track where the representative release has it, with that release discs', async () => {
    knowEntity(
      'getRecording',
      recordingFixture({ mbid: RECORDING, releases: [onRelease(OPERA, 1, 1)] }),
    );
    knowEntity(
      'getReleaseGroup',
      releaseGroupFixture({
        mbid: OPERA,
        representativeRelease: {
          mbid: testMbid(31),
          title: 'A Night at the Opera',
          media: [
            representativeMedium(1, '', [OTHER_RECORDING, RECORDING]),
            representativeMedium(2, 'Bonus', [OTHER_RECORDING]),
          ],
        },
      }),
    );

    await service.importMetadata('track-1', RECORDING);

    expect(albums.upsertAlbumDiscs).toHaveBeenCalledWith(albumId(OPERA), [
      { position: 1, title: null },
      { position: 2, title: 'Bonus' },
    ]);
    expect(albums.placeTrackOnAlbum).toHaveBeenCalledWith(
      albumId(OPERA),
      'track-1',
      { discPosition: 1, trackPosition: 2 },
    );
  });

  it("falls back to the Recording's own release, adding its disc, when the representative release lacks the Recording", async () => {
    knowEntity(
      'getRecording',
      recordingFixture({ mbid: RECORDING, releases: [onRelease(HITS, 2, 3)] }),
    );
    knowEntity(
      'getReleaseGroup',
      releaseGroupFixture({
        mbid: HITS,
        representativeRelease: {
          mbid: testMbid(33),
          title: 'Greatest Hits',
          media: [representativeMedium(1, '', [OTHER_RECORDING])],
        },
      }),
    );

    await service.importMetadata('track-1', RECORDING);

    expect(albums.upsertAlbumDiscs).toHaveBeenCalledWith(albumId(HITS), [
      { position: 1, title: null },
      { position: 2, title: null },
    ]);
    expect(albums.placeTrackOnAlbum).toHaveBeenCalledWith(
      albumId(HITS),
      'track-1',
      { discPosition: 2, trackPosition: 3 },
    );
  });

  it('fetches and writes each Artist once, however many credits name it', async () => {
    knowEntity(
      'getRecording',
      recordingFixture({
        mbid: RECORDING,
        artistCredit: queenAndBowieCredit(),
        releases: [onRelease(OPERA)],
      }),
    );
    knowEntity(
      'getReleaseGroup',
      releaseGroupFixture({ mbid: OPERA, artistCredit: queenAndBowieCredit() }),
    );

    await service.importMetadata('track-1', RECORDING);

    const queenLookups = catalog.lookup.mock.calls.filter(
      ([type, mbid]) => type === 'getArtist' && mbid === QUEEN,
    );
    const queenWrites = artists.upsertArtist.mock.calls.filter(
      ([artist]) => artist.mbid === QUEEN,
    );
    expect(queenLookups).toHaveLength(1);
    expect(queenWrites).toHaveLength(1);
  });

  it('stores the cover of an Album that has none yet, and records its URL', async () => {
    const group = releaseGroupFixture({ mbid: OPERA });
    knowRecordingOnOpera(group);

    await service.importMetadata('track-1', RECORDING);

    expect(covers.storeCover).toHaveBeenCalledWith(
      albumId(OPERA),
      group.coverArtUrl,
    );
    expect(albums.setAlbumCoverUrl).toHaveBeenCalledWith(
      albumId(OPERA),
      `https://cdn.test/${albumId(OPERA)}.webp`,
    );
  });

  it('does not download the cover of an Album that already has one', async () => {
    albums.upsertAlbum.mockImplementation(async (album: { mbid: string }) => ({
      id: albumId(album.mbid),
      hasCover: true,
    }));
    knowRecordingOnOpera();

    await service.importMetadata('track-1', RECORDING);

    expect(covers.storeCover).not.toHaveBeenCalled();
    expect(albums.setAlbumCoverUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTTP 503 from the archive', new Error('Image download failed')],
    [
      'a timeout',
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      ),
    ],
  ])(
    'leaves the Album without a cover when its download fails with %s, logs it, and still links the Album',
    async (_case, failure) => {
      covers.storeCover.mockRejectedValue(failure);
      knowRecordingOnOpera();

      const links = await service.importMetadata('track-1', RECORDING);

      expect(albums.setAlbumCoverUrl).not.toHaveBeenCalled();
      expect(albums.placeTrackOnAlbum).toHaveBeenCalledWith(
        albumId(OPERA),
        'track-1',
        { discPosition: 1, trackPosition: 1 },
      );
      expect(links.albumIds).toEqual([albumId(OPERA)]);
      expect(warnings.join('\n')).toContain(albumId(OPERA));
    },
  );

  it('leaves the Album without a cover when the archive has none for it', async () => {
    covers.storeCover.mockResolvedValue(undefined);
    knowRecordingOnOpera();

    const links = await service.importMetadata('track-1', RECORDING);

    expect(albums.setAlbumCoverUrl).not.toHaveBeenCalled();
    expect(links.albumIds).toEqual([albumId(OPERA)]);
  });

  it('follows a Recording the catalog merged into another MBID, once', async () => {
    catalogAnswers.set(answerKey('getRecording', RECORDING), {
      status: 'moved',
      newMbid: MERGED_RECORDING,
    });
    knowEntity(
      'getRecording',
      recordingFixture({
        mbid: MERGED_RECORDING,
        artistCredit: soloCredit(QUEEN, 'Queen'),
        releases: [],
      }),
    );

    await service.importMetadata('track-1', RECORDING);

    expect(catalog.lookup).toHaveBeenCalledWith('getRecording', RECORDING);
    expect(catalog.lookup).toHaveBeenCalledWith(
      'getRecording',
      MERGED_RECORDING,
    );
    expect(artists.linkTrackArtists).toHaveBeenCalledWith('track-1', [
      artistId(QUEEN),
    ]);
  });

  it('writes nothing for a Recording the catalog does not know', async () => {
    const links = await service.importMetadata('track-1', RECORDING);

    expect(links).toEqual({ artistIds: [], albumIds: [] });
    expect(artists.linkTrackArtists).not.toHaveBeenCalled();
    expect(albums.upsertAlbum).not.toHaveBeenCalled();
    expect(warnings.join('\n')).toContain(RECORDING);
  });

  it('leaves out an Album the catalog does not know, and keeps the others', async () => {
    knowEntity(
      'getRecording',
      recordingFixture({
        mbid: RECORDING,
        releases: [onRelease(OPERA), onRelease(HITS)],
      }),
    );
    knowEntity('getReleaseGroup', releaseGroupFixture({ mbid: OPERA }));

    const links = await service.importMetadata('track-1', RECORDING);

    expect(links.albumIds).toEqual([albumId(OPERA)]);
    expect(albums.upsertAlbum).toHaveBeenCalledTimes(1);
  });

  it('leaves out an Artist the catalog does not know, and keeps the rest of the credit', async () => {
    catalogAnswers.delete(answerKey('getArtist', BOWIE));
    knowQueenAndBowieRecording();

    const links = await service.importMetadata('track-1', RECORDING);

    expect(artists.linkTrackArtists).toHaveBeenCalledWith('track-1', [
      artistId(QUEEN),
    ]);
    expect(links.artistIds).toEqual([artistId(QUEEN)]);
  });

  it('throws a failed catalog call, so the job retries it, and links nothing', async () => {
    catalog.lookup.mockRejectedValue(new Error('catalog is down'));

    await expect(service.importMetadata('track-1', RECORDING)).rejects.toThrow(
      'catalog is down',
    );
    expect(artists.linkTrackArtists).not.toHaveBeenCalled();
  });

  it('runs at most four catalog lookups and four cover downloads at once for one import', async () => {
    const albumCount = 12;
    const releases: Recording['releases'] = [];
    for (let index = 0; index < albumCount; index += 1) {
      const groupMbid = testMbid(100 + index);
      const artistMbid = testMbid(200 + index);
      releases.push(onRelease(groupMbid));
      knowEntity(
        'getReleaseGroup',
        releaseGroupFixture({
          mbid: groupMbid,
          artistCredit: soloCredit(artistMbid, `Artist ${index}`),
        }),
      );
      knowEntity(
        'getArtist',
        artistFixture({ mbid: artistMbid, name: `Artist ${index}` }),
      );
    }
    knowEntity('getRecording', recordingFixture({ mbid: RECORDING, releases }));
    const lookups = gauge();
    const downloads = gauge();
    catalog.lookup.mockImplementation(async (type: string, mbid: string) => {
      await lookups.hold();
      return (
        catalogAnswers.get(answerKey(type, mbid)) ?? {
          status: 'not-found',
        }
      );
    });
    covers.storeCover.mockImplementation(async (id: string) => {
      await downloads.hold();
      return `https://cdn.test/${id}.webp`;
    });

    const links = await service.importMetadata('track-1', RECORDING);

    expect(lookups.usage.peak).toBe(4);
    expect(downloads.usage.peak).toBeLessThanOrEqual(4);
    expect(links.albumIds).toHaveLength(albumCount);
  });
});
