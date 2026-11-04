import { Test } from '@nestjs/testing';
import { type Recording, type RecordingSummary } from '@vozzify/contracts';
import { testMbid } from '../../../test/utils/factories.js';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { recordingFixture } from '../../../test/utils/recording-fixtures.js';
import { AppException } from '../../common/errors/app-exception.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import type { LegacyTrack } from './legacy-recording.js';
import { LegacyRecordingPlanRepository } from './legacy-recording-plan.repository.js';
import {
  LegacyRecordingPlanService,
  type LegacyRecordingSource,
} from './legacy-recording-plan.service.js';

const RECORDING = testMbid(301);
const TRACK: LegacyTrack = {
  id: 'legacy-1',
  ytId: null,
  title: 'Bohemian Rhapsody',
  durationSeconds: 354,
  duration: '5:54',
  albumId: null,
  albumName: null,
  albumYtId: null,
  creatorId: 'legacy-user',
  createdAt: new Date('2020-01-01T00:00:00Z'),
  dependentFavorites: 1,
  dependentViews: 2,
  artists: [{ id: 'legacy-artist', name: 'Queen', ytId: 'queen' }],
};

const recording = (mbid = RECORDING): Recording =>
  recordingFixture({
    mbid,
    artistCredit: {
      name: 'Queen',
      artists: [
        {
          mbid: testMbid(302),
          name: 'Queen',
          creditedName: 'Queen',
          joinPhrase: '',
        },
      ],
    },
  });

const summary = (mbid = RECORDING): RecordingSummary => ({
  mbid,
  title: 'Bohemian Rhapsody',
  artistCredit: 'Queen',
  coverUrl: null,
  trackId: null,
});

const source = (tracks: LegacyTrack[] = [TRACK]): LegacyRecordingSource => ({
  validateRecordingSource: vi.fn().mockResolvedValue({
    digest: 'frozen-source-digest',
    tracks: tracks.length,
  }),
  recordingPage: vi.fn().mockResolvedValueOnce(tracks).mockResolvedValue([]),
});

const buildService = async (options?: {
  runStatus?: string;
  searchResults?: RecordingSummary[];
  recordingAnswers?: Array<
    | { status: 'found'; recording: Recording }
    | { status: 'not-found' }
    | { status: 'moved'; newMbid: string }
  >;
  searchError?: Error;
  searchErrorAtCall?: number;
  skippedDependents?: { favorites: number; views: number };
}) => {
  const savedTracks = new Set<string>();
  const savedDecisions: Array<{ recordingMbid: string | null }> = [];
  const complete = vi.fn();
  const repository = {
    prepare: vi
      .fn()
      .mockResolvedValue({ status: options?.runStatus ?? 'incomplete' }),
    assertPlanSource: vi
      .fn()
      .mockImplementation(async (track: LegacyTrack) =>
        savedTracks.has(track.id),
      ),
    save: vi.fn(
      async (
        track: LegacyTrack,
        _digest: string,
        decision: { recordingMbid: string | null },
      ) => {
        savedTracks.add(track.id);
        savedDecisions.push(decision);
      },
    ),
    complete,
    counts: vi.fn().mockImplementation(async () =>
      options?.runStatus === 'complete'
        ? { planned: 1, skipped: 0 }
        : {
            planned: savedDecisions.filter(
              (decision) => decision.recordingMbid !== null,
            ).length,
            skipped: savedDecisions.filter(
              (decision) => decision.recordingMbid === null,
            ).length,
          },
    ),
    initialContributorCount: vi
      .fn()
      .mockImplementation(async () => (complete.mock.calls.length > 0 ? 1 : 0)),
    skippedDependents: vi
      .fn()
      .mockResolvedValue(
        options?.skippedDependents ?? { favorites: 0, views: 0 },
      ),
  };
  const answers = [
    ...(options?.recordingAnswers ?? [
      { status: 'found', recording: recording() },
    ]),
  ];
  let searchCalls = 0;
  const catalog = {
    search: vi.fn().mockImplementation(async () => {
      searchCalls++;
      if (
        searchCalls === (options?.searchErrorAtCall ?? 1) &&
        options?.searchError
      ) {
        throw options.searchError;
      }
      return { results: options?.searchResults ?? [summary()] };
    }),
    getRecording: vi
      .fn()
      .mockImplementation(
        async () => answers.shift() ?? { status: 'not-found' },
      ),
  };
  const { db, pool } = fakeTransactionalDatabase();
  const module = await Test.createTestingModule({
    imports: [DatabaseModule],
    providers: [
      LegacyRecordingPlanService,
      { provide: LegacyRecordingPlanRepository, useValue: repository },
      { provide: MusicCatalogClient, useValue: catalog },
    ],
  })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(DATABASE_POOL)
    .useValue(pool)
    .compile();
  return {
    service: module.get(LegacyRecordingPlanService),
    repository,
    catalog,
    close: () => module.close(),
  };
};

