import type { Job } from 'bullmq';
import { events } from '../src/database/schema/events.js';
import { EVENTS_QUEUE } from '../src/modules/events/events.job.js';
import { EventsProcessor } from '../src/modules/events/events.processor.js';
import { EventsRepository } from '../src/modules/events/events.repository.js';
import { useAuthSpec } from './utils/auth-spec.js';

describe('Home outcome event metadata (e2e)', () => {
  const spec = useAuthSpec();

  it('queues attribution metadata without waiting for persistence', async () => {
    const response = await spec.client
      .post('/v1/events')
      .send({
        visitorId: 'visitor-outcome-1',
        events: [
          {
            type: 'home.row_impression',
            eventId: 'impression-1',
            visitId: 'visit-1',
            locale: 'pt-BR',
            audience: 'personal',
            rowId: 'resume',
            feedVersion: 'a1b2c3d4e5f60718',
            algorithmVersion: 2,
            items: [{ id: 'track-1', position: 0 }],
          },
        ],
      })
      .expect(202);

    expect(response.body).toMatchObject({ accepted: 1 });
    expect(await spec.testApp.db.select().from(events)).toHaveLength(0);

    const job = spec.testApp.queues[EVENTS_QUEUE]?.added.shift();
    if (job === undefined) throw new Error('No events job was queued');
    await new EventsProcessor(spec.testApp.app.get(EventsRepository)).process(
      job as Job<unknown>,
    );

    const [stored] = await spec.testApp.db.select().from(events);
    expect(stored?.payload).toMatchObject({
      eventId: 'impression-1',
      visitId: 'visit-1',
      locale: 'pt-BR',
      audience: 'personal',
    });
  });
});
