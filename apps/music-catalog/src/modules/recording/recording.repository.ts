import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  type CreditedArtistRow,
  selectCreditedArtists,
} from '../../database/credited-artists.js';
import type { Database } from '../../database/database.js';
import type { DatabaseSource } from '../../database/database-ref.js';
import {
  artistCredit,
  artistCreditName,
  artistTag,
} from '../../database/schema/musicbrainz/artist.js';
import {
  isrc,
  recording,
  recordingGidRedirect,
  recordingTag,
} from '../../database/schema/musicbrainz/recording.js';
import {
  iso31661,
  medium,
  release,
  releaseCountry,
  releaseGroup,
  releaseGroupPrimaryType,
  releaseGroupTag,
  releaseStatus,
  releaseUnknownCountry,
  track,
} from '../../database/schema/musicbrainz/release.js';
import { genre, tag } from '../../database/schema/musicbrainz/tag.js';
import {
  link,
  linkType,
  lRecordingUrl,
  url,
} from '../../database/schema/musicbrainz/url.js';
import {
  lRecordingWork,
  work,
} from '../../database/schema/musicbrainz/work.js';
import { coverRankSql } from './recording-cover.repository.js';
import type {
  ExternalUrlRow,
  RecordingRow,
  ReleaseEventRow,
  ReleaseRow,
  TagLevels,
  TagVotesRow,
  WorkRow,
} from './recording-data.js';

/**
 * Reads one Recording from the MusicBrainz tables, by MBID. Read-only: the
 * tables belong to mbslave. Each method is one query; the service decides
 * what to load and combines it.
 */
export class RecordingRepository {
  private readonly getDb: () => Database;

  constructor(db: DatabaseSource) {
    this.getDb = typeof db === 'function' ? db : () => db;
  }

  async findByMbid(mbid: string): Promise<RecordingRow | undefined> {
    const [row] = await this.getDb()
      .select({
        id: recording.id,
        mbid: recording.gid,
        title: recording.name,
        lengthMs: recording.length,
        disambiguation: recording.comment,
        video: recording.video,
        artistCreditId: recording.artistCredit,
        artistCreditName: artistCredit.name,
      })
      .from(recording)
      .innerJoin(artistCredit, eq(artistCredit.id, recording.artistCredit))
      .where(eq(recording.gid, mbid))
      .limit(1);
    return row;
  }

  /**
   * The MBID a merged Recording now has, when `mbid` is one MusicBrainz
   * merged away and its target still exists.
   */
  async findMergedInto(mbid: string): Promise<string | undefined> {
    const [row] = await this.getDb()
      .select({ mbid: recording.gid })
      .from(recordingGidRedirect)
      .innerJoin(recording, eq(recording.id, recordingGidRedirect.newId))
      .where(eq(recordingGidRedirect.gid, mbid))
      .limit(1);
    return row?.mbid;
  }

  findCreditedArtists(artistCreditId: number): Promise<CreditedArtistRow[]> {
    return selectCreditedArtists(this.getDb(), artistCreditId);
  }

  async findIsrcs(recordingId: number): Promise<string[]> {
    const rows = await this.getDb()
      .selectDistinct({ isrc: isrc.isrc })
      .from(isrc)
      .where(eq(isrc.recording, recordingId))
      .orderBy(asc(isrc.isrc));
    return rows.map((row) => row.isrc);
  }

  findReleases(recordingId: number): Promise<ReleaseRow[]> {
    return this.getDb()
      .select({
        id: release.id,
        coverRank: coverRankSql(recording.artistCredit),
        mbid: release.gid,
        title: release.name,
        releaseGroupMbid: releaseGroup.gid,
        primaryType: releaseGroupPrimaryType.name,
        status: releaseStatus.name,
        mediumPosition: medium.position,
        trackPosition: track.position,
      })
      .from(track)
      .innerJoin(recording, eq(recording.id, track.recording))
      .innerJoin(medium, eq(medium.id, track.medium))
      .innerJoin(release, eq(release.id, medium.release))
      .innerJoin(releaseGroup, eq(releaseGroup.id, release.releaseGroup))
      .leftJoin(
        releaseGroupPrimaryType,
        eq(releaseGroupPrimaryType.id, releaseGroup.type),
      )
      .leftJoin(releaseStatus, eq(releaseStatus.id, release.status))
      .where(eq(track.recording, recordingId));
  }

