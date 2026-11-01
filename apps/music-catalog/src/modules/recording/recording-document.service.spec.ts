import type { RecordingDocumentRepository } from './recording-document.repository.js';
import { RecordingDocumentService } from './recording-document.service.js';
import type { DocumentRecordingRow } from './recording-document-data.js';

const row = (
  id: number,
  artistCreditId: number,
  title = `Title ${id}`,
): DocumentRecordingRow => ({
  id,
  mbid: `mbid-${id}`,
  title,
  disambiguation: '',
  artistCreditId,
  artistCreditName: `Artist ${artistCreditId}`,
});

const setup = (rows: DocumentRecordingRow[]) => {
  const repository = {
    findBatch: vi.fn(async () => rows),
    countProgress: vi.fn(async (afterId: number) => ({
      total: rows.length,
      indexed: rows.filter((recording) => recording.id <= afterId).length,
    })),
    findArtistNames: vi.fn(async () => []),
    findReleaseTitles: vi.fn(async () => [{ recordingId: 11, title: 'Album' }]),
    findPrimaryReleases: vi.fn(async () => [
      { recordingId: 11, mbid: 'release-1' },
    ]),
    findWorkTitles: vi.fn(async () => []),
    findRecordingGenres: vi.fn(async () => []),
    findReleaseGroupGenres: vi.fn(async () => []),
    findArtistGenres: vi.fn(async () => []),
  };
  const service = new RecordingDocumentService(
    repository as unknown as RecordingDocumentRepository,
  );
  return { service, repository };
};

describe('RecordingDocumentService', () => {
  describe('findBatch', () => {
    it('reads the next Recordings after the given id and builds a document for each', async () => {
      const { service, repository } = setup([row(11, 5), row(12, 6)]);

      const batch = await service.findBatch(10, 2);

      expect(repository.findBatch).toHaveBeenCalledExactlyOnceWith(10, 2);
      expect(batch?.documents).toMatchObject([
        {
          mbid: 'mbid-11',
          title: 'Title 11',
          releaseTitles: ['Album'],
          primaryReleaseMbid: 'release-1',
        },
        { mbid: 'mbid-12', title: 'Title 12', releaseTitles: [] },
      ]);
    });

    it('says where the batch ends, so the next one can start after it', async () => {
      const { service } = setup([row(11, 5), row(14, 6), row(19, 5)]);

      await expect(service.findBatch(10, 3)).resolves.toMatchObject({
        lastRecordingId: 19,
      });
    });

    it('reads what the whole batch needs with one query each, asking for every artist credit once', async () => {
      const { service, repository } = setup([
        row(11, 5),
        row(12, 5),
        row(13, 6),
      ]);

      await service.findBatch(10, 3);

      for (const query of [
        repository.findReleaseTitles,
        repository.findPrimaryReleases,
        repository.findWorkTitles,
        repository.findRecordingGenres,
        repository.findReleaseGroupGenres,
      ]) {
        expect(query).toHaveBeenCalledExactlyOnceWith([11, 12, 13]);
      }
      for (const query of [
        repository.findArtistNames,
        repository.findArtistGenres,
      ]) {
        expect(query).toHaveBeenCalledExactlyOnceWith([5, 6]);
      }
    });

    it('answers nothing, and reads nothing more, when no Recording is left', async () => {
      const { service, repository } = setup([]);

      await expect(service.findBatch(10, 5)).resolves.toBeUndefined();
      expect(repository.findReleaseTitles).not.toHaveBeenCalled();
    });
  });

  describe('countProgress', () => {
    it('reports the catalog size and how many Recordings its checkpoint confirms', async () => {
      const { service, repository } = setup([row(11, 5), row(12, 6)]);

      await expect(service.countProgress(11)).resolves.toEqual({
        total: 2,
        indexed: 1,
      });
      expect(repository.countProgress).toHaveBeenCalledExactlyOnceWith(11);
    });
  });
});
