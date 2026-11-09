import { useAuthSpec } from './utils/auth-spec.js';
import {
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const PINS = '/v1/admin/home-pins';

describe('Editorial Pin capacity (e2e)', () => {
  const spec = useAuthSpec();

  beforeEach(async () => {
    await signInPinsAdmin(spec.testApp.db, spec.client);
  });

  it('creates and edits an explicit editorial row with 48 ordered Tracks', async () => {
    const trackIds: string[] = [];
    for (let index = 0; index < 48; index += 1) {
      const track = await createCompletedTrack(spec.testApp.db, {
        title: `Editorial Track ${index}`,
        coverUrl: `https://cdn.example/editorial-${index}.webp`,
      });
      trackIds.push(track.id);
    }

    const created = await spec.client
      .post(PINS)
      .send(rowPinBody(trackIds, { position: 2 }))
      .expect(201);
    expect(created.body.source.trackIds).toEqual(trackIds);

    const reversedIds = [...trackIds].reverse();
    const updated = await spec.client
      .patch(`${PINS}/${created.body.id}`)
      .send({ source: { type: 'tracks', trackIds: reversedIds } })
      .expect(200);

    expect(updated.body.source.trackIds).toEqual(reversedIds);
    const history = await spec.client
      .get(`${PINS}/${created.body.id}/history`)
      .expect(200);
    expect(
      history.body.items.map((entry: { action: string }) => entry.action),
    ).toEqual(['UPDATED', 'CREATED']);
  });
});
