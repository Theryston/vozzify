import { Innertube } from 'youtubei.js';
import type { Env } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

vi.mock('youtubei.js', () => ({ Innertube: { create: vi.fn() } }));
const VIDEO_ID = 'aBcd1Efgh_2';

describe('YouTube practice video metadata', () => {
  const getBasicInfo = vi.fn();
  let client: YouTubeMusicClient;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(Innertube.create).mockResolvedValue({
      getBasicInfo,
    } as unknown as Innertube);
    client = new YouTubeMusicClient({} as Env);
  });

  it('reads the title and duration of an individual video outside the music catalog', async () => {
    getBasicInfo.mockResolvedValue({
      basic_info: { title: 'Rehearsal', duration: 42, is_live: false },
    });
    await expect(client.getPracticeVideo(VIDEO_ID)).resolves.toMatchObject({
      videoId: VIDEO_ID,
      title: 'Rehearsal',
      durationSeconds: 42,
    });
    expect(getBasicInfo).toHaveBeenCalledWith(VIDEO_ID, { client: 'WEB' });
  });

  it.each(['is_live', 'is_upcoming', 'is_private'])(
    'rejects videos marked %s',
    async (flag) => {
      getBasicInfo.mockResolvedValue({
        basic_info: { title: 'Unavailable', duration: 42, [flag]: true },
      });
      await expect(client.getPracticeVideo(VIDEO_ID)).resolves.toBeUndefined();
    },
  );
});
