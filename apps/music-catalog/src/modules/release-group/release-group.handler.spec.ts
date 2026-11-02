import type { MusicCatalogReleaseGroup } from '@vozzify/contracts';
import { createGetReleaseGroupHandler } from './release-group.handler.js';
import type { ReleaseGroupService } from './release-group.service.js';

const MBID = '00000000-0000-4000-8000-000000000300';

const releaseGroup: MusicCatalogReleaseGroup = {
  mbid: MBID,
  title: 'A Night at the Opera',
  primaryType: 'Album',
  secondaryTypes: [],
  firstReleaseYear: 1975,
  genres: [],
  artistCredit: { name: 'Queen', artists: [] },
  coverArtUrl: `https://assets.vozzify.com/cover-art-archive/release-group/${MBID}/front-500`,
  representativeRelease: null,
};

const setup = () => {
  const service = { getReleaseGroup: vi.fn(async () => releaseGroup) };
  const handler = createGetReleaseGroupHandler(
    service as unknown as ReleaseGroupService,
  );
  return { handler, service };
};

describe('createGetReleaseGroupHandler', () => {
  it('answers the getReleaseGroup request type', () => {
    expect(setup().handler.type).toBe('getReleaseGroup');
  });

  it('asks the service for the MBID of the payload', async () => {
    const { handler, service } = setup();

    await expect(handler.handle({ mbid: MBID })).resolves.toEqual(releaseGroup);
    expect(service.getReleaseGroup).toHaveBeenCalledExactlyOnceWith(MBID);
  });

  it.each([
    ['no payload', undefined],
    ['an empty payload', {}],
    ['a number', { mbid: 7 }],
    ['text that is not an MBID', { mbid: 'nope' }],
  ])('refuses %s before reaching the service', async (_label, payload) => {
    const { handler, service } = setup();

    await expect(handler.handle(payload)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(service.getReleaseGroup).not.toHaveBeenCalled();
  });

  it('never lets a field outside the contract reach a client', async () => {
    const { handler, service } = setup();
    service.getReleaseGroup.mockResolvedValueOnce({
      ...releaseGroup,
      internalId: 42,
    } as MusicCatalogReleaseGroup);

    await expect(handler.handle({ mbid: MBID })).resolves.not.toHaveProperty(
      'internalId',
    );
  });
});
