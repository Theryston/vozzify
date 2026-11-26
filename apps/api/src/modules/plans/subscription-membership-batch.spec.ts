import { Test } from '@nestjs/testing';
import { avatarIdentityFields } from '../users/user-avatar-identity.service.js';
import { SubscriptionMembershipService } from './subscription-membership.service.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

describe('public Avatar identity membership', () => {
  const repository = { membershipForUsers: vi.fn() };
  let membership: SubscriptionMembershipService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SubscriptionMembershipService,
        { provide: SubscriptionsRepository, useValue: repository },
      ],
    }).compile();
    membership = module.get(SubscriptionMembershipService);
  });

  it('does not query for an empty page', async () => {
    await expect(membership.paidMemberIds([])).resolves.toEqual(new Set());
    expect(repository.membershipForUsers).not.toHaveBeenCalled();
  });

  it('reads effective paid marks for a mixed page in one batch', async () => {
    const roles = ['active', 'expired', 'recovery', 'ordinary'];
    repository.membershipForUsers.mockResolvedValue([
      {
        userId: 'active',
        paidMembership: true,
        currentPeriodEnd: new Date(Date.now() + 60_000),
        recoveryStartedAt: null,
      },
      {
        userId: 'expired',
        paidMembership: true,
        currentPeriodEnd: new Date(Date.now() - 60_000),
        recoveryStartedAt: null,
      },
      {
        userId: 'recovery',
        paidMembership: false,
        currentPeriodEnd: null,
        recoveryStartedAt: new Date(),
      },
    ]);

    await expect(membership.paidMemberIds(roles)).resolves.toEqual(
      new Set(['active', 'recovery']),
    );
    expect(repository.membershipForUsers).toHaveBeenCalledExactlyOnceWith(
      roles,
    );
  });

  it.each([
    [false, 'USER', {}],
    [true, 'USER', { avatarIdentity: { pro: true } }],
    [false, 'ADMIN', { avatarIdentity: { admin: true } }],
    [true, 'ADMIN', { avatarIdentity: { pro: true, admin: true } }],
  ] as const)(
    'projects independent marks for Pro %s and role %s',
    (pro, role, fields) => {
      expect(avatarIdentityFields(pro, role)).toEqual(fields);
    },
  );
});
