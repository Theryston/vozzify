import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { cacheTags, type Recording } from '@vozzify/contracts';
import { testMbid } from '../../../test/utils/factories.js';
import { recordingFixture } from '../../../test/utils/recording-fixtures.js';
import { ENV } from '../../config/env.js';
import {
  type CatalogRecordingLookup,
  MusicCatalogClient,
} from '../../integrations/music-catalog/music-catalog.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { WEB_REVALIDATION_QUEUE } from '../../integrations/web-revalidation/web-revalidation.job.js';
import { WebRevalidationProcessor } from '../../integrations/web-revalidation/web-revalidation.processor.js';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackCoverService } from './track-cover.service.js';
import { TrackCoverRepairModule } from './track-cover-repair.module.js';
import {
  TrackCoverRepairRepository,
  type TrackCoverRepairRow,
} from './track-cover-repair.repository.js';
import { TrackCoverRepairService } from './track-cover-repair.service.js';

const row = (id: string, number = 1): TrackCoverRepairRow => ({
  id,
  recordingMbid: testMbid(number),
});

const recording = (): Recording =>
  recordingFixture({
    releases: [
      {
        mbid: testMbid(100),
        title: 'Shape of You',
        releaseGroup: { mbid: testMbid(101), primaryType: 'Single' },
        status: 'Official',
        date: '2017-01-06',
        country: 'GB',
        mediumPosition: 1,
        trackPosition: 1,
        coverArtUrl: 'https://cover.test/front-500',
      },
    ],
  });

