import type { MusicCatalogReimportStatus } from '@vozzify/contracts';
import type { ArtistRepository } from '../artist/artist.repository.js';
import { ArtistService } from '../artist/artist.service.js';
import type {
  BootstrapRepository,
  BootstrapState,
} from './bootstrap.repository.js';
import { BootstrapService } from './bootstrap.service.js';

const MBID = '00000000-0000-4000-8000-000000000001';
const artist = { id: 1, mbid: MBID, name: 'Fixture artist' };

const setup = (
  state: BootstrapState | undefined = { phase: 'ready', dataset: 'full' },
) => {
  const bootstrapRepository = {
    getState: vi.fn<BootstrapRepository['getState']>(async () => state),
  };
  const report = vi.fn(async () => ({
    replicationSequence: 1,
    pendingOutbox: 0,
  }));
  const reportReimport = vi.fn(
    async (): Promise<MusicCatalogReimportStatus | undefined> => undefined,
  );
  const adoptIfSwitched = vi.fn(async () => undefined);
  const bootstrap = new BootstrapService(
    bootstrapRepository as unknown as BootstrapRepository,
    'full',
    { report },
    { status: { reportReimport }, cutover: { adoptIfSwitched } },
  );
  const artistRepository = {
    findByMbid: vi.fn(async () => artist),
    findTagVotes: vi.fn(async () => []),
  };
  return {
    service: new ArtistService(
      artistRepository as unknown as ArtistRepository,
      bootstrap,
    ),
    bootstrapRepository,
    artistRepository,
    report,
    reportReimport,
    adoptIfSwitched,
  };
};

describe('Metadata readiness without status statistics', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['replication', 'reimport'])(
    'answers metadata while %s statistics never resolve',
    async (source) => {
      vi.useFakeTimers();
      const fixture = setup();
      const pending = () => new Promise<never>(() => {});
      if (source === 'replication') {
        fixture.report.mockImplementation(pending);
      } else {
        fixture.reportReimport.mockImplementation(pending);
      }
      const lookup = fixture.service.getArtist(MBID);
      const result = Promise.race([
        lookup,
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('blocked by statistics'), 1);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toEqual({
        mbid: MBID,
        name: artist.name,
        genres: [],
      });
      expect(fixture.report).not.toHaveBeenCalled();
      expect(fixture.reportReimport).not.toHaveBeenCalled();
      expect(fixture.artistRepository.findByMbid).toHaveBeenCalledWith(MBID);
    },
  );

  it.each(['restoring', 'restored', 'indexing'] as const)(
    'refuses metadata before reading it while the import is %s',
    async (phase) => {
      const fixture = setup({ phase, dataset: 'full' });

      await expect(fixture.service.getArtist(MBID)).rejects.toMatchObject({
        code: 'CATALOG_NOT_READY',
      });

      expect(fixture.artistRepository.findByMbid).not.toHaveBeenCalled();
      expect(fixture.report).not.toHaveBeenCalled();
      expect(fixture.reportReimport).not.toHaveBeenCalled();
    },
  );

  it('refuses metadata until the import records a phase', async () => {
    const fixture = setup();
    fixture.bootstrapRepository.getState.mockResolvedValue(undefined);

    await expect(fixture.service.getArtist(MBID)).rejects.toMatchObject({
      code: 'CATALOG_NOT_READY',
    });

    expect(fixture.artistRepository.findByMbid).not.toHaveBeenCalled();
    expect(fixture.report).not.toHaveBeenCalled();
  });

  it('adopts a cutover before checking readiness and reading metadata', async () => {
    const fixture = setup({ phase: 'indexing', dataset: 'full' });
    const calls: string[] = [];
    fixture.adoptIfSwitched.mockImplementation(async () => {
      calls.push('cutover');
      fixture.bootstrapRepository.getState.mockImplementation(async () => {
        calls.push('phase');
        return { phase: 'ready', dataset: 'full' };
      });
    });
    fixture.artistRepository.findByMbid.mockImplementation(async () => {
      calls.push('artist');
      return artist;
    });

    await expect(fixture.service.getArtist(MBID)).resolves.toMatchObject({
      mbid: MBID,
    });

    expect(calls).toEqual(['cutover', 'phase', 'artist']);
    expect(fixture.report).not.toHaveBeenCalled();
    expect(fixture.reportReimport).not.toHaveBeenCalled();
  });

  it('reads the current phase again when the import finishes', async () => {
    const fixture = setup({ phase: 'indexing', dataset: 'full' });
    await expect(fixture.service.getArtist(MBID)).rejects.toMatchObject({
      code: 'CATALOG_NOT_READY',
    });
    fixture.bootstrapRepository.getState.mockResolvedValue({
      phase: 'ready',
      dataset: 'full',
    });

    await expect(fixture.service.getArtist(MBID)).resolves.toMatchObject({
      mbid: MBID,
    });

    expect(fixture.bootstrapRepository.getState).toHaveBeenCalledTimes(2);
    expect(fixture.artistRepository.findByMbid).toHaveBeenCalledTimes(1);
    expect(fixture.report).not.toHaveBeenCalled();
  });
});
