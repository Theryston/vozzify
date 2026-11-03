import { Test, type TestingModule } from '@nestjs/testing';
import { TrackAudioService } from './track-audio.service.js';
import { TrackLyricsStepService } from './track-lyrics-step.service.js';
import { TrackNoteDetectionService } from './track-note-detection.service.js';
import type { ProcessingForStep } from './track-processing.repository.js';
import { TrackStepsService } from './track-steps.service.js';
import { TrackVideoStepService } from './track-video-step.service.js';

// The dispatcher hands each step to its own service, unchanged.

const video = { run: vi.fn() };
const audio = { run: vi.fn() };
const noteDetection = { extractVocals: vi.fn(), detectNotes: vi.fn() };
const lyrics = { run: vi.fn() };

const processing: ProcessingForStep = {
  id: 'processing-1',
  trackId: 'track-1',
  status: 'DOWNLOADING_AUDIO',
  videoId: 'aaaaaaaaaaa',
  videoSource: 'musicbrainz',
};

describe('TrackStepsService', () => {
  let steps: TrackStepsService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackStepsService,
        { provide: TrackVideoStepService, useValue: video },
        { provide: TrackAudioService, useValue: audio },
        { provide: TrackNoteDetectionService, useValue: noteDetection },
        { provide: TrackLyricsStepService, useValue: lyrics },
      ],
    }).compile();
    steps = moduleRef.get(TrackStepsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('runs the find-video step to persist the chosen video', async () => {
    video.run.mockResolvedValue(undefined);

    await expect(steps.findVideo(processing)).resolves.toBeUndefined();
    expect(video.run).toHaveBeenCalledWith(processing);
  });

  it('runs the download step with the re-check it was given', async () => {
    const wait = {
      round: 3,
      state: { progressUrl: 'https://rapidapi.test/p' },
    };
    audio.run.mockResolvedValue({ kind: 'done' });

    await expect(steps.downloadAudio(processing, wait)).resolves.toEqual({
      kind: 'done',
    });
    expect(audio.run).toHaveBeenCalledWith(processing, wait);
  });

  it('runs the vocals stage with the re-check it was given', async () => {
    const wait = { round: 2, state: null };
    noteDetection.extractVocals.mockResolvedValue({ kind: 'done' });

    await expect(steps.extractVocals(processing, wait)).resolves.toEqual({
      kind: 'done',
    });
    expect(noteDetection.extractVocals).toHaveBeenCalledWith(processing, wait);
  });

  it('runs the notes stage, which has no re-check on its first run', async () => {
    noteDetection.detectNotes.mockResolvedValue({ kind: 'done' });

    await expect(steps.detectNotes(processing, undefined)).resolves.toEqual({
      kind: 'done',
    });
    expect(noteDetection.detectNotes).toHaveBeenCalledWith(
      processing,
      undefined,
    );
  });
});
