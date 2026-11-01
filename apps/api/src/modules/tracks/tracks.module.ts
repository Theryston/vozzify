import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AudioDownloadModule } from '../../integrations/audio-download/audio-download.module.js';
import { CoverArtModule } from '../../integrations/cover-art/cover-art.module.js';
import { ElevenLabsTranscriptionModule } from '../../integrations/elevenlabs/elevenlabs-transcription.module.js';
import { EmailModule } from '../../integrations/email/email.module.js';
import { FfmpegModule } from '../../integrations/ffmpeg/ffmpeg.module.js';
import { MusicCatalogModule } from '../../integrations/music-catalog/music-catalog.module.js';
import { NoteDetectionModule } from '../../integrations/note-detection/note-detection.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { YouTubeMusicModule } from '../../integrations/youtube-music/youtube-music.module.js';
import { TRACK_METADATA_QUEUE } from '../../queue/track-metadata.job.js';
import { UsersModule } from '../users/users.module.js';
import { TrackAlbumCoverService } from './track-album-cover.service.js';
import { TRACK_ASSOCIATION_QUEUE } from './track-association.job.js';
import { TrackAssociationProcessor } from './track-association.processor.js';
import { TrackAssociationService } from './track-association.service.js';
import { TrackAssociationEventRepository } from './track-association-event.repository.js';
import { TrackAssociationSyncRepository } from './track-association-sync.repository.js';
import { TrackAssociationSyncService } from './track-association-sync.service.js';
import { TrackAudioService } from './track-audio.service.js';
import { TrackContributionsService } from './track-contributions.service.js';
import { TrackContributorRepository } from './track-contributor.repository.js';
import { TrackContributorEmailsService } from './track-contributor-emails.service.js';
import { TrackCoverService } from './track-cover.service.js';
import { TrackDirectAudioController } from './track-direct-audio.controller.js';
import { TrackDirectAudioRepository } from './track-direct-audio.repository.js';
import { TrackDirectAudioService } from './track-direct-audio.service.js';
import { TrackJobRunnerService } from './track-job-runner.service.js';
import { TrackLocaleTrendingService } from './track-locale-trending.service.js';
import { TrackLyricsController } from './track-lyrics.controller.js';
import { TrackLyricsRepository } from './track-lyrics.repository.js';
import { TrackLyricsService } from './track-lyrics.service.js';
import { TrackLyricsStepService } from './track-lyrics-step.service.js';
import { TrackMetadataQueueService } from './track-metadata-queue.service.js';
import { TRACK_MP3_QUEUE } from './track-mp3.job.js';
import { TrackMp3Processor } from './track-mp3.processor.js';
import { TrackMp3Service } from './track-mp3.service.js';
import { TrackNoteDetectionService } from './track-note-detection.service.js';
import { TrackNotesRepository } from './track-notes.repository.js';
import { TrackNotesService } from './track-notes.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';
import { TrackPracticeRepository } from './track-practice.repository.js';
import { TrackPracticeService } from './track-practice.service.js';
import { TRACK_PROCESSING_QUEUE } from './track-processing.job.js';
import { TrackProcessingProcessor } from './track-processing.processor.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingService } from './track-processing.service.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import { TrackRecommendationsController } from './track-recommendations.controller.js';
import { TrackRecommendationsRepository } from './track-recommendations.repository.js';
import { TrackRecommendationsService } from './track-recommendations.service.js';
import { TrackRequestService } from './track-request.service.js';
import { TrackRequestFlowService } from './track-request-flow.service.js';
import { TrackRequestLauncherService } from './track-request-launcher.service.js';
import { TrackRequestLimitRepository } from './track-request-limit.repository.js';
import { TrackRequesterService } from './track-requester.service.js';
import { TrackRetryRepository } from './track-retry.repository.js';
import { TrackRetryService } from './track-retry.service.js';
import { TrackRetryLauncherService } from './track-retry-launcher.service.js';
import { TRACK_SEARCH_INDEX_QUEUE } from './track-search-index.job.js';
import { TrackSearchIndexModule } from './track-search-index.module.js';
import { TrackSearchIndexProcessor } from './track-search-index.processor.js';
import { TrackSitemapController } from './track-sitemap.controller.js';
import { TrackSitemapRepository } from './track-sitemap.repository.js';
import { TrackSitemapService } from './track-sitemap.service.js';
import { TrackStepsService } from './track-steps.service.js';
import { TrackTimedLyricsService } from './track-timed-lyrics.service.js';
import { TRACK_TRENDING_QUEUE } from './track-trending.job.js';
import { TrackTrendingProcessor } from './track-trending.processor.js';
import { TrackTrendingService } from './track-trending.service.js';
import { TrackTrendingQueueService } from './track-trending-queue.service.js';
import { TrackVideoService } from './track-video.service.js';
import { TrackVideoStepService } from './track-video-step.service.js';
import { TrackViewRepository } from './track-view.repository.js';
import { TrackViewsController } from './track-views.controller.js';
import { TrackViewsService } from './track-views.service.js';
import { TracksController } from './tracks.controller.js';
import { TracksRepository } from './tracks.repository.js';
import { TracksService } from './tracks.service.js';

