import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.js';
import type { DatabaseSource } from '../../database/database-ref.js';
import {
  artist,
  artistAlias,
  artistCredit,
  artistCreditName,
  artistTag,
} from '../../database/schema/musicbrainz/artist.js';
import {
  recording,
  recordingTag,
} from '../../database/schema/musicbrainz/recording.js';
import {
  medium,
  release,
  releaseCountry,
  releaseGroupTag,
  releaseUnknownCountry,
  track,
} from '../../database/schema/musicbrainz/release.js';
import { genre, tag } from '../../database/schema/musicbrainz/tag.js';
import {
  lRecordingWork,
  work,
} from '../../database/schema/musicbrainz/work.js';
import { trackAssociation } from '../../database/schema/track-association.js';
import type {
  ArtistNameRow,
  CreditGenreRow,
  DocumentRecordingRow,
  PrimaryReleaseRow,
  RecordingGenreRow,
  RecordingProgress,
  RecordingTitleRow,
} from './recording-document-data.js';

// The Recording's own row with the printed name of its artist credit, read
// the same way whether a batch is walked in order or synced by id.
const documentColumns = {
  id: recording.id,
  mbid: recording.gid,
  title: recording.name,
  disambiguation: recording.comment,
  artistCreditId: recording.artistCredit,
  artistCreditName: artistCredit.name,
  trackId: trackAssociation.trackId,
  businessScore: trackAssociation.businessScore,
};

/**
 * Reads the Recordings the worker indexes, a batch at a time. Read-only: the
 * tables belong to mbslave. Every method takes the ids of a whole batch and
 * runs one query for it, so indexing costs a handful of queries per batch and
 * not per Recording.
 */
export class RecordingDocumentRepository {
  private readonly getDb: () => Database;

  constructor(db: DatabaseSource) {
    this.getDb = typeof db === 'function' ? db : () => db;
  }

  /** The next `limit` Recordings after `afterId`, in id order. */
  findBatch(afterId: number, limit: number): Promise<DocumentRecordingRow[]> {
    return this.getDb()
      .select(documentColumns)
      .from(recording)
      .innerJoin(artistCredit, eq(artistCredit.id, recording.artistCredit))
      .leftJoin(
        trackAssociation,
        eq(trackAssociation.recordingMbid, recording.gid),
      )
      .where(gt(recording.id, afterId))
      .orderBy(asc(recording.id))
      .limit(limit);
  }

  /**
   * Counts both the catalog and its confirmed prefix in one source scan.
   * MusicBrainz ids have gaps, so the checkpoint itself is not a count.
   */
  async countProgress(afterId: number): Promise<RecordingProgress> {
    const [row] = await this.getDb()
      .select({
        total: count(),
        indexed:
          sql<number>`count(*) filter (where ${recording.id} <= ${afterId})`.mapWith(
            Number,
          ),
      })
      .from(recording);
    return row ?? { total: 0, indexed: 0 };
  }

