import type { PublicProfile } from '@vozzify/contracts';
import Image from 'next/image';
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
  imageSizes = size === 'full' ? '(min-width: 768px) 192px, 96px' : '40px',
}: {
  user: AvatarUser;
  className?: string;
  imageSizes?: string;
  size?: 'compact' | 'full';
}) {
  const single = avatarTreatment(user.avatarIdentity) === 'studio-single';
  const artwork = (
    <Avatar className={single ? undefined : cn('size-9', className)}>
      {user.image ? (
        <AvatarImage
          className="data-error:invisible data-loading:invisible"
          render={
            <Image
              fill
              unoptimized
              sizes={imageSizes}
              src={user.image}
              alt=""
            />
          }
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
