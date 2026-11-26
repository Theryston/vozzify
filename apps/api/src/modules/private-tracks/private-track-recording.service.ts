import { Injectable } from '@nestjs/common';
import type { Mbid, PrivateTrackRecording } from '@vozzify/contracts';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';

const MAX_MERGE_HOPS = 3;

@Injectable()
export class PrivateTrackRecordingService {
  constructor(private readonly catalog: MusicCatalogClient) {}

  async lookup(
    mbid: Mbid,
    hopsLeft = MAX_MERGE_HOPS,
  ): Promise<{
    recording: PrivateTrackRecording;
    lengthMs: number | null;
  } | null> {
    const lookup = await this.catalog.getRecording(mbid);
    if (lookup.status === 'not-found') return null;
    if (lookup.status === 'moved') {
      return hopsLeft > 0 ? this.lookup(lookup.newMbid, hopsLeft - 1) : null;
    }
    const { recording } = lookup;
    return {
      recording: {
        mbid: recording.mbid,
        title: recording.title,
        artist: recording.artistCredit.name,
        coverUrl: recording.releases[0]?.coverArtUrl ?? null,
      },
      lengthMs: recording.lengthMs,
    };
  }
}
