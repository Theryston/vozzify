import { SubscriptionMembershipService } from './subscription-membership.service.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

describe('SubscriptionMembershipService', () => {
  const repository = { current: vi.fn() };
  const service = new SubscriptionMembershipService(
    repository as unknown as SubscriptionsRepository,
  );

  beforeEach(() => vi.clearAllMocks());

  it('returns false without an active contract', async () => {
    repository.current.mockResolvedValue(undefined);
    await expect(service.hasPaidMembership('u1')).resolves.toBe(false);
  });

  it('requires an active paid period', async () => {
    repository.current.mockResolvedValue({
      contract: {
        recoveryStartedAt: null,
        paidMembership: true,
        currentPeriodEnd: new Date(Date.now() + 60_000),
      },
    });
    await expect(service.hasPaidMembership('u1')).resolves.toBe(true);
    repository.current.mockResolvedValue({
      contract: {
        recoveryStartedAt: null,
        paidMembership: true,
        currentPeriodEnd: new Date(Date.now() - 60_000),
      },
    });
    await expect(service.hasPaidMembership('u1')).resolves.toBe(false);
  });

  it('honors active recovery grace and rejects expired grace', async () => {
    repository.current.mockResolvedValue({
      contract: {
        recoveryStartedAt: new Date(Date.now() - 60_000),
        paidMembership: false,
        currentPeriodEnd: null,
      },
    });
    await expect(service.hasPaidMembership('u1')).resolves.toBe(true);
    repository.current.mockResolvedValue({
      contract: {
        recoveryStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
        paidMembership: false,
        currentPeriodEnd: null,
      },
    });
    await expect(service.hasPaidMembership('u1')).resolves.toBe(false);
  });
});
