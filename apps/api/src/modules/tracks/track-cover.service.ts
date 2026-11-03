import { Injectable, Logger } from '@nestjs/common';
import {
  CoverArtClient,
  type DownloadedImage,
} from '../../integrations/cover-art/cover-art.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { COVER_CONTENT_TYPE, toStoredCover } from './track-cover-image.js';
import type { PipelineTrack } from './track-repository.helpers.js';
import { TracksRepository } from './tracks.repository.js';

/** The catalog's chosen release, with the chosen video's thumbnail as fallback. */
@Injectable()
export class TrackCoverService {
  private readonly logger = new Logger(TrackCoverService.name);

  constructor(
    private readonly tracks: TracksRepository,
    private readonly coverArt: CoverArtClient,
    private readonly storage: StorageService,
  ) {}

  /** Replayed jobs keep any cover already stored. */
  storeCover(trackId: string): Promise<boolean> {
    return this.store(trackId);
  }

  /** Repair uses a distinct key so a failed replacement preserves the old image. */
  repairCover(
    trackId: string,
    primaryReleaseMbid: string | null,
  ): Promise<boolean> {
    return this.store(trackId, primaryReleaseMbid);
  }

  private async store(
    trackId: string,
    replacementRelease?: string | null,
  ): Promise<boolean> {
    const track = await this.tracks.findPipelineTrack(trackId);
    if (track === undefined) return false;
    const repairing = replacementRelease !== undefined;
    if (!repairing && track.coverUrl !== null) return false;
    const primaryReleaseMbid = repairing
      ? replacementRelease
      : track.primaryReleaseMbid;
    const source = primaryReleaseMbid ?? `youtube-${track.youtubeVideoId}`;
    const key = repairing
      ? `track-covers/${trackId}/${source}.webp`
      : `track-covers/${trackId}.webp`;
    const coverUrl = this.storage.publicUrl(key);
    if (track.coverUrl === coverUrl) return false;
    const image = await this.findCoverImage({ ...track, primaryReleaseMbid });
    const body =
      image === undefined ? undefined : await toStoredCover(image.bytes);
    if (body === undefined) {
      return this.missingCover(track, replacementRelease);
    }
    await this.storage.putPublicObject({
      key,
      body,
      contentType: COVER_CONTENT_TYPE,
    });
    await this.tracks.setCover(trackId, { coverUrl, primaryReleaseMbid });
    return true;
  }

  private async missingCover(
    track: PipelineTrack,
    replacementRelease: string | null | undefined,
  ): Promise<false> {
    if (replacementRelease !== undefined) {
      if (track.coverUrl !== null) {
        throw new Error(`No replacement cover for Track ${track.id}`);
      }
      await this.tracks.setCover(track.id, {
        coverUrl: null,
        primaryReleaseMbid: replacementRelease,
      });
    }
    this.logger.warn(`No usable cover for Track ${track.id}`);
    return false;
  }

  private async findCoverImage(
    track: PipelineTrack,
  ): Promise<DownloadedImage | undefined> {
    if (track.primaryReleaseMbid !== null) {
      const image = await this.coverArt.fetchReleaseFrontCover(
        track.primaryReleaseMbid,
      );
      if (image !== undefined) return image;
    }
    return track.youtubeVideoId === null
      ? undefined
      : this.coverArt.fetchImage(
          `https://i.ytimg.com/vi/${track.youtubeVideoId}/hqdefault.jpg`,
        );
  }
}
