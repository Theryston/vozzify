import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FfmpegModule } from '../../integrations/ffmpeg/ffmpeg.module.js';
import { NoteDetectionModule } from '../../integrations/note-detection/note-detection.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PrivateTrackMediaController } from './private-track-media.controller.js';
import { PrivateTrackMediaService } from './private-track-media.service.js';
import { PRIVATE_TRACK_PROCESSING_QUEUE } from './private-track-processing.job.js';
import { PrivateTrackProcessingProcessor } from './private-track-processing.processor.js';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';
import { PrivateTrackProcessingIntegrations } from './private-track-processing-integrations.js';
import { PrivateTracksController } from './private-tracks.controller.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { PrivateTracksService } from './private-tracks.service.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: PRIVATE_TRACK_PROCESSING_QUEUE }),
    FfmpegModule,
    NoteDetectionModule,
    PlansModule,
    StorageModule,
  ],
  controllers: [PrivateTracksController, PrivateTrackMediaController],
  providers: [
    PrivateAudioInspector,
    PrivateTracksRepository,
    PrivateTracksService,
    PrivateTrackProcessingService,
    PrivateTrackProcessingIntegrations,
    PrivateTrackProcessingProcessor,
    PrivateTrackMediaService,
  ],
})
export class PrivateTracksModule {}