describe('TrackCoverRepairService', () => {
  const tracks = {
    page: vi.fn<
      (
        afterId: string | undefined,
        limit: number,
      ) => Promise<TrackCoverRepairRow[]>
    >(),
  };
  const catalog = {
    getRecording: vi.fn<(mbid: string) => Promise<CatalogRecordingLookup>>(),
  };
  const covers = {
    repairCover:
      vi.fn<
        (id: string, primaryReleaseMbid: string | null) => Promise<boolean>
      >(),
  };
  const revalidation = { revalidate: vi.fn() };
  let service: TrackCoverRepairService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    tracks.page.mockResolvedValue([]);
    catalog.getRecording.mockResolvedValue({
      status: 'found',
      recording: recording(),
    });
    covers.repairCover.mockResolvedValue(true);
    revalidation.revalidate.mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackCoverRepairService,
        { provide: TrackCoverRepairRepository, useValue: tracks },
        { provide: MusicCatalogClient, useValue: catalog },
        { provide: TrackCoverService, useValue: covers },
        { provide: WebRevalidationService, useValue: revalidation },
      ],
    }).compile();
    service = moduleRef.get(TrackCoverRepairService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await moduleRef.close();
  });

  it('does nothing when no Tracks exist', async () => {
    await service.repair();

    expect(tracks.page).toHaveBeenCalledExactlyOnceWith(undefined, 100);
    expect(catalog.getRecording).not.toHaveBeenCalled();
    expect(covers.repairCover).not.toHaveBeenCalled();
  });

  it('starts the dedicated operator context with its own dependencies', async () => {
    const context = await Test.createTestingModule({
      imports: [TrackCoverRepairModule],
    })
      .overrideProvider(ENV)
      .useValue({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
        REDIS_URL: 'redis://127.0.0.1:6379',
      })
      .overrideProvider(MusicCatalogClient)
      .useValue(catalog)
      .overrideProvider(StorageService)
      .useValue({})
      .overrideProvider(TrackCoverRepairRepository)
      .useValue(tracks)
      .overrideProvider(getQueueToken(WEB_REVALIDATION_QUEUE))
      .useValue({ add: vi.fn() })
      .overrideProvider(WebRevalidationProcessor)
      .useValue({})
      .compile();
    try {
      await context.init();
      await context.get(TrackCoverRepairService).repair();
      expect(context.get(TrackCoverService)).toBeInstanceOf(TrackCoverService);
    } finally {
      await context.close();
    }
  });

  it('walks every page and saves the catalog choice before revalidating', async () => {
    tracks.page
      .mockResolvedValueOnce([row('a'), row('b', 2)])
      .mockResolvedValueOnce([row('c', 3)]);

    await service.repair();

    expect(tracks.page.mock.calls).toEqual([
      [undefined, 100],
      ['b', 100],
      ['c', 100],
    ]);
    expect(covers.repairCover.mock.calls).toEqual([
      ['a', testMbid(100)],
      ['b', testMbid(100)],
      ['c', testMbid(100)],
    ]);
    expect(revalidation.revalidate.mock.calls).toEqual(
      ['a', 'b', 'c'].map((id) => [[cacheTags.track(id), cacheTags.tracks]]),
    );
    expect(covers.repairCover.mock.invocationCallOrder[0]).toBeLessThan(
      revalidation.revalidate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('follows merged Recordings and supports one with no releases', async () => {
    tracks.page.mockResolvedValueOnce([row('a')]);
    catalog.getRecording
      .mockResolvedValueOnce({ status: 'moved', newMbid: testMbid(2) })
      .mockResolvedValueOnce({ status: 'moved', newMbid: testMbid(3) })
      .mockResolvedValueOnce({
        status: 'found',
        recording: recordingFixture(),
      });

    await service.repair();

    expect(catalog.getRecording.mock.calls).toEqual([
      [testMbid(1)],
      [testMbid(2)],
      [testMbid(3)],
    ]);
    expect(covers.repairCover).toHaveBeenCalledExactlyOnceWith('a', null);
  });

  it('logs a missing Recording and continues through later pages', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    tracks.page
      .mockResolvedValueOnce([row('missing')])
      .mockResolvedValueOnce([row('present', 2)]);
    catalog.getRecording.mockResolvedValueOnce({ status: 'not-found' });

    await expect(service.repair()).rejects.toThrow(
      'Cover repair failed for 1 of 2 Tracks',
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Cover repair failed for Track missing'),
    );
    expect(covers.repairCover).toHaveBeenCalledExactlyOnceWith(
      'present',
      testMbid(100),
    );
  });

  it('stops a merge cycle without replacing the existing cover', async () => {
    tracks.page.mockResolvedValueOnce([row('a')]);
    catalog.getRecording
      .mockResolvedValueOnce({ status: 'moved', newMbid: testMbid(2) })
      .mockResolvedValueOnce({ status: 'moved', newMbid: testMbid(1) });

    await expect(service.repair()).rejects.toBeInstanceOf(AggregateError);

    expect(catalog.getRecording).toHaveBeenCalledTimes(2);
    expect(covers.repairCover).not.toHaveBeenCalled();
    expect(revalidation.revalidate).not.toHaveBeenCalled();
  });

  it('bounds a noncyclic merge chain', async () => {
    tracks.page.mockResolvedValueOnce([row('a')]);
    catalog.getRecording.mockImplementation(async (mbid) => ({
      status: 'moved',
      newMbid: `${mbid}-next`,
    }));

    await expect(service.repair()).rejects.toThrow(
      'Cover repair failed for 1 of 1 Tracks',
    );

    expect(catalog.getRecording).toHaveBeenCalledTimes(4);
    expect(covers.repairCover).not.toHaveBeenCalled();
  });

  it.each(['lookup', 'cover'])(
    'continues after a %s failure',
    async (stage) => {
      tracks.page.mockResolvedValueOnce([row('a'), row('b', 2)]);
      if (stage === 'lookup') {
        catalog.getRecording.mockRejectedValueOnce(
          new Error('Catalog unavailable'),
        );
      } else {
        covers.repairCover.mockRejectedValueOnce(new Error('Upload failed'));
      }

      await expect(service.repair()).rejects.toThrow(
        'Cover repair failed for 1 of 2 Tracks',
      );

      expect(covers.repairCover).toHaveBeenCalledWith('b', testMbid(100));
      expect(revalidation.revalidate).toHaveBeenCalledExactlyOnceWith([
        cacheTags.track('b'),
        cacheTags.tracks,
      ]);
    },
  );

  it('retries invalidation when a rerun finds the cover already correct', async () => {
    tracks.page.mockResolvedValueOnce([row('a')]);
    revalidation.revalidate.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );

    await expect(service.repair()).rejects.toThrow(
      'Cover repair failed for 1 of 1 Tracks',
    );

    tracks.page.mockResolvedValueOnce([row('a')]);
    covers.repairCover.mockResolvedValue(false);
    await service.repair();

    expect(
      tracks.page.mock.calls.filter(([after]) => after === undefined),
    ).toHaveLength(2);
    expect(revalidation.revalidate).toHaveBeenCalledTimes(2);
  });
});
