import { Test } from '@nestjs/testing';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateTrackPracticeRepository } from './private-track-practice.repository.js';
import { PrivateTrackPracticeAccessService } from './private-track-practice-access.service.js';

describe('PrivateTrackPracticeAccessService', () => {
  const tracks = { findOwnedForHistory: vi.fn(), lockOwned: vi.fn() };
  const membership = { hasPaidMembership: vi.fn() };
  let service: PrivateTrackPracticeAccessService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrivateTrackPracticeAccessService,
        { provide: PrivateTrackPracticeRepository, useValue: tracks },
        { provide: SubscriptionMembershipService, useValue: membership },
      ],
    }).compile();
    service = moduleRef.get(PrivateTrackPracticeAccessService);
  });

  it('skips the owner lookup when the history page contains no private tracks', async () => {
    await expect(service.listOwnedHistoryHeaders('owner', [])).resolves.toEqual(
      new Map(),
    );
    expect(tracks.findOwnedForHistory).not.toHaveBeenCalled();
  });

  it('hydrates distinct owned tracks in one query and normalizes legacy display metadata', async () => {
    const title = 't'.repeat(500);
    const artist = 'a'.repeat(200);
    tracks.findOwnedForHistory.mockResolvedValue([
      {
        id: 'legacy',
        title: `${title} excess title`,
        artist: `${artist} excess artist`,
        recordingLink: { kind: 'unlinked' },
      },
      { id: 'no-tags', title: '', artist: '' },
    ]);

    const headers = await service.listOwnedHistoryHeaders('owner', [
      'legacy',
      'no-tags',
      'legacy',
      'missing',
    ]);

    expect(tracks.findOwnedForHistory).toHaveBeenCalledExactlyOnceWith(
      'owner',
      ['legacy', 'no-tags', 'missing'],
    );
    expect([...headers.values()]).toEqual([
      {
        id: 'legacy',
        title,
        artistCredit: [{ name: artist, joinPhrase: '' }],
        coverUrl: null,
      },
      { id: 'no-tags', title: 'no-tags', artistCredit: [], coverUrl: null },
    ]);
  });

  it('checks membership only after locking an owned track', async () => {
    await expect(
      service.assertCanPractice('owner', 'missing'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(tracks.lockOwned).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'missing',
    );
    expect(membership.hasPaidMembership).not.toHaveBeenCalled();
  });

  it('allows practice on a completed owned track with current membership', async () => {
    tracks.lockOwned.mockResolvedValue({ processingStatus: 'COMPLETED' });
    membership.hasPaidMembership.mockResolvedValue(true);

    await expect(
      service.assertCanPractice('owner', 'track'),
    ).resolves.toBeUndefined();
    expect(membership.hasPaidMembership).toHaveBeenCalledExactlyOnceWith(
      'owner',
    );
  });
});
