import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  TRACK_PROCESSING_TERMINAL_STATUSES,
  type TrackProcessingFailureCode,
  type TrackProcessingStatus,
  type TrackProcessingStep,
  type TrackProcessingVideoSource,
} from '@vozzify/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { DatabaseAdapter } from '../../database/database.js';
import { albumTracks } from '../../database/schema/albums.js';
import { trackArtists } from '../../database/schema/artists.js';
import { trackProcessings } from '../../database/schema/track-processings.js';
import { tracks } from '../../database/schema/tracks.js';
import {
  type TrackContributionKind,
  TrackContributorRepository,
} from './track-contributor.repository.js';
import type {
  Mp3Kind,
  ProcessingDetection,
  StoredAudioUrls,
} from './track-processing-outputs.js';
import type { TrackProcessingRow } from './track-processing-view.js';
import { TrackRequestLimitRepository } from './track-request-limit.repository.js';

/** A Processing as one of its step jobs reads it. */
export type ProcessingForStep = {
  id: string;
  trackId: string;
  status: TrackProcessingStatus;
  /** The video a run already chose; a retry keeps it. */
  videoId: string | null;
  videoSource: TrackProcessingVideoSource | null;
};

/** The Processing with this ID, while its status is one of `statuses`. */
const processingInStatus = (
  processingId: string,
  statuses: readonly TrackProcessingStatus[],
) =>
  and(
    eq(trackProcessings.id, processingId),
    inArray(trackProcessings.status, [...statuses]),
  );

/**
 * Processings of Tracks, and what the Processing page and the requests read
 * and write. The Contributors and the request limits have their own
 * repositories; the methods here that serve them delegate, so their callers
 * keep one injection.
 */
@Injectable()
export class TrackProcessingRepository {
  constructor(
    private readonly txHost: TransactionHost<DatabaseAdapter>,
    private readonly contributors: TrackContributorRepository,
    private readonly requestLimits: TrackRequestLimitRepository,
  ) {}

  /** A new Processing of a Track, queued; returns its ID. */
  async insertQueuedProcessing(trackId: string): Promise<string> {
    const [row] = await this.txHost.tx
      .insert(trackProcessings)
      .values({ trackId })
      .returning({ id: trackProcessings.id });
    if (row === undefined) {
      throw new Error('Insert returned no row');
    }
    return row.id;
  }

  /** The newest Processing of a Track, which is the Track's current state. */
  async findLatestProcessing(
    trackId: string,
  ): Promise<TrackProcessingRow | undefined> {
    const [row] = await this.txHost.tx
      .select({
        id: trackProcessings.id,
        status: trackProcessings.status,
        failureCode: trackProcessings.failureCode,
        resumeFrom: trackProcessings.resumeFrom,
        videoId: trackProcessings.videoId,
        videoSource: trackProcessings.videoSource,
        createdAt: trackProcessings.createdAt,
        startedAt: trackProcessings.startedAt,
        finishedAt: trackProcessings.finishedAt,
      })
      .from(trackProcessings)
      .where(eq(trackProcessings.trackId, trackId))
      .orderBy(desc(trackProcessings.createdAt), desc(trackProcessings.id))
      .limit(1);
    return row;
  }

  /** The Contributor of a User on a Track (see `TrackContributorRepository`). */
  findOrInsertContributor(trackId: string, userId: string): Promise<string> {
    return this.contributors.findOrInsertContributor(trackId, userId);
  }

  /** Records one Contribution: an action of a Contributor that started a Processing. */
  insertContribution(row: {
    contributorId: string;
    kind: TrackContributionKind;
    processingId: string;
  }): Promise<void> {
    return this.contributors.insertContribution(row);
  }

  /**
   * The Artists and Albums a Track is listed on. Completion refreshes their
   * pages (ADR 0005), so it reads them as they are when the Processing ends.
   */
  async findCatalogIds(
    trackId: string,
  ): Promise<{ artistIds: string[]; albumIds: string[] }> {
    const artistRows = await this.txHost.tx
      .select({ id: trackArtists.artistId })
      .from(trackArtists)
      .where(eq(trackArtists.trackId, trackId));
    const albumRows = await this.txHost.tx
      .select({ id: albumTracks.albumId })
      .from(albumTracks)
      .where(eq(albumTracks.trackId, trackId));
    return {
      artistIds: artistRows.map((row) => row.id),
      albumIds: albumRows.map((row) => row.id),
    };
  }

