import type { AvatarIdentity } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import type { SessionUser } from '../session';

export function sessionAvatarIdentity(
  user: SessionUser,
  subscribed?: boolean,
): AvatarIdentity {
  return { pro: subscribed === true, admin: user.role === 'ADMIN' };
}

export function useAvatarStatusText() {
  const t = useTranslations('avatarIdentity');
  return (identity?: AvatarIdentity) =>
    [identity?.pro && t('pro'), identity?.admin && t('admin')]
      .filter(Boolean)
      .join(', ') || undefined;
}
