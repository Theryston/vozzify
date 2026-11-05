import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type {
  CreateTrackBody,
  Locale,
  Mbid,
  Recording,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import { trackRowsFromRecording } from './track-from-recording.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import type { TrackRequester } from './track-requester.service.js';
import { TrackRequesterService } from './track-requester.service.js';
import { TracksRepository } from './tracks.repository.js';

/** How many merges a Recording may have been through before a request gives up. */
const MAX_MERGE_HOPS = 3;

/** What a request resolved to: the Track, and whether this request created it. */
export type RequestedTrack = { trackId: string; created: boolean };

/**
 * Asks for a Recording to become a Track (ADR 0005). The Track exists from
 * this request: its first Processing is queued and the requesting User is
 * its Contributor through a CREATE Contribution. A Recording that already has a
 * Track is answered with that Track, and nothing is written. Before a new Track
 * is written, the requester's limits are checked (see `TrackRequesterService`).
 */
@Injectable()
export class TrackRequestService {
  constructor(
    private readonly tracks: TracksRepository,
    private readonly processings: TrackProcessingRepository,
    private readonly catalog: MusicCatalogClient,
    private readonly requesters: TrackRequesterService,
  ) {}

  /**
   * Reads the Recording from the Music catalog (following a merge), then
   * creates the Track unless one already has that Recording. The catalog call
   * stays outside the transaction: only the writes are one unit. The limits
   * are checked only when a Track would be created, so a Recording that already
   * has one is never refused.
   */
  async requestTrack(
    requester: TrackRequester,
    body: CreateTrackBody,
  ): Promise<RequestedTrack> {
    const existing = await this.findTrackId(body.recordingMbid);
    if (existing !== undefined) {
      return { trackId: existing, created: false };
    }
    const recording = await this.resolveRecording(
      body.recordingMbid,
      MAX_MERGE_HOPS,
    );
    const existingByCurrentMbid = await this.findTrackId(recording.mbid);
    if (existingByCurrentMbid !== undefined) {
      return { trackId: existingByCurrentMbid, created: false };
    }
    return this.createTrack(requester, recording, body.locale);
  }

  /**
   * The Recording behind an MBID. A merged Recording is followed to the MBID it
   * was merged into, a bounded number of times; one the catalog does not know
   * is `NOT_FOUND`.
   */
  async resolveRecording(
    mbid: Mbid,
    hopsLeft: number = MAX_MERGE_HOPS,
  ): Promise<Recording> {
    const lookup = await this.catalog.getRecording(mbid);
    if (lookup.status === 'found') {
      return lookup.recording;
    }
    if (lookup.status === 'not-found' || hopsLeft === 0) {
      throw new AppException('NOT_FOUND', 'Recording not found');
    }
    return this.resolveRecording(lookup.newMbid, hopsLeft - 1);
  }

  /**
   * Checks the requester's limits, then writes the Track, its first Processing,
   * the requesting User's Contributor and CREATE Contribution, and the User's
   * locale, as one unit. The limit check runs first, under the requester's
   * lock, so a refusal writes nothing. When a concurrent request created the
   * Track first, this one writes nothing and answers with that Track.
   */
  @Transactional()
  private async createTrack(
    requester: TrackRequester,
    recording: Recording,
    locale: Locale,
  ): Promise<RequestedTrack> {
    await this.requesters.assertCanRequestTrack(requester);
    const { track, ...details } = trackRowsFromRecording(recording);
    const trackId = await this.tracks.insertTrack(track);
    if (trackId === undefined) {
      return this.existingTrack(recording.mbid);
    }
    await this.tracks.insertTrackDetails(trackId, details);
    await this.tracks.insertAssociationEvent(recording.mbid, trackId);
    const processingId = await this.processings.insertQueuedProcessing(trackId);
    const contributorId = await this.processings.findOrInsertContributor(
      trackId,
      requester.id,
    );
    await this.processings.insertContribution({
      contributorId,
      kind: 'CREATE',
      processingId,
    });
    await this.requesters.recordLocale(requester.id, locale);
    return { trackId, created: true };
  }

  private async existingTrack(mbid: Mbid): Promise<RequestedTrack> {
    const trackId = await this.findTrackId(mbid);
    if (trackId === undefined) {
      throw new AppException(
        'INTERNAL_ERROR',
        'Track disappeared while it was being requested',
      );
    }
    return { trackId, created: false };
  }

  private async findTrackId(mbid: Mbid): Promise<string | undefined> {
    return (await this.tracks.findTrackIdsByRecordingMbids([mbid])).get(mbid);
  }
}