describe('LegacyRecordingPlanService', () => {
  it('saves acceptable Recording evidence and completes the stage', async () => {
    const built = await buildService();
    try {
      await expect(built.service.run(source())).resolves.toMatchObject({
        status: 'complete',
        sourceTracks: 1,
        plannedTracks: 1,
      });
      expect(built.repository.save).toHaveBeenCalledWith(
        TRACK,
        'frozen-source-digest',
        expect.objectContaining({ recordingMbid: RECORDING }),
      );
      expect(built.repository.complete).toHaveBeenCalledOnce();
    } finally {
      await built.close();
    }
  });

  it('follows a merged Recording before saving its current identity', async () => {
    const merged = testMbid(303);
    const built = await buildService({
      searchResults: [summary(merged)],
      recordingAnswers: [
        { status: 'moved', newMbid: RECORDING },
        { status: 'found', recording: recording() },
      ],
    });
    try {
      await built.service.run(source());
      expect(built.catalog.getRecording).toHaveBeenCalledTimes(2);
      expect(built.repository.save).toHaveBeenCalledWith(
        TRACK,
        'frozen-source-digest',
        expect.objectContaining({ recordingMbid: RECORDING }),
      );
    } finally {
      await built.close();
    }
  });

  it('persists a definitive no-match as a skip with its reason', async () => {
    const built = await buildService({
      searchResults: [],
      skippedDependents: { favorites: 2, views: 3 },
    });
    try {
      const report = await built.service.run(source());
      expect(report).toMatchObject({
        status: 'complete',
        skippedTracks: 1,
        skippedDependentFavorites: 2,
        skippedDependentViews: 3,
      });
      expect(built.repository.save).toHaveBeenCalledWith(
        TRACK,
        'frozen-source-digest',
        expect.objectContaining({
          recordingMbid: null,
          skipReason: 'NO_ACCEPTABLE_RECORDING',
        }),
      );
    } finally {
      await built.close();
    }
  });

  it('leaves transport failures incomplete and does not persist a skip', async () => {
    const built = await buildService({
      searchError: new AppException(
        'SERVICE_UNAVAILABLE',
        'temporary catalog transport failure',
      ),
    });
    try {
      await expect(built.service.run(source())).resolves.toMatchObject({
        status: 'incomplete',
        errors: ['SERVICE_UNAVAILABLE'],
      });
      expect(built.repository.save).not.toHaveBeenCalled();
      expect(built.repository.complete).not.toHaveBeenCalled();
    } finally {
      await built.close();
    }
  });

  it('reports committed decisions on a partial failure and reuses them on resume', async () => {
    const secondTrack = { ...TRACK, id: 'legacy-2' };
    const built = await buildService({
      searchError: new AppException(
        'SERVICE_UNAVAILABLE',
        'temporary catalog transport failure',
      ),
      searchErrorAtCall: 2,
      recordingAnswers: [
        { status: 'found', recording: recording() },
        { status: 'found', recording: recording() },
      ],
    });
    try {
      const partial = await built.service.run(source([TRACK, secondTrack]));
      expect(partial).toMatchObject({
        status: 'incomplete',
        sourceTracks: 2,
        plannedTracks: 1,
        skippedTracks: 0,
        errors: ['SERVICE_UNAVAILABLE'],
      });
      expect(built.repository.save).toHaveBeenCalledTimes(1);

      const resumed = await built.service.run(source([TRACK, secondTrack]));
      expect(resumed).toMatchObject({
        status: 'complete',
        plannedTracks: 2,
      });
      expect(built.repository.save).toHaveBeenCalledTimes(2);
      expect(built.catalog.search).toHaveBeenCalledTimes(3);
    } finally {
      await built.close();
    }
  });

  it('reuses a complete stage without requesting catalog matches again', async () => {
    const built = await buildService({ runStatus: 'complete' });
    try {
      await expect(built.service.run(source())).resolves.toMatchObject({
        status: 'complete',
        plannedTracks: 1,
      });
      expect(built.catalog.search).not.toHaveBeenCalled();
      expect(built.repository.save).not.toHaveBeenCalled();
    } finally {
      await built.close();
    }
  });
});