  /** The Contributors of a Track, in the order they first contributed. */
  findContributors(trackId: string): Promise<{ id: string; userId: string }[]> {
    return this.contributors.findContributors(trackId);
  }

  /** A Processing as its step job reads it; undefined for an unknown ID. */
  async findProcessing(
    processingId: string,
  ): Promise<ProcessingForStep | undefined> {
    const [row] = await this.txHost.tx
      .select({
        id: trackProcessings.id,
        trackId: trackProcessings.trackId,
        status: trackProcessings.status,
        videoId: trackProcessings.videoId,
        videoSource: trackProcessings.videoSource,
      })
      .from(trackProcessings)
      .where(eq(trackProcessings.id, processingId))
      .limit(1);
    return row;
  }

  // The writes below are guarded by the status the job expects. A job that
  // runs late (redelivered, or stalled past its lock) finds the Processing
  // moved on, and its write matches no row: the answer is false, and nothing
  // changes. The guards are the database's answer to a race; the reads a job
  // does first only save work.

  /**
   * A step started: the status moves to it, the first start is kept. False
   * when the Processing is no longer in one of the `dueStatuses` (it moved on
   * or ended meanwhile).
   */
  async markStepStarted(
    processingId: string,
    step: TrackProcessingStep,
    dueStatuses: readonly TrackProcessingStatus[],
  ): Promise<boolean> {
    return this.setInStatus(processingId, dueStatuses, {
      status: step,
      startedAt: sql`coalesce(${trackProcessings.startedAt}, now())`,
      // A running step resumes nothing: a retry's start step is spent.
      resumeFrom: null,
    });
  }

  /** The video a step chose, and where it was found, while the step runs. */
  async saveVideo(
    processingId: string,
    step: TrackProcessingStep,
    video: { videoId: string; source: TrackProcessingVideoSource },
  ): Promise<boolean> {
    return this.setInStatus(processingId, [step], {
      videoId: video.videoId,
      videoSource: video.source,
    });
  }

  /** The URL of the music WAV the download stored; null while it has none. */
  async findMusicWavUrl(processingId: string): Promise<string | null> {
    const [row] = await this.txHost.tx
      .select({ musicWavUrl: trackProcessings.musicWavUrl })
      .from(trackProcessings)
      .where(eq(trackProcessings.id, processingId))
      .limit(1);
    return row?.musicWavUrl ?? null;
  }

  /**
   * The music WAV the download stored, while the download step runs. False when
   * the Processing is no longer in that step, which keeps its row as it is.
   */
  async saveMusicWavUrl(processingId: string, url: string): Promise<boolean> {
    return this.setInStatus(processingId, ['DOWNLOADING_AUDIO'], {
      musicWavUrl: url,
    });
  }

  /** The RunPod job of the note detection, once a run has started it; null before. */
  async findRunpodJobId(processingId: string): Promise<string | null> {
    const [row] = await this.txHost.tx
      .select({ runpodJobId: trackProcessings.runpodJobId })
      .from(trackProcessings)
      .where(eq(trackProcessings.id, processingId))
      .limit(1);
    return row?.runpodJobId ?? null;
  }

  /**
   * The RunPod job the vocals stage started, saved as soon as it exists, so a
   * replayed run polls it instead of starting another. False when the
   * Processing is no longer in the vocals stage.
   */
  async saveRunpodJobId(processingId: string, jobId: string): Promise<boolean> {
    return this.setInStatus(processingId, ['EXTRACTING_VOCALS'], {
      runpodJobId: jobId,
    });
  }

  /** What the notes stage read from the job's output. False if it moved on. */
  async saveDetection(
    processingId: string,
    detection: ProcessingDetection,
  ): Promise<boolean> {
    return this.setInStatus(processingId, ['DETECTING_NOTES'], detection);
  }

