import { Test, type TestingModule } from '@nestjs/testing';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingFailure } from './track-processing-failure.js';
import { TrackVideoService } from './track-video.service.js';
import { TrackVideoStepService } from './track-video-step.service.js';
import { TracksRepository } from './tracks.repository.js';

// `save` is `@Transactional()`: the database module runs it on a stand-in
// transaction client, so the write path is exercised without a database.
const tx = { name: 'tx' };
const db = {
  name: 'db',
  transaction: vi.fn(async (callback: (client: unknown) => unknown) =>
    callback(tx),
  ),
};
const pool = { end: vi.fn(async () => {}) };

const tracks = {
  findPipelineTrack: vi.fn(),
  setYoutubeVideoId: vi.fn(),
};
const processings = { saveVideo: vi.fn() };
const videos = { findVideo: vi.fn() };

const TRACK = {
  id: 'track-1',
  title: 'Bohemian Rhapsody',
  lengthMs: 354_000,
  coverUrl: null,
  artistNames: ['Queen'],
  externalUrls: [],
  releases: [],
};
const queued = {
  id: 'processing-1',
  trackId: 'track-1',
  status: 'FINDING_VIDEO' as const,
  videoId: null,
  videoSource: null,
};
const finding = {
  video: { videoId: 'aaaaaaaaaaa', source: 'musicbrainz' as const },
};

describe('TrackVideoStepService', () => {
  let step: TrackVideoStepService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        TrackVideoStepService,
        { provide: TracksRepository, useValue: tracks },
        { provide: TrackProcessingRepository, useValue: processings },
        { provide: TrackVideoService, useValue: videos },
      ],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .overrideProvider(DATABASE)
      .useValue(db)
      .compile();
    step = moduleRef.get(TrackVideoStepService);
    tracks.findPipelineTrack.mockResolvedValue(TRACK);
    processings.saveVideo.mockResolvedValue(true);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('saves the chosen video on the Processing and on its Track', async () => {
    videos.findVideo.mockResolvedValue(finding);

    await expect(step.run(queued)).resolves.toBeUndefined();

    expect(videos.findVideo).toHaveBeenCalledWith(TRACK);
    expect(processings.saveVideo).toHaveBeenCalledWith(
      'processing-1',
      'FINDING_VIDEO',
      { videoId: 'aaaaaaaaaaa', source: 'musicbrainz' },
    );
    expect(tracks.setYoutubeVideoId).toHaveBeenCalledWith(
      'track-1',
      'aaaaaaaaaaa',
    );
  });

  it('leaves the Track alone when the Processing moved on before the save', async () => {
    videos.findVideo.mockResolvedValue(finding);
    processings.saveVideo.mockResolvedValue(false);

    await step.run(queued);

    expect(tracks.setYoutubeVideoId).not.toHaveBeenCalled();
  });

  it('keeps a video an earlier run already chose, without searching again', async () => {
    await expect(
      step.run({
        ...queued,
        videoId: 'aaaaaaaaaaa',
        videoSource: 'youtube_music',
      }),
    ).resolves.toBeUndefined();

    expect(tracks.findPipelineTrack).not.toHaveBeenCalled();
    expect(videos.findVideo).not.toHaveBeenCalled();
    expect(processings.saveVideo).not.toHaveBeenCalled();
  });

  it('saves nothing when no video can be chosen', async () => {
    videos.findVideo.mockRejectedValue(
      new TrackProcessingFailure('VIDEO_NOT_FOUND'),
    );

    await expect(step.run(queued)).rejects.toMatchObject({
      code: 'VIDEO_NOT_FOUND',
    });
    expect(processings.saveVideo).not.toHaveBeenCalled();
    expect(tracks.setYoutubeVideoId).not.toHaveBeenCalled();
  });

  it('refuses a Track that is gone', async () => {
    tracks.findPipelineTrack.mockResolvedValue(undefined);

    await expect(step.run(queued)).rejects.toThrow('disappeared');
    expect(videos.findVideo).not.toHaveBeenCalled();
  });
});