  async findReleaseEvents(releaseIds: number[]): Promise<ReleaseEventRow[]> {
    if (releaseIds.length === 0) {
      return [];
    }
    const [inCountry, inUnknownCountry] = await Promise.all([
      this.getDb()
        .select({
          releaseId: releaseCountry.release,
          country: iso31661.code,
          year: releaseCountry.dateYear,
          month: releaseCountry.dateMonth,
          day: releaseCountry.dateDay,
        })
        .from(releaseCountry)
        .leftJoin(iso31661, eq(iso31661.area, releaseCountry.country))
        .where(inArray(releaseCountry.release, releaseIds)),
      this.getDb()
        .select({
          releaseId: releaseUnknownCountry.release,
          year: releaseUnknownCountry.dateYear,
          month: releaseUnknownCountry.dateMonth,
          day: releaseUnknownCountry.dateDay,
        })
        .from(releaseUnknownCountry)
        .where(inArray(releaseUnknownCountry.release, releaseIds)),
    ]);
    return [
      ...inCountry,
      ...inUnknownCountry.map((event) => ({ ...event, country: null })),
    ];
  }

  findWorks(recordingId: number): Promise<WorkRow[]> {
    return this.getDb()
      .selectDistinct({ mbid: work.gid, title: work.name })
      .from(lRecordingWork)
      .innerJoin(work, eq(work.id, lRecordingWork.entity1))
      .where(eq(lRecordingWork.entity0, recordingId));
  }

  findExternalUrls(recordingId: number): Promise<ExternalUrlRow[]> {
    return this.getDb()
      .selectDistinct({ url: url.url, linkType: linkType.name })
      .from(lRecordingUrl)
      .innerJoin(link, eq(link.id, lRecordingUrl.link))
      .innerJoin(linkType, eq(linkType.id, link.linkType))
      .innerJoin(url, eq(url.id, lRecordingUrl.entity1))
      .where(eq(lRecordingUrl.entity0, recordingId));
  }

  /**
   * The tags at each level genres may come from, all read at once: the
   * Recording's own, the release groups' of the releases it is on and its
   * credited artists'. Only tags with positive votes, summed across the
   * groups or artists of a level.
   */
  async findTagLevels(ids: {
    recordingId: number;
    artistCreditId: number;
  }): Promise<TagLevels> {
    const [own, releaseGroups, artists] = await Promise.all([
      this.recordingTags(ids.recordingId),
      this.releaseGroupTags(ids.recordingId),
      this.artistTags(ids.artistCreditId),
    ]);
    return { recording: own, release_group: releaseGroups, artist: artists };
  }

  private recordingTags(recordingId: number): Promise<TagVotesRow[]> {
    return this.getDb()
      .select({
        name: tag.name,
        count: recordingTag.count,
        genreMbid: genre.gid,
      })
      .from(recordingTag)
      .innerJoin(tag, eq(tag.id, recordingTag.tag))
      .leftJoin(genre, eq(genre.name, tag.name))
      .where(
        and(eq(recordingTag.recording, recordingId), gt(recordingTag.count, 0)),
      );
  }

  private releaseGroupTags(recordingId: number): Promise<TagVotesRow[]> {
    const releaseGroupIds = this.getDb()
      .select({ id: release.releaseGroup })
      .from(track)
      .innerJoin(medium, eq(medium.id, track.medium))
      .innerJoin(release, eq(release.id, medium.release))
      .where(eq(track.recording, recordingId));
    return this.getDb()
      .select({
        name: tag.name,
        count: sql<number>`sum(${releaseGroupTag.count})::int`,
        genreMbid: genre.gid,
      })
      .from(releaseGroupTag)
      .innerJoin(tag, eq(tag.id, releaseGroupTag.tag))
      .leftJoin(genre, eq(genre.name, tag.name))
      .where(
        and(
          inArray(releaseGroupTag.releaseGroup, releaseGroupIds),
          gt(releaseGroupTag.count, 0),
        ),
      )
      .groupBy(tag.name, genre.gid);
  }

  private artistTags(artistCreditId: number): Promise<TagVotesRow[]> {
    const artistIds = this.getDb()
      .select({ id: artistCreditName.artist })
      .from(artistCreditName)
      .where(eq(artistCreditName.artistCredit, artistCreditId));
    return this.getDb()
      .select({
        name: tag.name,
        count: sql<number>`sum(${artistTag.count})::int`,
        genreMbid: genre.gid,
      })
      .from(artistTag)
      .innerJoin(tag, eq(tag.id, artistTag.tag))
      .leftJoin(genre, eq(genre.name, tag.name))
      .where(and(inArray(artistTag.artist, artistIds), gt(artistTag.count, 0)))
      .groupBy(tag.name, genre.gid);
  }
}
