import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type {
  CatalogTrack,
  CatalogTrackExternalLink,
  CatalogTrackRelease,
  CatalogTrackTag,
  CatalogTrackWork,
  Mbid,
} from '@vozzify/contracts';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { artists, trackArtists } from '../../database/schema/artists.js';
import { trackAssociationEvents } from '../../database/schema/track-association-events.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import {
  legacyTrackIds,
  trackExternalLinks,
  trackReleases,
  tracks,
  trackTags,
  trackWorks,
} from '../../database/schema/tracks.js';
import { type ByTrack, groupByTrack } from './group-by-track.js';
import type { NewTrackCoreRow } from './track-from-recording.js';
import type { NoteSummary } from './track-note-summary.js';
import type {
  PipelineTrack,
  TrackHeaderRow,
} from './track-repository.helpers.js';
import {
  insertIfAny,
  type NewTrackDetails,
  onTrack,
} from './track-repository.helpers.js';
import { setTrackTrendingScore } from './track-trending-score.repository.js';

@Injectable()
export class TracksRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /**
   * Track ids keyed by recording MBID, for the MBIDs given. Only processed
   * Recordings have a row; the caller maps a miss to null (static card).
   */
  async findTrackIdsByRecordingMbids(
    mbids: Mbid[],
  ): Promise<Map<string, string>> {
    if (mbids.length === 0) {
      return new Map();
    }
    const rows = await this.txHost.tx
      .select({ id: tracks.id, recordingMbid: tracks.recordingMbid })
      .from(tracks)
      .where(inArray(tracks.recordingMbid, mbids));
    return new Map(rows.map((row) => [row.recordingMbid, row.id]));
  }

  /**
   * Inserts the core row of a new Track and returns its ID. When a Track
   * already has the Recording, nothing is written and the answer is undefined:
   * the request that lost a race reads the winner's Track instead. The unique
   * Recording MBID is what makes concurrent requests end in one Track.
   */
  async insertTrack(row: NewTrackCoreRow): Promise<string | undefined> {
    const [inserted] = await this.txHost.tx
      .insert(tracks)
      .values(row)
      .onConflictDoNothing({ target: tracks.recordingMbid })
      .returning({ id: tracks.id });
    return inserted?.id;
  }

  /** Records the durable Music catalog association in the Track transaction. */
  async insertAssociationEvent(
    recordingMbid: Mbid,
    trackId: string,
  ): Promise<void> {
    await this.txHost.tx.insert(trackAssociationEvents).values({
      recordingMbid,
      trackId,
      businessScore: 1,
    });
  }

  /** The companion rows of a new Track: releases, works, tags and links. */
  async insertTrackDetails(
    trackId: string,
    details: NewTrackDetails,
  ): Promise<void> {
    const db = this.txHost.tx;
    await insertIfAny(details.releases, (rows) =>
      db.insert(trackReleases).values(onTrack(rows, trackId)),
    );
    await insertIfAny(details.works, (rows) =>
      db.insert(trackWorks).values(onTrack(rows, trackId)),
    );
    await insertIfAny(details.tags, (rows) =>
      db.insert(trackTags).values(onTrack(rows, trackId)),
    );
    await insertIfAny(details.externalLinks, (rows) =>
      db.insert(trackExternalLinks).values(onTrack(rows, trackId)),
    );
  }

  /**
   * The header of a Track (title, cover and artist credit), or undefined for an
   * unknown ID.
   */
  async findTrackHeader(trackId: string): Promise<TrackHeaderRow | undefined> {
    const [row] = await this.txHost.tx
      .select({
        id: tracks.id,
        title: tracks.title,
        coverUrl: tracks.coverUrl,
        artistCredit: tracks.artistCredit,
      })
      .from(tracks)
      .where(eq(tracks.id, trackId))
      .limit(1);
    return row;
  }

  /**
   * What a Processing of the Track works from: the title and length it matches
   * videos against, the artists its search is made of, the links and releases
   * the video and the cover come from. Undefined for an unknown Track.
   */
  async findPipelineTrack(trackId: string): Promise<PipelineTrack | undefined> {
    const row = await this.txHost.tx.query.tracks.findFirst({
      where: eq(tracks.id, trackId),
      columns: {
        id: true,
        title: true,
        lengthMs: true,
        coverUrl: true,
        artistCredit: true,
      },
      with: {
        releases: { columns: { mbid: true, title: true, year: true } },
        externalLinks: { columns: { url: true } },
      },
    });
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      title: row.title,
      lengthMs: row.lengthMs,
      coverUrl: row.coverUrl,
      artistNames: row.artistCredit.map((entry) => entry.name),
      externalUrls: row.externalLinks.map((link) => link.url),
      releases: row.releases,
    };
  }

  /** The MBID of the Recording a Track was created from; undefined for an unknown Track. */
  async findRecordingMbid(trackId: string): Promise<string | undefined> {
    const [row] = await this.txHost.tx
      .select({ recordingMbid: tracks.recordingMbid })
      .from(tracks)
      .where(eq(tracks.id, trackId))
      .limit(1);
    return row?.recordingMbid;
  }

  /**
   * Whether the Track has a completed Processing: the state its Artist and Album
   * pages list it in (ADR 0005).
   */
  async isTrackCompleted(trackId: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, trackId), hasCompletedProcessing(tracks.id)))
      .limit(1);
    return rows.length > 0;
  }

  /** Stores the Track's cover, in our storage, once a Processing has found one. */
  async setCoverUrl(trackId: string, coverUrl: string): Promise<void> {
    await this.txHost.tx
      .update(tracks)
      .set({ coverUrl })
      .where(eq(tracks.id, trackId));
  }

  /** Sets a Track's trending score. True when the score actually changed. */
  async setTrendingScore(trackId: string, score: number): Promise<boolean> {
    return setTrackTrendingScore(this.txHost, trackId, score);
  }

  /** Tracks with a trending score, which rolls with time as well as views. */
  findScoredTracks(): Promise<{ id: string }[]> {
    return this.txHost.tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(gt(tracks.trendingScore, 0));
  }

  /**
   * Stores the vocal range and key the Track keeps of its notes (all null for
   * a Track without notes). It joins the caller's transaction.
   */
  async setNoteSummary(trackId: string, summary: NoteSummary): Promise<void> {
    await this.txHost.tx
      .update(tracks)
      .set(summary)
      .where(eq(tracks.id, trackId));
  }

  /** The YouTube video the timeline plays, once a Processing has chosen it. */
  async setYoutubeVideoId(
    trackId: string,
    youtubeVideoId: string,
  ): Promise<void> {
    await this.txHost.tx
      .update(tracks)
      .set({ youtubeVideoId })
      .where(eq(tracks.id, trackId));
  }

  /** The Track a legacy Track ID was reprocessed into, if it was. */
  async findTrackIdByLegacyId(legacyId: string): Promise<string | undefined> {
    const [row] = await this.txHost.tx
      .select({ trackId: legacyTrackIds.trackId })
      .from(legacyTrackIds)
      .where(eq(legacyTrackIds.legacyId, legacyId))
      .limit(1);
    return row?.trackId;
  }

  /**
   * The catalog details of the Tracks given: the core fields plus credited
   * artists, releases, works, tags and links, for each Track that exists. The
   * order is unspecified; the service puts the entries in the order it needs.
   * Reads only.
   */
  async findCatalogTracks(trackIds: string[]): Promise<CatalogTrack[]> {
    if (trackIds.length === 0) {
      return [];
    }
    const rows = await this.txHost.tx
      .select({
        id: tracks.id,
        title: tracks.title,
        lengthMs: tracks.lengthMs,
        disambiguation: tracks.disambiguation,
        video: tracks.video,
        isrcs: tracks.isrcs,
        genres: tracks.genres,
      })
      .from(tracks)
      .where(inArray(tracks.id, trackIds));
    const [credits, releases, works, tagsByTrack, links] = await Promise.all([
      this.fetchCredits(trackIds),
      this.fetchReleases(trackIds),
      this.fetchWorks(trackIds),
      this.fetchTags(trackIds),
      this.fetchExternalLinks(trackIds),
    ]);
    return rows.map((row) => ({
      ...row,
      artists: credits.get(row.id) ?? [],
      releases: releases.get(row.id) ?? [],
      works: works.get(row.id) ?? [],
      tags: tagsByTrack.get(row.id) ?? [],
      externalLinks: links.get(row.id) ?? [],
    }));
  }

  private async fetchCredits(
    trackIds: string[],
  ): Promise<ByTrack<{ trackId: string; id: string; name: string }>> {
    const rows = await this.txHost.tx
      .select({
        trackId: trackArtists.trackId,
        id: artists.id,
        name: artists.name,
      })
      .from(trackArtists)
      .innerJoin(artists, eq(trackArtists.artistId, artists.id))
      .where(inArray(trackArtists.trackId, trackIds))
      .orderBy(asc(artists.name));
    return groupByTrack(rows);
  }

  private async fetchReleases(
    trackIds: string[],
  ): Promise<ByTrack<CatalogTrackRelease & { trackId: string }>> {
    const rows = await this.txHost.tx
      .select({
        trackId: trackReleases.trackId,
        mbid: trackReleases.mbid,
        title: trackReleases.title,
        year: trackReleases.year,
        coverArtUrl: trackReleases.coverArtUrl,
      })
      .from(trackReleases)
      .where(inArray(trackReleases.trackId, trackIds))
      .orderBy(asc(trackReleases.title), asc(trackReleases.mbid));
    return groupByTrack(rows);
  }

  private async fetchWorks(
    trackIds: string[],
  ): Promise<ByTrack<CatalogTrackWork & { trackId: string }>> {
    const rows = await this.txHost.tx
      .select({
        trackId: trackWorks.trackId,
        mbid: trackWorks.mbid,
        title: trackWorks.title,
      })
      .from(trackWorks)
      .where(inArray(trackWorks.trackId, trackIds))
      .orderBy(asc(trackWorks.title), asc(trackWorks.mbid));
    return groupByTrack(rows);
  }

  private async fetchTags(
    trackIds: string[],
  ): Promise<ByTrack<CatalogTrackTag & { trackId: string }>> {
    const rows = await this.txHost.tx
      .select({
        trackId: trackTags.trackId,
        name: trackTags.name,
        count: trackTags.count,
      })
      .from(trackTags)
      .where(inArray(trackTags.trackId, trackIds))
      .orderBy(desc(trackTags.count), asc(trackTags.name));
    return groupByTrack(rows);
  }

  private async fetchExternalLinks(
    trackIds: string[],
  ): Promise<ByTrack<CatalogTrackExternalLink & { trackId: string }>> {
    const rows = await this.txHost.tx
      .select({
        trackId: trackExternalLinks.trackId,
        url: trackExternalLinks.url,
        linkType: trackExternalLinks.linkType,
      })
      .from(trackExternalLinks)
      .where(inArray(trackExternalLinks.trackId, trackIds))
      .orderBy(asc(trackExternalLinks.linkType), asc(trackExternalLinks.url));
    return groupByTrack(rows);
  }
}
