import { Test } from '@nestjs/testing';
import { privateTrackDetailSchema } from '@vozzify/contracts';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PrivateTrackSourceStorage } from './private-track-source-storage.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { PrivateTracksService } from './private-tracks.service.js';

const notes = [67, 69, 71, 72, 74, 76, 78, 67, 67, 74].map((pitch, start) => ({
  pitch,
  start,
  end: start + 1,
}));

it.each([
  { source: 'upload', youtubeVideoId: null },
  { source: 'YouTube', youtubeVideoId: 'aBcd1Efgh_2' },
])(
  'returns the key of the detected notes for a $source track',
  async ({ youtubeVideoId }) => {
    const listNotes = vi.fn().mockResolvedValue(notes);
    const hasPaidMembership = vi.fn().mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        PrivateTracksService,
        {
          provide: PrivateTracksRepository,
          useValue: {
            listNotes,
            findOwned: async () => ({
              id: 'track',
              userId: 'owner',
              youtubeVideoId,
              title: 'Practice',
              artist: '',
              durationMs: 10000,
              createdAt: new Date(),
              processingStatus: 'COMPLETED',
              processingProgress: 100,
            }),
          },
        },
        {
          provide: SubscriptionMembershipService,
          useValue: { hasPaidMembership },
        },
        { provide: PrivateTrackSourceStorage, useValue: {} },
        { provide: PrivateAudioInspector, useValue: {} },
      ],
    }).compile();
    try {
      const detail = async () =>
        privateTrackDetailSchema.parse(
          await module.get(PrivateTracksService).getDetail('owner', 'track'),
        );
      expect(await detail()).toMatchObject({
        key: { tonic: 7, mode: 'MAJOR' },
      });
      listNotes.mockResolvedValueOnce([]);
      expect(await detail()).not.toHaveProperty('key');
      hasPaidMembership.mockResolvedValueOnce(false);
      expect(await detail()).not.toHaveProperty('key');
      expect(listNotes).toHaveBeenCalledTimes(2);
    } finally {
      await module.close();
    }
  },
);
