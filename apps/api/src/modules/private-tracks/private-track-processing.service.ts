import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { RunpodJobState } from '../../integrations/note-detection/runpod-job.js';
import {
  privateTrackMediaKey,
  privateTrackStagingKey,
} from './private-track-object-keys.js';
import {
  CLEAN_PRIVATE_TRACK_ASSETS_JOB,
  type CleanPrivateTrackAssetsJob,
  cleanPrivateTrackAssetsJobSchema,
  PRIVATE_TRACK_PROCESSING_QUEUE,
  PROCESS_PRIVATE_TRACK_JOB,
  type ProcessPrivateTrackJob,
  privateTrackPollingJobId,
  processPrivateTrackJobSchema,
} from './private-track-processing.job.js';
import { PrivateTrackProcessingIntegrations } from './private-track-processing-integrations.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

const PRIVATE_UPLOAD_TTL_SECONDS = 2 * 60 * 60;
const NOTE_POLL_INTERVAL_MS = 5_000;
const MAX_NOTE_POLL_ROUNDS = 120;
const MAX_QUEUED_TRACKS_PER_RECONCILIATION = 100;
const PRIVATE_TRACK_STALE_START_MS = 60_000;
const DETECTOR_OUTPUT = z.object({
  vocalsUrl: z.string().min(1),
  pitchCurveUrl: z.string().min(1),
  detectorVersion: z.string().min(1),
  notes: z.array(
    z.object({
      pitch: z.number(),
      start: z.number().nonnegative(),
      end: z.number().nonnegative(),
    }),
  ),
});

@Injectable()
export class PrivateTrackProcessingService {
  constructor(
    @InjectQueue(PRIVATE_TRACK_PROCESSING_QUEUE)
    private readonly queue: Queue<
      ProcessPrivateTrackJob | CleanPrivateTrackAssetsJob
    >,
    private readonly tracks: PrivateTracksRepository,
    private readonly integrations: PrivateTrackProcessingIntegrations,
  ) {}

  async enqueue(userId: string, privateTrackId: string): Promise<void> {
    await this.queue.add(
      PROCESS_PRIVATE_TRACK_JOB,
      { userId, privateTrackId, poll: 0 },
      { jobId: privateTrackId, removeOnComplete: true },
    );
  }

  async reconcileQueuedTracks(): Promise<void> {
    const recoverable = await this.tracks.listRecoverable(
      MAX_QUEUED_TRACKS_PER_RECONCILIATION,
      new Date(Date.now() - PRIVATE_TRACK_STALE_START_MS),
    );
    for (const track of recoverable) await this.enqueue(track.userId, track.id);
  }

  async process(rawJob: unknown): Promise<void> {
    const job = processPrivateTrackJobSchema.parse(rawJob);
    const track = await this.tracks.findOwned(job.userId, job.privateTrackId);
    if (!track || isTerminal(track.processingStatus)) return;
    const musicKey = await this.ensureMusicWav(track);
    if (musicKey === null) return;
    const runpodJobId = track.processingJobId;
    const attemptId = track.processingAttemptId;
    if (runpodJobId === null) {
      await this.startDetection(track.userId, track.id, musicKey, attemptId);
      return;
    }
    if (
      job.poll > 0 &&
      (job.attemptId === undefined || job.attemptId !== attemptId)
    ) {
      return;
    }
    if (!attemptId) return;
    await this.pollDetection(track.id, attemptId, runpodJobId, job.poll);
  }

  async cleanAssets(rawJob: unknown): Promise<void> {
    const { keys } = cleanPrivateTrackAssetsJobSchema.parse(rawJob);
    for (const key of keys) {
      if (!(await this.tracks.isPrivateObjectReferenced(key))) {
        await this.integrations.storage.deletePrivateObject(key);
      }
    }
  }

  async markFailed(
    privateTrackId: string,
    attemptId: string | null,
  ): Promise<void> {
    await this.tracks.markFailedForAttempt(privateTrackId, attemptId);
  }

