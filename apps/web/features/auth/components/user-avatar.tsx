import type { PublicProfile } from '@vozzify/contracts';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { initials } from '../initials';
import { avatarTreatment } from './avatar-treatment';
import { StudioSingle } from './studio-single';

type AvatarUser = Pick<PublicProfile, 'name' | 'avatarIdentity'> & {
  username: string | null;
  image?: string | null;
  email?: string;
};

export function UserAvatar({
  user,
  className,
  size = 'compact',
}: {
  user: AvatarUser;
  className?: string;
  size?: 'compact' | 'full';
}) {
  const single = avatarTreatment(user.avatarIdentity) === 'studio-single';
  const artwork = (
    <Avatar className={single ? undefined : cn('size-9', className)}>
      {user.image ? (
        <AvatarImage
          className="data-error:hidden data-loading:hidden"
          keepMounted
          src={user.image}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : null}
      <AvatarFallback className="bg-primary/15 font-semibold text-primary">
        {initials(user.name, user.username ?? user.email ?? '')}
      </AvatarFallback>
    </Avatar>
  );
  return single ? (
    <StudioSingle name={user.name} size={size} className={className}>
      {artwork}
    </StudioSingle>
  ) : (
    artwork
  );
}
