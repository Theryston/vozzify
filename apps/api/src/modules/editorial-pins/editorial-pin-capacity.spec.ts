import {
  createEditorialPinBodySchema,
  EDITORIAL_PIN_MAX_TRACKS,
  pinTrackSearchQuerySchema,
} from '@vozzify/contracts';

const pinBody = (trackIds: string[]) => ({
  kind: 'row',
  layout: 'standard',
  source: { type: 'tracks', trackIds },
  position: 1,
  titles: { en: 'Editorial selection', 'pt-BR': 'Seleção editorial' },
  sponsored: false,
});

describe('editorial pin Track capacity', () => {
  it('accepts 48 explicit Tracks and rejects a 49th', () => {
    const trackIds = Array.from(
      { length: EDITORIAL_PIN_MAX_TRACKS },
      (_, i) => `track-${i}`,
    );

    expect(
      createEditorialPinBodySchema.safeParse(pinBody(trackIds)).success,
    ).toBe(true);
    expect(
      createEditorialPinBodySchema.safeParse(pinBody([...trackIds, 'track-49']))
        .success,
    ).toBe(false);
  });

  it('accepts selected Track IDs for all 48 picker entries', () => {
    const ids = Array.from({ length: 48 }, () => 'x'.repeat(128));

    expect(
      pinTrackSearchQuerySchema.safeParse({ ids: ids.join(',') }).success,
    ).toBe(true);
  });
});
