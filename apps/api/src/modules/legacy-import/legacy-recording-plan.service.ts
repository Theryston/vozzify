import { Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Mbid, Recording } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import type { LegacyTrack } from './legacy-recording.js';
import {
  chooseRecordingMatch,
  matchLegacyTrack,
  summaryCouldMatch,
} from './legacy-recording-matching.js';
import { LegacyRecordingPlanRepository } from './legacy-recording-plan.repository.js';
import type { LegacySourceSnapshot } from './legacy-source.repository.js';

export type LegacyRecordingPlanReport = {
  status: 'complete' | 'incomplete';
  sourceTracks: number;
  plannedTracks: number;
  skippedTracks: number;
  initialContributors: number;
  skippedDependentFavorites: number;
  skippedDependentViews: number;
  errors: string[];
};

const SEARCH_LIMIT = 20;
const MAX_MERGE_HOPS = 8;

export type LegacyRecordingSource = Pick<
  LegacySourceSnapshot,
  'validateRecordingSource' | 'recordingPage'
>;

@Injectable()
export class LegacyRecordingPlanService {
  private readonly logger = new Logger(LegacyRecordingPlanService.name);

  constructor(
    private readonly repository: LegacyRecordingPlanRepository,
    private readonly catalog: MusicCatalogClient,
  ) {}

  async run(source: LegacyRecordingSource): Promise<LegacyRecordingPlanReport> {
    const report = emptyReport();
    try {
      const inventory = await source.validateRecordingSource();
      report.sourceTracks = inventory.tracks;
      const progress = await this.repository.prepare(
        inventory.digest,
        inventory.tracks,
      );
      if (progress.status === 'complete') {
        await this.populateReport(report, inventory.tracks);
      } else {
        await this.resolveInventory(source, inventory.digest, inventory.tracks);
        await this.completePlan();
        await this.populateReport(report, inventory.tracks);
      }
      report.status = 'complete';
    } catch (error) {
      report.errors.push(safeFailureCode(error));
      try {
        await this.populateProgress(report);
      } catch {
        report.errors.push('RECORDING_PLAN_PROGRESS_UNAVAILABLE');
      }
    }
    this.logger.log(JSON.stringify(report));
    return report;
  }

  private async resolveInventory(
    source: LegacyRecordingSource,
    sourceDigest: string,
    sourceTracks: number,
  ): Promise<void> {
    let cursor: string | null = null;
    let scannedTracks = 0;
    for (;;) {
      const page = await source.recordingPage(cursor);
      if (page.length === 0) break;
      for (const track of page) {
        scannedTracks++;
        await this.planUnlessSaved(track, sourceDigest);
        cursor = track.id;
      }
    }
    if (scannedTracks !== sourceTracks) throw new Error('SOURCE_CHANGED');
    const counts = await this.repository.counts();
    if (counts.planned + counts.skipped !== sourceTracks) {
      throw new Error('RECORDING_PLAN_INCOMPLETE');
    }
  }

  @Transactional()
  private async completePlan(): Promise<void> {
    await this.repository.complete();
  }

  private async planUnlessSaved(
    track: LegacyTrack,
    sourceDigest: string,
  ): Promise<void> {
    const alreadyPlanned = await this.repository.assertPlanSource(
      track,
      sourceDigest,
    );
    if (alreadyPlanned) return;
    const decision = await this.resolve(track);
    await this.repository.save(track, sourceDigest, decision);
  }

  private async populateReport(
    report: LegacyRecordingPlanReport,
    sourceTracks: number,
  ): Promise<void> {
    await this.populateProgress(report);
    if (report.plannedTracks + report.skippedTracks !== sourceTracks) {
      throw new Error('RECORDING_PLAN_INCOMPLETE');
    }
  }

  private async populateProgress(
    report: LegacyRecordingPlanReport,
  ): Promise<void> {
    const counts = await this.repository.counts();
    report.plannedTracks = counts.planned;
    report.skippedTracks = counts.skipped;
    report.initialContributors =
      await this.repository.initialContributorCount();
    await this.addDependentCounts(report);
  }

  private async addDependentCounts(
    report: LegacyRecordingPlanReport,
  ): Promise<void> {
    const skipped = await this.repository.skippedDependents();
    report.skippedDependentFavorites = skipped.favorites;
    report.skippedDependentViews = skipped.views;
  }

  private async resolve(track: LegacyTrack) {
    if (track.title === null || track.title.trim() === '') {
      return {
        recordingMbid: null,
        rationale: 'no-acceptable-recording:missing-title',
        skipReason: 'MISSING_TITLE',
      };
    }

    const query = [
      track.title,
      ...track.artists.slice(0, 3).map(({ name }) => name),
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 256);
    const search = await this.catalog.search({
      query,
      limit: SEARCH_LIMIT,
      offset: 0,
    });
    const resolved = new Map<string, Recording>();
    for (const hit of search.results.filter((item) =>
      summaryCouldMatch(track, item),
    )) {
      const recording = await this.followMerges(hit.mbid);
      if (recording !== null) resolved.set(recording.mbid, recording);
    }
    const match = chooseRecordingMatch(
      [...resolved.values()]
        .map((recording) => matchLegacyTrack(track, recording))
        .filter((candidate) => candidate !== null),
    );
    if (match === null) {
      return {
        recordingMbid: null,
        rationale: 'no-acceptable-recording:metadata-evidence-insufficient',
        skipReason: 'NO_ACCEPTABLE_RECORDING',
      };
    }
    return {
      recordingMbid: match.recording.mbid,
      rationale: match.rationale,
      skipReason: null,
    };
  }

  private async followMerges(mbid: string): Promise<Recording | null> {
    const seen = new Set<string>();
    let currentMbid = mbid;
    for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
      if (seen.has(currentMbid)) throw new Error('CATALOG_MERGE_CYCLE');
      seen.add(currentMbid);
      const answer = await this.catalog.getRecording(currentMbid as Mbid);
      if (answer.status === 'found') return answer.recording;
      if (answer.status === 'not-found') return null;
      currentMbid = answer.newMbid;
    }
    throw new Error('CATALOG_MERGE_LIMIT');
  }
}

const emptyReport = (): LegacyRecordingPlanReport => ({
  status: 'incomplete',
  sourceTracks: 0,
  plannedTracks: 0,
  skippedTracks: 0,
  initialContributors: 0,
  skippedDependentFavorites: 0,
  skippedDependentViews: 0,
  errors: [],
});

const safeFailureCode = (error: unknown): string => {
  const allowed = new Set([
    'SOURCE_CHANGED',
    'SOURCE_DISCONNECTED',
    'RECORDING_PLAN_INCOMPLETE',
    'CATALOG_MERGE_CYCLE',
    'CATALOG_MERGE_LIMIT',
    'SERVICE_UNAVAILABLE',
    'GATEWAY_TIMEOUT',
  ]);
  if (error instanceof AppException && allowed.has(error.code)) {
    return error.code;
  }
  return error instanceof Error && allowed.has(error.message)
    ? error.message
    : 'RECORDING_PLAN_FAILED';
};
