import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AudioDownloadModule } from '../../integrations/audio-download/audio-download.module.js';
import { FfmpegModule } from '../../integrations/ffmpeg/ffmpeg.module.js';
import { NoteDetectionModule } from '../../integrations/note-detection/note-detection.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { YouTubeMusicModule } from '../../integrations/youtube-music/youtube-music.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PRIVATE_TRACK_ASSET_CLEANUP_QUEUE } from './private-track-asset-cleanup.job.js';
import { PrivateTrackAssetCleanupProcessor } from './private-track-asset-cleanup.processor.js';
import { PrivateTrackAssetCleanupQueue } from './private-track-asset-cleanup.queue.js';
import { PrivateTrackDeletionService } from './private-track-deletion.service.js';
import { PrivateTrackMediaController } from './private-track-media.controller.js';
import { PrivateTrackMediaService } from './private-track-media.service.js';
import { PRIVATE_TRACK_PROCESSING_QUEUE } from './private-track-processing.job.js';
import { PrivateTrackProcessingProcessor } from './private-track-processing.processor.js';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';
import { PrivateTrackProcessingIntegrations } from './private-track-processing-integrations.js';
import { PrivateTrackSourceStorage } from './private-track-source-storage.js';
import { PrivateTrackWorkflowService } from './private-track-workflow.service.js';
import { PrivateTracksController } from './private-tracks.controller.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { PrivateTracksService } from './private-tracks.service.js';
import { PrivateYouTubeTracksController } from './private-youtube-tracks.controller.js';
import { PrivateYouTubeTracksRepository } from './private-youtube-tracks.repository.js';
import { PrivateYouTubeTracksService } from './private-youtube-tracks.service.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: PRIVATE_TRACK_PROCESSING_QUEUE }),
    BullModule.registerQueue({ name: PRIVATE_TRACK_ASSET_CLEANUP_QUEUE }),
    FfmpegModule,
    NoteDetectionModule,
    PlansModule,
    StorageModule,
    AudioDownloadModule,
    YouTubeMusicModule,
  ],
  controllers: [
    PrivateTracksController,
    PrivateTrackMediaController,
    PrivateYouTubeTracksController,
  ],
  providers: [
    PrivateAudioInspector,
    PrivateTracksRepository,
    PrivateTracksService,
    PrivateTrackSourceStorage,
    PrivateTrackDeletionService,
    PrivateTrackProcessingService,
    PrivateTrackProcessingIntegrations,
    PrivateTrackProcessingProcessor,
    PrivateTrackMediaService,
    PrivateTrackWorkflowService,
    PrivateTrackAssetCleanupQueue,
    PrivateTrackAssetCleanupProcessor,
    PrivateYouTubeTracksRepository,
    PrivateYouTubeTracksService,
  ],
  exports: [PrivateTrackAssetCleanupQueue],
})
export class PrivateTracksModule {}
