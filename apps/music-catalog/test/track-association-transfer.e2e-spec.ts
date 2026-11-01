import { sql } from 'drizzle-orm';
import { trackAssociation } from '../src/database/schema/track-association.js';
import { ReimportStateRepository } from '../src/modules/reimport/reimport-state.repository.js';
import { TrackAssociationRepository } from '../src/modules/track-association/track-association.repository.js';
import { useTestServer } from './utils/create-test-server.js';
import { mbid } from './utils/musicbrainz.js';
import {
  useCleanParallelCopy,
  useParallelDatabase,
} from './utils/reimport-harness.js';

describe('Track association transfer (e2e)', () => {
  const parallel = useParallelDatabase();
  const server = useTestServer();
  useCleanParallelCopy(parallel);

  it('keeps a newer mirrored revision when transfer replays an older source row', async () => {
    const source = server();
    const target = parallel();
    const reimport = new ReimportStateRepository(source.db);
    await reimport.start();
    await reimport.advance({ from: 'restoring', to: 'indexing' });
    const repository = new TrackAssociationRepository(
      source.db,
      source.url,
      target,
    );
    const recordingMbid = mbid(702);
    const first = {
      mbid: recordingMbid,
      trackId: '00000000-0000-4000-8000-000000000702',
      businessScore: 2,
      revision: 1,
    };
    await repository.put(first);
    await source.db.execute(sql`
      alter table music_catalog.track_association
      add constraint reject_score_nine check (business_score <> 9)
    `);

    await expect(
      repository.put({ ...first, businessScore: 9, revision: 2 }),
    ).rejects.toThrow();

    const [sourceRow] = await source.db
      .select()
      .from(trackAssociation)
      .where(sql`${trackAssociation.recordingMbid} = ${recordingMbid}`);
    const [targetRow] = await target.db
      .select()
      .from(trackAssociation)
      .where(sql`${trackAssociation.recordingMbid} = ${recordingMbid}`);
    expect(sourceRow).toMatchObject({ revision: 1, businessScore: 2 });
    expect(targetRow).toMatchObject({ revision: 2, businessScore: 9 });

    await repository.transferTo(target.db, 1);
    const [afterTransfer] = await target.db
      .select()
      .from(trackAssociation)
      .where(sql`${trackAssociation.recordingMbid} = ${recordingMbid}`);
    expect(afterTransfer).toMatchObject({ revision: 2, businessScore: 9 });
    await source.db.execute(sql`
      alter table music_catalog.track_association
      drop constraint reject_score_nine
    `);
  });
});
