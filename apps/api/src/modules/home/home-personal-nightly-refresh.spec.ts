import { Test } from '@nestjs/testing';
import {
  REFRESH_PERSONAL_NIGHTLY_JOB,
  REFRESH_PERSONAL_NIGHTLY_USER_JOB,
} from './home-personal.job.js';
import { PersonalHomeProcessor } from './home-personal.processor.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import { HomeSocialService } from './home-social.service.js';

describe('PersonalHomeProcessor nightly refreshes', () => {
  it('refreshes both community cooccurrence and social pairs', async () => {
    const builder = {
      build: vi.fn(async (userId: string, locale: string) => ({
        audience: 'personal' as const,
        userId,
        locale,
        version: `${locale}-version-123456`,
        algorithmVersion: 1,
        rows: [],
        generatedAt: '2026-10-20T10:00:00.000Z',
      })),
      refreshCommunityCooccurrence: vi.fn().mockResolvedValue(undefined),
    };
    const store = {
      readCurrent: vi.fn().mockResolvedValue(null),
      writeCurrent: vi.fn(),
      retire: vi.fn(),
    };
    const personal = {
      findActiveUserIds: vi.fn().mockResolvedValue(['user-1', 'user-2']),
    };
    const queue = {
      scheduleNightlyRefresh: vi.fn().mockResolvedValue(undefined),
    };
    const social = { refreshFor: vi.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PersonalHomeProcessor,
        { provide: PersonalHomeBuilder, useValue: builder },
        { provide: PersonalHomeStore, useValue: store },
        { provide: PersonalHomeRepository, useValue: personal },
        { provide: PersonalHomeQueueService, useValue: queue },
        { provide: HomeSocialService, useValue: social },
      ],
    }).compile();

    const processor = moduleRef.get(PersonalHomeProcessor);
    await processor.process({
      name: REFRESH_PERSONAL_NIGHTLY_JOB,
      data: {},
    } as Parameters<PersonalHomeProcessor['process']>[0]);
    await processor.process({
      name: REFRESH_PERSONAL_NIGHTLY_USER_JOB,
      data: { userId: 'user-1' },
    } as Parameters<PersonalHomeProcessor['process']>[0]);

    expect(builder.refreshCommunityCooccurrence).toHaveBeenCalledOnce();
    expect(social.refreshFor).toHaveBeenCalledOnce();
    expect(social.refreshFor).toHaveBeenCalledWith('user-1');
    expect(queue.scheduleNightlyRefresh).toHaveBeenCalledTimes(2);
    expect(queue.scheduleNightlyRefresh).toHaveBeenCalledWith('user-1');
    expect(queue.scheduleNightlyRefresh).toHaveBeenCalledWith('user-2');
    expect(builder.build).toHaveBeenNthCalledWith(1, 'user-1', 'en');
    expect(builder.build).toHaveBeenNthCalledWith(2, 'user-1', 'pt-BR');
    expect(store.writeCurrent).toHaveBeenCalledTimes(2);
  });
});