  /** Sets columns while the Processing is in one of `statuses`; false if it moved on. */
  private async setInStatus(
    processingId: string,
    statuses: readonly TrackProcessingStatus[],
    values: PgUpdateSetSource<typeof trackProcessings>,
  ): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(trackProcessings)
      .set(values)
      .where(processingInStatus(processingId, statuses))
      .returning({ id: trackProcessings.id });
    return rows.length > 0;
  }

  /** The last step is done: the Processing completes. False if it moved on. */
  async markCompleted(
    processingId: string,
    lastStep: TrackProcessingStep,
  ): Promise<boolean> {
    return this.setInStatus(processingId, [lastStep], {
      status: 'COMPLETED',
      failureCode: null,
      resumeFrom: null,
      finishedAt: new Date(),
    });
  }

  /**
   * The Processing failed at a step; a retry will resume at that step. False
   * when it is no longer in one of the `dueStatuses`: a Processing that
   * already completed or failed keeps its outcome.
   */
  async markFailed(
    processingId: string,
    dueStatuses: readonly TrackProcessingStatus[],
    failure: {
      code: TrackProcessingFailureCode;
      resumeFrom: TrackProcessingStep;
    },
  ): Promise<boolean> {
    return this.setInStatus(processingId, dueStatuses, {
      status: 'FAILED',
      failureCode: failure.code,
      resumeFrom: failure.resumeFrom,
      finishedAt: new Date(),
    });
  }

  /** The audio URLs of a Processing; the Processing must exist. */
  async findAudioUrls(processingId: string): Promise<StoredAudioUrls> {
    const row = await this.txHost.tx.query.trackProcessings.findFirst({
      where: eq(trackProcessings.id, processingId),
      columns: {
        musicWavUrl: true,
        musicMp3Url: true,
        vocalsWavUrl: true,
        vocalsMp3Url: true,
      },
    });
    if (row === undefined) throw new Error(`No Processing ${processingId}`);
    return row;
  }

  /** Saves the URL of an MP3 a step stored, whatever the row's state. */
  async saveMp3Url(
    processingId: string,
    kind: Mp3Kind,
    url: string,
  ): Promise<void> {
    const values = {
      music: { musicMp3Url: url },
      vocals: { vocalsMp3Url: url },
    } satisfies Record<Mp3Kind, Partial<typeof trackProcessings.$inferInsert>>;
    await this.txHost.tx
      .update(trackProcessings)
      .set(values[kind])
      .where(eq(trackProcessings.id, processingId));
  }

  /** Locks the row while it is in the lyrics stage: false when it moved on. */
  async lockLyricsStage(processingId: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .select({ id: trackProcessings.id })
      .from(trackProcessings)
      .where(processingInStatus(processingId, ['EXTRACTING_LYRICS']))
      .for('update');
    return rows.length > 0;
  }

  /** Serializes the User's Track requests (see `TrackRequestLimitRepository`). */
  lockRequester(userId: string): Promise<void> {
    return this.requestLimits.lockRequester(userId);
  }

  /** The Track and end of a terminal Processing whose Contributors are not emailed yet. */
  async findEndedWithoutEmails(processingId: string) {
    const [row] = await this.txHost.tx
      .select({
        trackId: trackProcessings.trackId,
        status: trackProcessings.status,
        title: tracks.title,
        artistCredit: tracks.artistCredit,
        coverUrl: tracks.coverUrl,
        vocalRangeLowest: tracks.vocalRangeLowest,
        vocalRangeHighest: tracks.vocalRangeHighest,
      })
      .from(trackProcessings)
      .innerJoin(tracks, eq(tracks.id, trackProcessings.trackId))
      .where(
        and(
          processingInStatus(processingId, TRACK_PROCESSING_TERMINAL_STATUSES),
          isNull(trackProcessings.contributorsNotifiedAt),
        ),
      );
    return row;
  }

  /** Records that a Processing's Contributor emails were all queued (see the notifier). */
  async markContributorsEmailed(processingId: string): Promise<void> {
    await this.txHost.tx
      .update(trackProcessings)
      .set({ contributorsNotifiedAt: new Date() })
      .where(
        and(
          eq(trackProcessings.id, processingId),
          isNull(trackProcessings.contributorsNotifiedAt),
        ),
      );
  }

  /** The non-terminal Processings that the User's Contributions started. */
  countActiveProcessings(userId: string): Promise<number> {
    return this.requestLimits.countActiveProcessings(userId);
  }

  /** The User's CREATE Contributions made in `[start, end)`: Tracks they asked for. */
  countNewTracksBetween(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.requestLimits.countNewTracksBetween(userId, start, end);
  }
}
