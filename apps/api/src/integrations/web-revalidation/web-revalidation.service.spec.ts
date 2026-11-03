import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { cacheTags } from '@vozzify/contracts';
import { ZodError } from 'zod';
import {
  WEB_REVALIDATION_JOB,
  WEB_REVALIDATION_QUEUE,
} from './web-revalidation.job.js';
import { WebRevalidationService } from './web-revalidation.service.js';

describe('WebRevalidationService', () => {
  let service: WebRevalidationService;
  const queue = { add: vi.fn() };

  beforeEach(async () => {
    queue.add.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebRevalidationService,
        { provide: getQueueToken(WEB_REVALIDATION_QUEUE), useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(WebRevalidationService);
  });

  it('enqueues the tags', async () => {
    await service.revalidate([cacheTags.track('t1'), cacheTags.tracks]);
    expect(queue.add).toHaveBeenCalledWith(WEB_REVALIDATION_JOB, {
      tags: ['track:t1', 'tracks'],
    });
  });

  it('deduplicates tags', async () => {
    await service.revalidate([
      cacheTags.track('t1'),
      cacheTags.home('en'),
      cacheTags.track('t1'),
    ]);
    expect(queue.add).toHaveBeenCalledWith(WEB_REVALIDATION_JOB, {
      tags: ['track:t1', 'home:en'],
    });
  });

  it('accepts 50 unique tags after deduplication', async () => {
    const tags = Array.from({ length: 50 }, (_, i) => cacheTags.track(`${i}`));
    await service.revalidate([...tags, ...tags]);
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it('splits more than 50 tags into jobs within the endpoint limit', async () => {
    const tags = Array.from({ length: 51 }, (_, i) => `tag-${i}`);

    await service.revalidate(tags);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenNthCalledWith(1, WEB_REVALIDATION_JOB, {
      tags: tags.slice(0, 50),
    });
    expect(queue.add).toHaveBeenNthCalledWith(2, WEB_REVALIDATION_JOB, {
      tags: tags.slice(50),
    });
  });

  it.each([
    ['no tags', []],
    ['an empty tag', ['']],
    ['a tag longer than 256 characters', ['x'.repeat(257)]],
  ])('rejects %s', async (_, tags) => {
    await expect(service.revalidate(tags)).rejects.toThrow(ZodError);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
