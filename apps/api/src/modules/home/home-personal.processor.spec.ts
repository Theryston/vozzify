import { Test } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import {
  REFRESH_PERSONAL_HOME_FEED_JOB,
  REFRESH_PERSONAL_NIGHTLY_JOB,
} from './home-personal.job.js';
import { PersonalHomeProcessor } from './home-personal.processor.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import { HomeSocialService } from './home-social.service.js';

const built = (version: string) => ({
  audience: 'personal' as const,
  locale: 'en' as const,
  version,
  algorithmVersion: 1,
  rows: [],
  generatedAt: '2026-10-20T10:00:00.000Z',
});

const builder = {
  build: vi.fn(),
  refreshCommunityCooccurrence: vi.fn(),
};
const store = {
  readCurrent: vi.fn(),
  writeCurrent: vi.fn(),
  retire: vi.fn(),
  readRetired: vi.fn(),
};
const personal = {
  findActiveUserIds: vi.fn(),
};
const queue = {
  scheduleRefresh: vi.fn().mockResolvedValue(undefined),
  scheduleNightlyRefresh: vi.fn().mockResolvedValue(undefined),
};
const social = { refreshFor: vi.fn().mockResolvedValue(undefined) };

const job = (name: string, data: unknown) =>
  ({ name, data }) as Parameters<PersonalHomeProcessor['process']>[0];

const moduleOf = () =>
  Test.createTestingModule({
    providers: [
      PersonalHomeProcessor,
      { provide: PersonalHomeBuilder, useValue: builder },
      { provide: PersonalHomeStore, useValue: store },
      { provide: PersonalHomeRepository, useValue: personal },
      { provide: PersonalHomeQueueService, useValue: queue },
      { provide: HomeSocialService, useValue: social },
    ],
  }).compile();

describe('PersonalHomeProcessor', () => {
  let processor: PersonalHomeProcessor;

  beforeEach(async () => {
    vi.clearAllMocks();
    processor = (await moduleOf()).get(PersonalHomeProcessor);
  });

  it('commits the rebuilt snapshot, retiring the replaced one', async () => {
    builder.build.mockResolvedValue(built('new-version-123456'));
    store.readCurrent.mockResolvedValue(built('old-version-123456'));

    await processor.process(
      job(REFRESH_PERSONAL_HOME_FEED_JOB, { userId: 'user-1', locale: 'en' }),
    );

    expect(builder.build).toHaveBeenCalledWith('user-1', 'en');
    expect(store.retire).toHaveBeenCalledWith(built('old-version-123456'));
    expect(store.writeCurrent).toHaveBeenCalledWith(
      'user-1',
      'en',
      built('new-version-123456'),
    );
  });

  it('keeps an unchanged snapshot without retiring anything', async () => {
    builder.build.mockResolvedValue(built('same-version-1234'));
    store.readCurrent.mockResolvedValue(built('same-version-1234'));

    await processor.process(
      job(REFRESH_PERSONAL_HOME_FEED_JOB, { userId: 'user-1' }),
    );

    expect(store.retire).not.toHaveBeenCalled();
    expect(store.writeCurrent).toHaveBeenCalled();
  });

  it('refuses an invalid refresh payload without retrying it', async () => {
    const error = await processor
      .process(job(REFRESH_PERSONAL_HOME_FEED_JOB, {}))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('refuses an unknown job without retrying it', async () => {
    const error = await processor
      .process(job('something-else', {}))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnrecoverableError);
  });

  it('queues one nightly batch per recently active User', async () => {
    personal.findActiveUserIds.mockResolvedValue(['user-1', 'user-2']);

    await processor.process(job(REFRESH_PERSONAL_NIGHTLY_JOB, {}));

    expect(personal.findActiveUserIds).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Number),
    );
    expect(queue.scheduleNightlyRefresh).toHaveBeenCalledTimes(2);
    expect(queue.scheduleNightlyRefresh).toHaveBeenCalledWith('user-1');
    expect(queue.scheduleNightlyRefresh).toHaveBeenCalledWith('user-2');
    expect(queue.scheduleRefresh).not.toHaveBeenCalled();
  });

  it('looks the nightly batch back a fortnight', async () => {
    personal.findActiveUserIds.mockResolvedValue([]);

    await processor.process(job(REFRESH_PERSONAL_NIGHTLY_JOB, {}));

    const [since] = personal.findActiveUserIds.mock.calls[0] as [Date];
    const days = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });
});
