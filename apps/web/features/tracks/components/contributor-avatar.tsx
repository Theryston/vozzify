import type { TrackContributor } from '@vozzify/contracts';

import { UserAvatar } from '@/features/auth/components/user-avatar';

/** A Contributor's Avatar, or their initials without one. */
export function ContributorAvatar({
  contributor,
  className,
}: {
  contributor: TrackContributor;
  className?: string;
}) {
  return <UserAvatar user={contributor} className={className} />;
}
