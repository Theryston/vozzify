import { Test } from '@nestjs/testing';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { UserAvatarIdentityService } from './user-avatar-identity.service.js';
import { UsersRepository } from './users.repository.js';

describe('User Avatar identities', () => {
  it('combines only public marks for a batch of displayed Users', async () => {
    const ids = ['admin', 'pro', 'both', 'free', 'unknown'];
    const users = {
      findAvatarRoles: vi.fn().mockResolvedValue([
        { id: 'admin', role: 'ADMIN' },
        { id: 'pro', role: 'USER' },
        { id: 'both', role: 'ADMIN' },
        { id: 'free', role: 'USER' },
      ]),
    };
    const membership = {
      paidMemberIds: vi.fn().mockResolvedValue(new Set(['pro', 'both'])),
    };
    const module = await Test.createTestingModule({
      providers: [
        UserAvatarIdentityService,
        { provide: UsersRepository, useValue: users },
        { provide: SubscriptionMembershipService, useValue: membership },
      ],
    }).compile();

    await expect(
      module.get(UserAvatarIdentityService).findByUserIds(ids),
    ).resolves.toEqual(
      new Map([
        ['admin', { admin: true }],
        ['pro', { pro: true }],
        ['both', { admin: true, pro: true }],
      ]),
    );
    expect(users.findAvatarRoles).toHaveBeenCalledExactlyOnceWith(ids);
    expect(membership.paidMemberIds).toHaveBeenCalledExactlyOnceWith(ids);
    await module.close();
  });
});
