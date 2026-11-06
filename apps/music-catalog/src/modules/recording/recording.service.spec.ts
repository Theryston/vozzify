import { CatalogError } from '../../errors/catalog-error.js';
import type { BootstrapService } from '../bootstrap/bootstrap.service.js';
import type { RecordingRepository } from './recording.repository.js';
import { RecordingService } from './recording.service.js';
import type { RecordingRow, ReleaseRow } from './recording-data.js';

const MBID = '00000000-0000-4000-8000-000000000100';
const OLD_MBID = '00000000-0000-4000-8000-000000000101';

const row: RecordingRow = {
  id: 7,
  mbid: MBID,
  title: 'Song',
  lengthMs: null,
  disambiguation: '',
  video: false,
  artistCreditId: 3,
  artistCreditName: 'Artist',
};

const releaseRow: ReleaseRow = {
  coverRank: 1,
  id: 1,
  mbid: '00000000-0000-4000-8000-000000000200',
  title: 'Release',
  releaseGroupMbid: '00000000-0000-4000-8000-000000000300',
  primaryType: null,
  status: null,
  mediumPosition: 1,
  trackPosition: 1,
};

const setup = (
  overrides: Partial<Record<keyof RecordingRepository, unknown>> = {},
) => {
  const repository = {
    findByMbid: vi.fn(async () => row),
    findMergedInto: vi.fn(async () => undefined),
    findCreditedArtists: vi.fn(async () => []),
    findIsrcs: vi.fn(async () => []),
    findReleases: vi.fn(async () => []),
    findReleaseEvents: vi.fn(async () => []),
    findWorks: vi.fn(async () => []),
    findExternalUrls: vi.fn(async () => []),
    findTagLevels: vi.fn(async () => ({
      recording: [],
      release_group: [],
      artist: [],
    })),
    ...overrides,
  };
  const bootstrap = { assertReady: vi.fn(async () => undefined) };
  const service = new RecordingService(
    repository as unknown as RecordingRepository,
    bootstrap as unknown as BootstrapService,
  );
  return { service, repository, bootstrap };
};

const failureOf = async (work: Promise<unknown>): Promise<CatalogError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof CatalogError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected a CatalogError');
};

describe('RecordingService', () => {
  describe('getRecording', () => {
    it('assembles the Recording from what the repository reads', async () => {
      const { service, repository } = setup({
        findIsrcs: vi.fn(async () => ['GBUM71029604']),
        findWorks: vi.fn(async () => [{ mbid: 'w1', title: 'Work' }]),
      });

      await expect(service.getRecording(MBID)).resolves.toMatchObject({
        mbid: MBID,
        title: 'Song',
        isrcs: ['GBUM71029604'],
        works: [{ mbid: 'w1', title: 'Work' }],
      });
      expect(repository.findByMbid).toHaveBeenCalledExactlyOnceWith(MBID);
    });

    it('reads the parts of the Recording by the ids it was found with', async () => {
      const { service, repository } = setup();

      await service.getRecording(MBID);

      expect(repository.findCreditedArtists).toHaveBeenCalledWith(3);
      expect(repository.findIsrcs).toHaveBeenCalledWith(7);
      expect(repository.findReleases).toHaveBeenCalledWith(7);
      expect(repository.findWorks).toHaveBeenCalledWith(7);
      expect(repository.findExternalUrls).toHaveBeenCalledWith(7);
      expect(repository.findTagLevels).toHaveBeenCalledWith({
        recordingId: 7,
        artistCreditId: 3,
      });
    });

    it('reads the events of the releases it found', async () => {
      const { service, repository } = setup({
        findReleases: vi.fn(async () => [
          { ...releaseRow, id: 11 },
          { ...releaseRow, id: 12 },
        ]),
      });

      await service.getRecording(MBID);

      expect(repository.findReleaseEvents).toHaveBeenCalledWith([11, 12]);
    });

    it('takes the genres from the fallback when the Recording has no genre', async () => {
      const { service } = setup({
        findTagLevels: vi.fn(async () => ({
          recording: [],
          release_group: [],
          artist: [{ name: 'rock', count: 5, genreMbid: 'g1' }],
        })),
      });

      await expect(service.getRecording(MBID)).resolves.toMatchObject({
        tagsSource: 'artist',
        genres: [{ mbid: 'g1', name: 'rock', count: 5 }],
      });
    });

    it('answers CATALOG_NOT_READY, reading nothing, while the import is running', async () => {
      const notReady = new CatalogError('CATALOG_NOT_READY', 'Importing');
      const { service, repository, bootstrap } = setup();
      bootstrap.assertReady.mockRejectedValueOnce(notReady);

      await expect(failureOf(service.getRecording(MBID))).resolves.toBe(
        notReady,
      );
      expect(repository.findByMbid).not.toHaveBeenCalled();
    });

    it('answers RECORDING_NOT_FOUND for an MBID nothing knows', async () => {
      const { service } = setup({ findByMbid: vi.fn(async () => undefined) });

      const error = await failureOf(service.getRecording(OLD_MBID));

      expect(error.code).toBe('RECORDING_NOT_FOUND');
      expect(error.message).toContain(OLD_MBID);
      expect(error.newMbid).toBeUndefined();
    });

    it('answers RECORDING_MOVED with the new MBID for an MBID merged away', async () => {
      const { service, repository } = setup({
        findByMbid: vi.fn(async () => undefined),
        findMergedInto: vi.fn(async () => MBID),
      });

      const error = await failureOf(service.getRecording(OLD_MBID));

      expect(error.code).toBe('RECORDING_MOVED');
      expect(error.newMbid).toBe(MBID);
      expect(error.message).toContain(OLD_MBID);
      expect(error.message).toContain(MBID);
      expect(repository.findMergedInto).toHaveBeenCalledExactlyOnceWith(
        OLD_MBID,
      );
    });

    it('does not look for a merge when the Recording exists', async () => {
      const { service, repository } = setup();

      await service.getRecording(MBID);

      expect(repository.findMergedInto).not.toHaveBeenCalled();
    });
  });
});