  /** The Recordings with these integer ids, in no particular order. */
  async findByIds(ids: readonly number[]): Promise<DocumentRecordingRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.getDb()
      .select(documentColumns)
      .from(recording)
      .innerJoin(artistCredit, eq(artistCredit.id, recording.artistCredit))
      .leftJoin(
        trackAssociation,
        eq(trackAssociation.recordingMbid, recording.gid),
      )
      .where(inArray(recording.id, [...ids]));
  }

  async findIdsByMbids(mbids: readonly string[]): Promise<number[]> {
    if (mbids.length === 0) return [];
    const rows = await this.getDb()
      .select({ id: recording.id })
      .from(recording)
      .where(inArray(recording.gid, [...mbids]));
    return rows.map((row) => row.id);
  }

  /** Each credited artist with each of its aliases (once without aliases). */
  findArtistNames(artistCreditIds: number[]): Promise<ArtistNameRow[]> {
    return this.getDb()
      .selectDistinct({
        artistCreditId: artistCreditName.artistCredit,
        name: artist.name,
        sortName: artist.sortName,
        aliasName: artistAlias.name,
        aliasSortName: artistAlias.sortName,
      })
      .from(artistCreditName)
      .innerJoin(artist, eq(artist.id, artistCreditName.artist))
      .leftJoin(artistAlias, eq(artistAlias.artist, artist.id))
      .where(inArray(artistCreditName.artistCredit, artistCreditIds));
  }

  findReleaseTitles(recordingIds: number[]): Promise<RecordingTitleRow[]> {
    return this.getDb()
      .selectDistinct({ recordingId: track.recording, title: release.name })
      .from(track)
      .innerJoin(medium, eq(medium.id, track.medium))
      .innerJoin(release, eq(release.id, medium.release))
      .where(inArray(track.recording, recordingIds));
  }

  /** The same dated-first, title/MBID-tied release shown by getRecording. */
  async findPrimaryReleases(
    recordingIds: number[],
  ): Promise<PrimaryReleaseRow[]> {
    if (recordingIds.length === 0) return [];
    const result = await this.getDb().execute<PrimaryReleaseRow>(sql`
      select selected.recording_id as "recordingId",
        selected.release_mbid as "mbid"
      from (
        select ${track.recording} as recording_id, ${release.gid} as release_mbid,
          row_number() over (
            partition by ${track.recording}
            order by release_date.date asc nulls last,
              ${release.name} collate "C", ${release.gid},
              ${medium.position}, ${track.position}
          ) as position
        from ${track}
        join ${medium} on ${medium.id} = ${track.medium}
        join ${release} on ${release.id} = ${medium.release}
        cross join lateral (
          select min(event_date.date collate "C") as date
          from (
            select case when ${releaseCountry.dateYear} is null then null
              else lpad(${releaseCountry.dateYear}::text, 4, '0') ||
                case when ${releaseCountry.dateMonth} is null then '' else
                  '-' || lpad(${releaseCountry.dateMonth}::text, 2, '0') ||
                  case when ${releaseCountry.dateDay} is null then '' else
                    '-' || lpad(${releaseCountry.dateDay}::text, 2, '0') end
                end end as date
            from ${releaseCountry}
            where ${releaseCountry.release} = ${release.id}
            union all
            select case when ${releaseUnknownCountry.dateYear} is null then null
              else lpad(${releaseUnknownCountry.dateYear}::text, 4, '0') ||
                case when ${releaseUnknownCountry.dateMonth} is null then '' else
                  '-' || lpad(${releaseUnknownCountry.dateMonth}::text, 2, '0') ||
                  case when ${releaseUnknownCountry.dateDay} is null then '' else
                    '-' || lpad(${releaseUnknownCountry.dateDay}::text, 2, '0') end
                end end
            from ${releaseUnknownCountry}
            where ${releaseUnknownCountry.release} = ${release.id}
          ) event_date
        ) release_date
        where ${track.recording} in (${sql.join(
          recordingIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      ) selected
      where selected.position = 1
    `);
    return result.rows;
  }

  findWorkTitles(recordingIds: number[]): Promise<RecordingTitleRow[]> {
    return this.getDb()
      .selectDistinct({
        recordingId: lRecordingWork.entity0,
        title: work.name,
      })
      .from(lRecordingWork)
      .innerJoin(work, eq(work.id, lRecordingWork.entity1))
      .where(inArray(lRecordingWork.entity0, recordingIds));
  }

  /** The genres (only) the Recordings' own tags give them. */
  findRecordingGenres(recordingIds: number[]): Promise<RecordingGenreRow[]> {
    return this.getDb()
      .select({
        recordingId: recordingTag.recording,
        name: tag.name,
        count: recordingTag.count,
        genreMbid: genre.gid,
      })
      .from(recordingTag)
      .innerJoin(tag, eq(tag.id, recordingTag.tag))
      .innerJoin(genre, eq(genre.name, tag.name))
      .where(
        and(
          inArray(recordingTag.recording, recordingIds),
          gt(recordingTag.count, 0),
        ),
      );
  }

  /**
   * The genres of the release groups each Recording is on, votes added up
   * per genre. Each release group counts once per Recording, however many of
   * its releases carry it.
   */
  findReleaseGroupGenres(recordingIds: number[]): Promise<RecordingGenreRow[]> {
    const groups = this.getDb()
      .selectDistinct({
        recordingId: track.recording,
        releaseGroupId: release.releaseGroup,
      })
      .from(track)
      .innerJoin(medium, eq(medium.id, track.medium))
      .innerJoin(release, eq(release.id, medium.release))
      .where(inArray(track.recording, recordingIds))
      .as('groups');
    const votes = sql<number>`sum(${releaseGroupTag.count})::int`;
    return this.getDb()
      .select({
        recordingId: groups.recordingId,
        name: tag.name,
        count: votes,
        genreMbid: genre.gid,
      })
      .from(groups)
      .innerJoin(
        releaseGroupTag,
        eq(releaseGroupTag.releaseGroup, groups.releaseGroupId),
      )
      .innerJoin(tag, eq(tag.id, releaseGroupTag.tag))
      .innerJoin(genre, eq(genre.name, tag.name))
      .groupBy(groups.recordingId, tag.name, genre.gid)
      .having(gt(votes, 0));
  }

  /** The genres of the credited artists, votes added up per genre. */
  findArtistGenres(artistCreditIds: number[]): Promise<CreditGenreRow[]> {
    const votes = sql<number>`sum(${artistTag.count})::int`;
    return this.getDb()
      .select({
        artistCreditId: artistCreditName.artistCredit,
        name: tag.name,
        count: votes,
        genreMbid: genre.gid,
      })
      .from(artistCreditName)
      .innerJoin(artistTag, eq(artistTag.artist, artistCreditName.artist))
      .innerJoin(tag, eq(tag.id, artistTag.tag))
      .innerJoin(genre, eq(genre.name, tag.name))
      .where(inArray(artistCreditName.artistCredit, artistCreditIds))
      .groupBy(artistCreditName.artistCredit, tag.name, genre.gid)
      .having(gt(votes, 0));
  }
}
