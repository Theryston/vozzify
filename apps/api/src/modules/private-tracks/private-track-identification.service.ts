import { Injectable } from '@nestjs/common';
import { AcoustidClient } from '../../integrations/acoustid/acoustid.client.js';
import { PrivateTrackFingerprintService } from './private-track-fingerprint.service.js';
import { PrivateTrackMetadataRepository } from './private-track-metadata.repository.js';
import { PrivateTrackRecordingService } from './private-track-recording.service.js';

function withinRecordingDuration(
  sourceMs: number,
  catalogMs: number | null,
): boolean {
  if (catalogMs === null) return true;
  // Allow small encoding/cut differences, but reject partial matches where
  // the shared fingerprint does not represent most of the Recording.
  const toleranceMs = Math.min(10_000, Math.max(3_000, catalogMs * 0.025));
  return Math.abs(sourceMs - catalogMs) <= toleranceMs;
}

@Injectable()
export class PrivateTrackIdentificationService {
  constructor(
    private readonly tracks: PrivateTrackMetadataRepository,
    private readonly acoustid: AcoustidClient,
    private readonly fingerprints: PrivateTrackFingerprintService,
    private readonly recordings: PrivateTrackRecordingService,
  ) {}

  async identify(privateTrackId: string): Promise<void> {
    if (!this.acoustid.isConfigured()) return;
    const track = await this.tracks.findPendingAudio(privateTrackId);
    if (!track?.mediaObjectKey) return;
    const fingerprint = await this.fingerprints.fromMedia(track.mediaObjectKey);
    if (!(await this.tracks.findPendingAudio(privateTrackId))) return;
    const mbid = fingerprint
      ? await this.acoustid.lookup(fingerprint, track.durationMs)
      : null;
    const match = mbid ? await this.recordings.lookup(mbid) : null;
    await this.tracks.saveIdentification(
      privateTrackId,
      match && withinRecordingDuration(track.durationMs, match.lengthMs)
        ? { kind: 'linked', recording: match.recording }
        : { kind: 'unmatched' },
    );
  }
}
