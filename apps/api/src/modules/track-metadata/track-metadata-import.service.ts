import { Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type {
  Mbid,
  MusicCatalogReleaseGroup,
  Recording,
} from '@vozzify/contracts';
import {
  type CatalogEntity,
  type CatalogLookupType,
  MusicCatalogClient,
} from '../../integrations/music-catalog/music-catalog.client.js';
import { AlbumsService } from '../albums/albums.service.js';
import { ArtistsService } from '../artists/artists.service.js';
import { TrackAlbumCoverService } from '../tracks/track-album-cover.service.js';
import { createLimiter, type Limiter } from './track-metadata-limiter.js';
import {
  type AlbumPlacement,
  albumLayoutOf,
} from './track-metadata-placement.js';

/** The Artists and Albums an import linked a Track to: the rows it now shows on. */
export type ImportedLinks = { artistIds: string[]; albumIds: string[] };

const NOTHING_LINKED: ImportedLinks = { artistIds: [], albumIds: [] };

/**
 * How many catalog lookups, and how many cover downloads, one import runs at
 * once. Each import has its own limiters, so this bounds one job.
 */
const CONCURRENCY = 4;

/** The Artist IDs of one import run, by MBID, so each Artist is fetched once. */
type ArtistMemo = Map<string, Promise<string | undefined>>;

/** What one import run shares between its steps. */
type ImportRun = {
  trackId: string;
  artists: ArtistMemo;
  /** Runs one catalog lookup at a time within the bound. */
  catalog: Limiter;
  /** Runs one cover download at a time within the bound. */
  covers: Limiter;
};

/** What one Album's writes need, in one object (too many for positional params). */
type AlbumLink = {
  albumId: string;
  trackId: string;
  recordingMbid: string;
  ownPlacements: AlbumPlacement[];
  group: MusicCatalogReleaseGroup;
  artistIds: string[];
};

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

/** The distinct values, in the order they first appear. */
const distinct = (values: readonly string[]): string[] => [...new Set(values)];

/** The release groups a Recording is on, each once, in the order its releases list them. */
const releaseGroupsOf = (recording: Recording): string[] =>
  distinct(recording.releases.map((release) => release.releaseGroup.mbid));

/** Where the Recording sits on its own releases within one release group. */
const ownPlacementsIn = (
  recording: Recording,
  groupMbid: string,
): AlbumPlacement[] =>
  recording.releases
    .filter((release) => release.releaseGroup.mbid === groupMbid)
    .map((release) => ({
      discPosition: release.mediumPosition,
      trackPosition: release.trackPosition,
    }));

/** A failure as text, for a log line. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Imports the Artists and Albums of a Track's Recording from the Music catalog
 * (ADR 0003 and ADR 0005). The rows are written through the Artists and Albums
 * services, so each module keeps its own tables. Idempotent: every write
 * upserts or replaces, so a repeated run lands on the same rows. A catalog
 * answer that is neither a result nor a merge is skipped with a log line; a
 * failed catalog call throws, and the job retries it.
 */
@Injectable()
export class TrackMetadataImportService {
  private readonly logger = new Logger(TrackMetadataImportService.name);

  constructor(
    private readonly catalog: MusicCatalogClient,
    private readonly artists: ArtistsService,
    private readonly albums: AlbumsService,
    private readonly covers: TrackAlbumCoverService,
  ) {}

  /**
   * Imports the Recording's Artists, linked to the Track, then every Album the
   * Recording is on. Each Album's writes are one unit of their own.
   */
  async importMetadata(
    trackId: string,
    recordingMbid: string,
  ): Promise<ImportedLinks> {
    const run: ImportRun = {
      trackId,
      artists: new Map(),
      catalog: createLimiter(CONCURRENCY),
      covers: createLimiter(CONCURRENCY),
    };
    const recording = await this.findEntity(run, 'getRecording', recordingMbid);
    if (recording === undefined) {
      return NOTHING_LINKED;
    }
    const artistIds = await this.linkTrackArtists(run, recording);
    const albumIds = await Promise.all(
      releaseGroupsOf(recording).map((groupMbid) =>
        this.importAlbum(run, recording, groupMbid),
      ),
    );
    return { artistIds, albumIds: albumIds.filter(isDefined) };
  }

  /**
   * The entity the catalog knows under `mbid`, following one merge. Undefined
   * when the catalog does not know it; the caller skips it.
   */
  private async findEntity<TType extends CatalogLookupType>(
    run: ImportRun,
    type: TType,
    mbid: Mbid,
  ): Promise<CatalogEntity<TType> | undefined> {
    const answer = await run.catalog(() => this.catalog.lookup(type, mbid));
    if (answer.status === 'found') {
      return answer.entity;
    }
    if (answer.status === 'not-found') {
      this.logger.warn(`The Music catalog has no ${type} for ${mbid}`);
      return undefined;
    }
    const moved = await run.catalog(() =>
      this.catalog.lookup(type, answer.newMbid),
    );
    return moved.status === 'found' ? moved.entity : undefined;
  }

  private async linkTrackArtists(
    run: ImportRun,
    recording: Recording,
  ): Promise<string[]> {
    const resolutions = await this.resolveArtistCredits(
      run,
      recording.artistCredit.artists.map((artist) => artist.mbid),
    );
    const artistIds = distinct(
      resolutions.map((resolution) => resolution.artistId),
    );
    await this.artists.linkTrackArtists(run.trackId, artistIds);
    await this.artists.replaceTrackArtistCreditResolutions(
      run.trackId,
      resolutions,
    );
    return artistIds;
  }

  /** Imports one Album of the Recording; answers its ID, or nothing when the catalog does not know it. */
  private async importAlbum(
    run: ImportRun,
    recording: Recording,
    groupMbid: string,
  ): Promise<string | undefined> {
    const group = await this.findEntity(run, 'getReleaseGroup', groupMbid);
    if (group === undefined) {
      return undefined;
    }
    const artistIds = await this.resolveArtists(
      run,
      group.artistCredit.artists.map((artist) => artist.mbid),
    );
    const album = await this.albums.upsertAlbum({
      mbid: group.mbid,
      title: group.title,
      primaryType: group.primaryType,
      secondaryTypes: group.secondaryTypes,
      year: group.firstReleaseYear,
      genres: group.genres.map((genre) => genre.name),
    });
    // Outside the Album's transaction: a cover download is slow and may fail.
    if (!album.hasCover) {
      await this.storeAlbumCover(run, album.id, group.coverArtUrl);
    }
    await this.linkAlbum({
      albumId: album.id,
      trackId: run.trackId,
      recordingMbid: recording.mbid,
      ownPlacements: ownPlacementsIn(recording, groupMbid),
      group,
      artistIds,
    });
    return album.id;
  }

  /**
   * Stores an Album's cover and records its URL. A cover that cannot be stored
   * (the archive is down, or the image is bad) leaves the Album without one, and
   * the Album is still linked: a cover never costs the Track its Album.
   */
  private async storeAlbumCover(
    run: ImportRun,
    albumId: string,
    coverArtUrl: string,
  ): Promise<void> {
    try {
      const url = await run.covers(() =>
        this.covers.storeCover(albumId, coverArtUrl),
      );
      if (url !== undefined) {
        await this.albums.setAlbumCoverUrl(albumId, url);
      }
    } catch (error) {
      this.logger.warn(
        `The cover of Album ${albumId} was not stored: ${messageOf(error)}`,
      );
    }
  }

  /**
   * The Album's credit, discs and the Track's place on it, as one unit: a Track
   * is never listed on an Album whose discs are missing.
   */
  @Transactional()
  private async linkAlbum(link: AlbumLink): Promise<void> {
    await this.albums.replaceAlbumArtists(link.albumId, link.artistIds);
    const layout = albumLayoutOf({
      recordingMbid: link.recordingMbid,
      media: link.group.representativeRelease?.media ?? [],
      ownPlacements: link.ownPlacements,
    });
    if (layout === undefined) {
      this.logger.warn(
        `Track ${link.trackId} has no place on Album ${link.albumId}`,
      );
      return;
    }
    await this.albums.upsertAlbumDiscs(link.albumId, layout.discs);
    await this.albums.placeTrackOnAlbum(
      link.albumId,
      link.trackId,
      layout.placement,
    );
  }

  /** The Artists of a credit, each once, in credit order; the ones the catalog does not know are left out. */
  private async resolveArtists(
    run: ImportRun,
    mbids: readonly string[],
  ): Promise<string[]> {
    const resolutions = await this.resolveArtistCredits(run, mbids);
    return distinct(resolutions.map((resolution) => resolution.artistId));
  }

  /** Keeps the source credit MBID paired with the Artist it actually resolved. */
  private async resolveArtistCredits(
    run: ImportRun,
    mbids: readonly string[],
  ): Promise<{ creditMbid: string; artistId: string }[]> {
    const resolutions = await Promise.all(
      distinct(mbids).map(async (creditMbid) => {
        const artistId = await this.resolveArtist(run, creditMbid);
        return artistId ? { creditMbid, artistId } : undefined;
      }),
    );
    return resolutions.filter(isDefined);
  }

  /** One Artist's ID, fetched and written once per import run, however many credits name it. */
  private resolveArtist(
    run: ImportRun,
    mbid: string,
  ): Promise<string | undefined> {
    const known = run.artists.get(mbid);
    if (known !== undefined) {
      return known;
    }
    const resolved = this.importArtist(run, mbid);
    run.artists.set(mbid, resolved);
    return resolved;
  }

  private async importArtist(
    run: ImportRun,
    mbid: string,
  ): Promise<string | undefined> {
    const artist = await this.findEntity(run, 'getArtist', mbid);
    if (artist === undefined) {
      return undefined;
    }
    return this.artists.upsertArtist({
      mbid: artist.mbid,
      name: artist.name,
      genres: artist.genres.map((genre) => genre.name),
    });
  }
}
