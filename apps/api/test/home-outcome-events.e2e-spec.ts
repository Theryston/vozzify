import { readFile } from 'node:fs/promises';
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { events } from '../src/database/schema/events.js';
import { practiceHeartbeats } from '../src/database/schema/practice-heartbeats.js';
import { EVENTS_QUEUE } from '../src/modules/events/events.job.js';
import { EventsProcessor } from '../src/modules/events/events.processor.js';
import { EventsRepository } from '../src/modules/events/events.repository.js';
import { signInWithUsername } from './utils/auth.js';
import { useAuthSpec } from './utils/auth-spec.js';
import {
  createPasswordUser,
  createTrack,
  DEFAULT_PASSWORD,
} from './utils/factories.js';

const OUTCOME_REPORT_PATH = new URL(
  '../../../docs/home-practice-outcomes.sql',
  import.meta.url,
);

const reportQuery = async (startAt: Date, endAt: Date): Promise<string> =>
  (await readFile(OUTCOME_REPORT_PATH, 'utf8'))
    .split('\n')
    .filter((line) => !line.startsWith('\\set '))
    .join('\n')
    .replaceAll(":'start_at'", `'${startAt.toISOString()}'`)
    .replaceAll(":'end_at'", `'${endAt.toISOString()}'`);

describe('Home outcome measurement report (e2e)', () => {
  const spec = useAuthSpec();

  it('deduplicates event retries and counts credited, later practice once', async () => {
    const user = await createPasswordUser(spec.testApp.db, {
      username: 'outcomes',
    });
    const track = await createTrack(spec.testApp.db);
    await signInWithUsername(spec.client, {
      username: user.username,
      password: DEFAULT_PASSWORD,
    }).expect(200);

    const now = new Date();
    const startAt = new Date(now.getTime() - 60_000);
    const endAt = new Date(now.getTime() + 60 * 60_000);
    const visitorId = 'visitor-outcome-1';
    const impression = (eventId: string, visitId: string) => ({
      type: 'home.row_impression',
      eventId,
      visitId,
      locale: 'pt-BR',
      audience: 'personal',
      rowId: 'resume',
      feedVersion: 'a1b2c3d4e5f60718',
      algorithmVersion: 2,
      items: [{ id: track.id, position: 0 }],
    });
    const click = {
      type: 'home.item_click',
      eventId: 'click-1',
      clickId: 'click-1',
      visitId: 'visit-1',
      locale: 'pt-BR',
      audience: 'personal',
      rowId: 'resume',
      feedVersion: 'a1b2c3d4e5f60718',
      algorithmVersion: 2,
      itemId: track.id,
      position: 0,
    };
    const response = await spec.client
      .post('/v1/events')
      .send({
        visitorId,
        events: [
          impression('impression-1', 'visit-1'),
          impression('impression-1', 'visit-1'),
          click,
          click,
          impression('impression-2', 'visit-2'),
          impression('impression-3', 'visit-3'),
          {
            ...click,
            eventId: 'click-3',
            clickId: 'click-3',
            visitId: 'visit-3',
          },
        ],
      })
      .expect(202);

    expect(response.body).toMatchObject({ accepted: 7 });
    expect(await spec.testApp.db.select().from(events)).toHaveLength(0);
    await runEventsJob();
    const storedEvents = await spec.testApp.db.select().from(events);
    expect(storedEvents).toHaveLength(7);
    expect(storedEvents[0]?.payload).toMatchObject({
      eventId: 'impression-1',
      visitId: 'visit-1',
      locale: 'pt-BR',
      audience: 'personal',
    });

    const viewResponse = await spec.client
      .post(`/v1/tracks/${track.id}/views`)
      .send({ clickId: 'click-1', visitorId, locale: 'pt-BR' })
      .expect(201);
    const viewId = viewResponse.body.viewId as string;
    const heartbeat = await spec.client
      .post('/v1/me/streak/heartbeat')
      .send({ elapsedSeconds: 60, timeZone: 'UTC', viewId })
      .expect(200);
    expect(heartbeat.body.creditedSeconds).toBeGreaterThan(0);
    await spec.testApp.db.insert(practiceHeartbeats).values({
      userId: user.id,
      viewId,
      elapsedSeconds: 40,
      creditedSeconds: 40,
      createdAt: new Date(now.getTime() + 1_000),
      updatedAt: new Date(now.getTime() + 1_000),
    });

    await spec.client
      .post(`/v1/tracks/${track.id}/attempts`)
      .send({
        difficulty: 'NORMAL',
        octaveMode: 'ANY',
        transposeSemitones: 0,
        speed: 1,
        accuracy: 0.8,
        coverage: 0.95,
        forwardSkip: false,
        bleedSuspected: false,
        startedAt: now.toISOString(),
        endedAt: new Date(now.getTime() + 60_000).toISOString(),
        viewId,
      })
      .expect(201);

    const thirdVisitClick = await spec.client
      .post(`/v1/tracks/${track.id}/views`)
      .send({ clickId: 'click-3', visitorId, locale: 'pt-BR' })
      .expect(201);
    await spec.testApp.db.insert(practiceHeartbeats).values({
      userId: user.id,
      viewId: thirdVisitClick.body.viewId as string,
      elapsedSeconds: 5,
      creditedSeconds: 0,
    });
    await spec.testApp.db.insert(practiceHeartbeats).values({
      userId: user.id,
      viewId,
      elapsedSeconds: 5,
      creditedSeconds: 5,
      createdAt: new Date(now.getTime() + 2 * 24 * 60 * 60_000),
      updatedAt: new Date(now.getTime() + 2 * 24 * 60 * 60_000),
    });

    const rows = await spec.testApp.db.execute(
      sql.raw(await reportQuery(startAt, endAt)),
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        algorithm_version: 2,
        audience: 'personal',
        locale: 'pt-BR',
        visits: 3,
        clicked_visits: 2,
        sustained_visits: 1,
        returned_within_7d: 1,
        visit_to_sustained_rate: '0.3333',
        sustained_to_return_rate: '1.0000',
      }),
    ]);
  });

  const runEventsJob = async () => {
    const job = spec.testApp.queues[EVENTS_QUEUE]?.added.shift();
    if (job === undefined) throw new Error('No events job was queued');
    await new EventsProcessor(spec.testApp.app.get(EventsRepository)).process(
      job as Job<unknown>,
    );
  };
});
