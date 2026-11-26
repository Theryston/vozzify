import { subscriptions } from './schema/subscriptions.js';
import { users } from './schema/users.js';

/** The private inputs repositories need to project an Avatar's public marks. */
export const avatarIdentityColumns = {
  avatarRole: users.role,
  avatarMembership: {
    paidMembership: subscriptions.paidMembership,
    currentPeriodEnd: subscriptions.currentPeriodEnd,
    recoveryStartedAt: subscriptions.recoveryStartedAt,
  },
};
