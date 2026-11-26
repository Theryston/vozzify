import { Test } from '@nestjs/testing';
import { ElevenLabsTranscriptionClient } from '../../integrations/elevenlabs/elevenlabs-transcription.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { PrivateTrackLyricsService } from './private-track-lyrics.service.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

it('uses Scribe word timings and only drops lyrics on the last failed attempt', async () => {
  const url = 'https://storage.test/separated-vocals';
  const convert = vi
    .fn()
    .mockRejectedValueOnce(new Error('temporary'))
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({
      words: [{ text: 'Sing', start: 0, end: 1, type: 'word' }],
    });
  const completeLyrics = vi.fn();
  const module = await Test.createTestingModule({
    providers: [
      PrivateTrackLyricsService,
      {
        provide: StorageService,
        useValue: { presignPrivateGet: async () => url },
      },
      {
        provide: ElevenLabsTranscriptionClient,
        useValue: new ElevenLabsTranscriptionClient('test-key', convert),
      },
      { provide: PrivateTracksRepository, useValue: { completeLyrics } },
    ],
  }).compile();
  const service = module.get(PrivateTrackLyricsService);
  await expect(
    service.finish('track', 'attempt', 'vocals.wav', false),
  ).rejects.toThrow('temporary');
  expect(completeLyrics).not.toHaveBeenCalled();
  await service.finish('track', 'attempt', 'vocals.wav', true);
  expect(completeLyrics).toHaveBeenCalledWith('track', 'attempt', null);
  await service.finish('another', 'attempt', 'vocals.wav', false);
  expect(convert).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceUrl: url, timestampsGranularity: 'word' }),
    expect.anything(),
  );
  expect(completeLyrics).toHaveBeenLastCalledWith('another', 'attempt', {
    lines: [{ start: 0, end: 1, words: [{ text: 'Sing', start: 0, end: 1 }] }],
  });
  await module.close();
});
