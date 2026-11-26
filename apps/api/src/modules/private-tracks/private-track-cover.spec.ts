import { myPrivateTracksPageSchema } from '@vozzify/contracts';
import { toPrivateTrack } from './private-tracks.service.js';

it('includes the linked recording cover in the private library response', () => {
  const coverUrl = 'https://assets.vozzify.com/cover-art-archive/release/cover';
  const row = {
    id: 'private-track',
    title: 'Rehearsal',
    artist: '',
    createdAt: new Date(),
    durationMs: 12_000,
  };
  const linked = toPrivateTrack({
    ...row,
    recordingLink: {
      kind: 'linked',
      recording: {
        mbid: '00000000-0000-4000-8000-000000000001',
        title: 'Studio recording',
        artist: 'Singer',
        coverUrl,
      },
    },
  });
  const unlinked = toPrivateTrack({
    ...row,
    recordingLink: { kind: 'unlinked' },
  });
  const page = myPrivateTracksPageSchema.parse({
    items: [linked, unlinked],
    nextCursor: null,
    canSubmit: true,
  });
  expect(page.items[0]).toHaveProperty('coverUrl', coverUrl);
  expect(page.items[1]).not.toHaveProperty('coverUrl');
});
