import type { PublicProfile } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import { LogoMark } from '@/components/logo-mark';

export function UserIdentityMarks({
  identity,
  recordLabel = false,
}: {
  identity: PublicProfile['avatarIdentity'];
  recordLabel?: boolean;
}) {
  const t = useTranslations('avatarIdentity');
  if (!identity?.admin && !identity?.pro) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 align-middle font-semibold text-xs tracking-normal">
      {identity.pro && (
        <span
          className={
            recordLabel
              ? 'sr-only'
              : 'rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground'
          }
        >
          {t('pro')}
        </span>
      )}
      {identity.admin && (
        <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-background">
          <LogoMark className="size-3 text-current" />
          {t('admin')}
        </span>
      )}
    </span>
  );
}
