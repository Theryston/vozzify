import { Test } from '@nestjs/testing';
import { AttemptsService } from '../attempts/attempts.service.js';
import { StreaksService } from '../streaks/streaks.service.js';
import { UsersService } from '../users/users.service.js';
import { HomeService } from './home.service.js';
import { HomeFeedService } from './home-feed.service.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';

type TestDependency = Record<string, unknown>;

export const createTasteRows = async (
  personal: TestDependency,
  repository: TestDependency,
  attempts: TestDependency,
): Promise<PersonalHomeTasteRowsService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PersonalHomeTasteRowsService,
      { provide: PersonalHomeRepository, useValue: personal },
      { provide: PersonalHomeTasteRepository, useValue: repository },
      { provide: AttemptsService, useValue: attempts },
    ],
  }).compile();
  return moduleRef.get(PersonalHomeTasteRowsService);
};

export const createPersonalHomeBuilder = async (
  feeds: TestDependency,
  personal: TestDependency,
  tasteRows: TestDependency,
): Promise<PersonalHomeBuilder> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PersonalHomeBuilder,
      { provide: HomeFeedService, useValue: feeds },
      { provide: PersonalHomeRepository, useValue: personal },
      { provide: PersonalHomeTasteRowsService, useValue: tasteRows },
      {
        provide: StreaksService,
        useValue: {
          getStatus: vi.fn().mockResolvedValue({
            day: '2026-10-20',
            listenedSeconds: 0,
            targetSeconds: 300,
            completedToday: false,
            currentStreakDays: 0,
          }),
        },
      },
      {
        provide: UsersService,
        useValue: {
          getPracticeSettings: vi.fn().mockResolvedValue({
            dailyPracticeTargetSeconds: 300,
            timeZone: 'UTC',
            lastPracticeHeartbeatAt: null,
          }),
        },
      },
    ],
  }).compile();
  return moduleRef.get(PersonalHomeBuilder);
};

export const createRetiredHomeService = async (
  feeds: TestDependency,
  snapshots: TestDependency,
): Promise<HomeService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      HomeService,
      { provide: HomeFeedService, useValue: feeds },
      { provide: PersonalHomeStore, useValue: snapshots },
    ],
  }).compile();
  return moduleRef.get(HomeService);
};