  private async ensureMusicWav(
    track: NonNullable<
      Awaited<ReturnType<PrivateTracksRepository['findOwned']>>
    >,
  ): Promise<string | null> {
    if (track.mediaObjectKey !== null) return track.mediaObjectKey;
    const directory = await mkdtemp(join(tmpdir(), 'vozzify-private-track-'));
    try {
      const sourcePath = join(directory, 'source.audio');
      const wavPath = join(directory, 'music.wav');
      await this.integrations.storage.downloadPrivateFile(
        track.objectKey,
        sourcePath,
      );
      await this.integrations.ffmpeg.convertPrivateAudioFileToWav(
        sourcePath,
        wavPath,
      );
      const key = privateTrackMediaKey(track.userId, track.id);
      await this.integrations.storage.putPrivateFile({
        key,
        filePath: wavPath,
        contentType: 'audio/wav',
      });
      const saved = await this.tracks.saveMusicMedia(track.id, key);
      return saved ? key : null;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async startDetection(
    userId: string,
    privateTrackId: string,
    musicKey: string,
    existingAttemptId: string | null,
  ): Promise<void> {
    const attemptId = randomUUID();
    const claimed = await this.tracks.claimProcessingAttempt(
      privateTrackId,
      existingAttemptId,
      attemptId,
    );
    if (!claimed) return;
    const input = await this.integrations.detectorInput(
      userId,
      privateTrackId,
      musicKey,
      attemptId,
    );
    const vocalsKey = privateTrackStagingKey(
      userId,
      privateTrackId,
      attemptId,
      'vocals.wav',
    );
    const pitchCurveKey = privateTrackStagingKey(
      userId,
      privateTrackId,
      attemptId,
      'pitch-curve.bin',
    );
    await this.scheduleAssetCleanup(privateTrackId, [vocalsKey, pitchCurveKey]);
    const jobId = await this.integrations.detector.startJob(input);
    const saved = await this.tracks.saveProcessingJob(
      privateTrackId,
      attemptId,
      jobId,
    );
    if (!saved) return;
    await this.enqueuePoll(userId, privateTrackId, attemptId, 1);
  }

  private async pollDetection(
    privateTrackId: string,
    attemptId: string,
    runpodJobId: string,
    poll: number,
  ): Promise<void> {
    const state = await this.integrations.detector.checkJob(runpodJobId);
    if (state.kind === 'failed') {
      await this.tracks.updateProcessingAttempt(
        privateTrackId,
        attemptId,
        runpodJobId,
        { processingStatus: 'FAILED', processingProgress: 0 },
      );
      return;
    }
    if (state.kind === 'completed') {
      await this.saveOutput(privateTrackId, attemptId, runpodJobId, state);
      return;
    }
    if (poll >= MAX_NOTE_POLL_ROUNDS) {
      await this.tracks.updateProcessingAttempt(
        privateTrackId,
        attemptId,
        runpodJobId,
        { processingStatus: 'FAILED', processingProgress: 0 },
      );
      return;
    }
    const progress = state.stage === 'DETECTING_NOTES' ? 70 : 35;
    const updated = await this.tracks.updateProcessingAttempt(
      privateTrackId,
      attemptId,
      runpodJobId,
      {
        processingStatus: state.stage ?? 'EXTRACTING_VOCALS',
        processingProgress: progress,
      },
    );
    if (!updated) return;
    const track = await this.tracks.findById(privateTrackId);
    if (track && track.processingAttemptId === attemptId) {
      await this.enqueuePoll(track.userId, privateTrackId, attemptId, poll + 1);
    }
  }

  @Transactional()
  private async saveOutput(
    privateTrackId: string,
    attemptId: string,
    runpodJobId: string,
    state: Extract<RunpodJobState, { kind: 'completed' }>,
  ): Promise<void> {
    const output = DETECTOR_OUTPUT.parse(state.output);
    const track = await this.tracks.findById(privateTrackId);
    if (!track) return;
    const vocalsKey = privateTrackStagingKey(
      track.userId,
      track.id,
      attemptId,
      'vocals.wav',
    );
    const pitchCurveKey = privateTrackStagingKey(
      track.userId,
      track.id,
      attemptId,
      'pitch-curve.bin',
    );
    if (
      output.vocalsUrl !==
        this.integrations.storage.privateObjectUrl(vocalsKey) ||
      output.pitchCurveUrl !==
        this.integrations.storage.privateObjectUrl(pitchCurveKey)
    ) {
      throw new Error('The note detector returned unexpected private assets');
    }
    const stored = await this.tracks.replaceNotes({
      privateTrackId: track.id,
      attemptId,
      jobId: runpodJobId,
      notes: output.notes,
      processingValues: {
        processingStatus: 'COMPLETED',
        processingProgress: 100,
        vocalsObjectKey: vocalsKey,
        pitchCurveObjectKey: pitchCurveKey,
        detectorVersion: output.detectorVersion,
      },
    });
    if (!stored) {
      await this.scheduleAssetCleanup(track.id, [vocalsKey, pitchCurveKey]);
      return;
    }
    if (!stored)
      await this.scheduleAssetCleanup(track.id, [vocalsKey, pitchCurveKey]);
  }

  private async enqueuePoll(
    userId: string,
    privateTrackId: string,
    attemptId: string,
    poll: number,
  ): Promise<void> {
    await this.queue.add(
      PROCESS_PRIVATE_TRACK_JOB,
      { userId, privateTrackId, attemptId, poll },
      {
        jobId: privateTrackPollingJobId(privateTrackId, attemptId, poll),
        delay: NOTE_POLL_INTERVAL_MS,
      },
    );
  }

  private async scheduleAssetCleanup(
    privateTrackId: string,
    keys: string[],
  ): Promise<void> {
    await this.queue.add(
      CLEAN_PRIVATE_TRACK_ASSETS_JOB,
      { keys },
      {
        jobId: `cleanup-${privateTrackId}-${randomUUID()}`,
        delay: PRIVATE_UPLOAD_TTL_SECONDS * 1000,
      },
    );
  }
}

function isTerminal(status: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}
