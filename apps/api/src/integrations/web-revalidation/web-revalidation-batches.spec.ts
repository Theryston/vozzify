import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { cacheTags, revalidateBodySchema } from '@vozzify/contracts';
import { catalogPageTags } from './catalog-page-tags.js';
import {
  WEB_REVALIDATION_JOB,
  WEB_REVALIDATION_QUEUE,
} from './web-revalidation.job.js';
import { WebRevalidationService } from './web-revalidation.service.js';

describe('WebRevalidationService batching', () => {
  const queue = { add: vi.fn() };
  let service: WebRevalidationService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    queue.add.mockReset().mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      providers: [
        WebRevalidationService,
        { provide: getQueueToken(WEB_REVALIDATION_QUEUE), useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(WebRevalidationService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('queues every completion tag for a Track appearing on many Albums', async () => {
    const tags = [
      cacheTags.track('track-1'),
      cacheTags.trackNotes('track-1'),
      cacheTags.trackLyrics('track-1'),
      cacheTags.tracks,
      ...catalogPageTags({
        artistIds: ['artist-1'],
        albumIds: Array.from({ length: 24 }, (_, i) => `album-${i}`),
      }),
    ];

    await service.revalidate(tags);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenNthCalledWith(1, WEB_REVALIDATION_JOB, {
      tags: tags.slice(0, 50),
    });
    expect(queue.add).toHaveBeenNthCalledWith(2, WEB_REVALIDATION_JOB, {
      tags: tags.slice(50),
    });
    for (const [, payload] of queue.add.mock.calls) {
      expect(revalidateBodySchema.safeParse(payload).success).toBe(true);
    }
  });

  it.each([51, 100, 101])(
    'deduplicates %i unique tags before splitting them into valid jobs',
    async (count) => {
      const tags = Array.from({ length: count }, (_, i) =>
        cacheTags.track(`${i}`),
      );

      await service.revalidate([...tags, ...tags]);

      expect(queue.add).toHaveBeenCalledTimes(Math.ceil(count / 50));
      const queuedTags = queue.add.mock.calls.flatMap(([, payload]) => {
        const parsed = revalidateBodySchema.parse(payload);
        return parsed.tags;
      });
      expect(queuedTags).toEqual(tags);
    },
  );

  it('validates every batch before queueing any job', async () => {
    const tags = Array.from({ length: 50 }, (_, i) => cacheTags.track(`${i}`));

    await expect(service.revalidate([...tags, ''])).rejects.toThrow();

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('propagates a queue failure so the caller retries all tags', async () => {
    const tags = Array.from({ length: 51 }, (_, i) => cacheTags.track(`${i}`));
    const error = new Error('Queue unavailable');
    queue.add.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

    await expect(service.revalidate(tags)).rejects.toThrow(error);
  });
});
