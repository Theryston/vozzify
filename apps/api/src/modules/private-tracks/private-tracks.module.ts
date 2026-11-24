import { Module } from '@nestjs/common';
import { FfmpegModule } from '../../integrations/ffmpeg/ffmpeg.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PrivateTracksController } from './private-tracks.controller.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { PrivateTracksService } from './private-tracks.service.js';

@Module({
  imports: [FfmpegModule, PlansModule, StorageModule],
  controllers: [PrivateTracksController],
  providers: [
    PrivateAudioInspector,
    PrivateTracksRepository,
    PrivateTracksService,
  ],
})
export class PrivateTracksModule {}
