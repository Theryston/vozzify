import { Injectable } from '@nestjs/common';
import { type CatalogTrack, type Mbid } from '@vozzify/contracts';
import { throwMovedOrMissing } from './track-not-found.js';
import { TracksRepository } from './tracks.repository.js';

@Injectable()
export class TracksService {
  constructor(private readonly tracksRepository: TracksRepository) {}

  /**
   * The catalog details of the Tracks given, in the order given. Every list
   * of catalog tracks (an artist's, an album's) reads them through here, so
   * they all show the same `CatalogTrack`. IDs with no Track are left out.
   * Reads never touch the Music catalog.
   */
  async getCatalogTracks(trackIds: readonly string[]): Promise<CatalogTrack[]> {
    const found = await this.tracksRepository.findCatalogTracks([...trackIds]);
    const byId = new Map(found.map((track) => [track.id, track]));
    return trackIds.flatMap((trackId) => {
      const track = byId.get(trackId);
      return track ? [track] : [];
    });
  }

  /**
   * Resolves when the Track exists. A legacy Track ID answers `RESOURCE_MOVED`
   * with the new ID and an unknown one `NOT_FOUND`, as every Track read does.
   */
  async assertTrackExists(trackId: string): Promise<void> {
    if ((await this.tracksRepository.findTrackHeader(trackId)) !== undefined) {
      return;
    }
    await throwMovedOrMissing(this.tracksRepository, trackId);
  }

  /** The MBID of the Recording a Track was created from; undefined for an unknown Track. */
  findRecordingMbid(trackId: string): Promise<string | undefined> {
    return this.tracksRepository.findRecordingMbid(trackId);
  }

  /** Whether the Track has a completed Processing, the state its Artist and Album pages list it in. */
  isTrackCompleted(trackId: string): Promise<boolean> {
    return this.tracksRepository.isTrackCompleted(trackId);
  }

  /**
   * Track ids keyed by recording MBID, for the MBIDs given. Only processed
   * Recordings are present; the caller maps a miss to null (static card).
   */
  findTrackIdsByRecordingMbids(mbids: Mbid[]): Promise<Map<string, string>> {
    return this.tracksRepository.findTrackIdsByRecordingMbids(mbids);
  }
}