/**
 * Tracks: requests, Processings and the Track pages. It queues the metadata
 * import but does not run it: that lives in the track-metadata module, which
 * imports this one, so this module never depends on Artists or Albums.
 */
@Module({
  imports: [
    AudioDownloadModule,
    BullModule.registerQueue({ name: TRACK_PROCESSING_QUEUE }),
    BullModule.registerQueue({ name: TRACK_METADATA_QUEUE }),
    BullModule.registerQueue({ name: TRACK_MP3_QUEUE }),
    BullModule.registerQueue({ name: TRACK_TRENDING_QUEUE }),
    BullModule.registerQueue({ name: TRACK_ASSOCIATION_QUEUE }),
    BullModule.registerQueue({ name: TRACK_SEARCH_INDEX_QUEUE }),
    TrackSearchIndexModule,
    CoverArtModule,
    EmailModule,
    FfmpegModule,
    MusicCatalogModule,
    NoteDetectionModule,
    ElevenLabsTranscriptionModule,
    StorageModule,
    UsersModule,
    WebRevalidationModule,
    YouTubeMusicModule,
  ],
  controllers: [
    TrackRecommendationsController,
    TracksController,
    TrackDirectAudioController,
    TrackLyricsController,
    TrackViewsController,
    TrackSitemapController,
  ],
  providers: [
    TrackRecommendationsRepository,
    TrackRecommendationsService,
    TracksService,
    TrackDirectAudioRepository,
    TrackDirectAudioService,
    TracksRepository,
    TrackProcessingRepository,
    TrackProcessingCompletionService,
    TrackContributorRepository,
    TrackContributionsService,
    TrackRequestLimitRepository,
    TrackRequestService,
    TrackAssociationEventRepository,
    TrackAssociationService,
    TrackAssociationSyncRepository,
    TrackAssociationSyncService,
    TrackAssociationProcessor,
    TrackSearchIndexProcessor,
    TrackRequestLauncherService,
    TrackRequestFlowService,
    TrackMetadataQueueService,
    TrackRetryRepository,
    TrackRetryService,
    TrackRetryLauncherService,
    TrackContributorEmailsService,
    TrackProcessingService,
    TrackPracticeRepository,
    TrackPracticeService,
    TrackRequesterService,
    TrackVideoService,
    TrackVideoStepService,
    TrackAudioService,
    TrackNoteDetectionService,
    TrackNotesRepository,
    TrackNotesService,
    TrackLyricsRepository,
    TrackLyricsService,
    TrackMp3Service,
    TrackLyricsStepService,
    TrackTimedLyricsService,
    TrackMp3Processor,
    TrackCoverService,
    TrackAlbumCoverService,
    TrackStepsService,
    TrackPipelineService,
    TrackJobRunnerService,
    TrackProcessingProcessor,
    TrackViewRepository,
    TrackViewsService,
    TrackLocaleTrendingService,
    TrackTrendingQueueService,
    TrackTrendingService,
    TrackTrendingProcessor,
    TrackSitemapRepository,
    TrackSitemapService,
  ],
  exports: [
    TracksService,
    TrackAlbumCoverService,
    TrackContributionsService,
    TrackAssociationSyncService,
    TrackLocaleTrendingService,
  ],
})
export class TracksModule {}
