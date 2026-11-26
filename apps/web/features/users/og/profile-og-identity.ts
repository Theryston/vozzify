import { readFile } from 'node:fs/promises';
import type { AvatarIdentity } from '@vozzify/contracts';
import { getTranslations } from 'next-intl/server';
import { avatarTreatment } from '@/features/auth/components/avatar-treatment';
import type { Locale } from '@/lib/i18n/routing';

export async function profileOgIdentity(
  identity: AvatarIdentity | undefined,
  locale: Locale,
) {
  if (!identity) return undefined;
  const t = await getTranslations({ locale, namespace: 'avatarIdentity' });
  const adminLabel = identity.admin ? t('admin') : undefined;
  if (avatarTreatment(identity) === 'round') return { adminLabel };
  const bytes = await readFile(
    new URL('../../auth/components/studio-record.svg', import.meta.url),
  );
  return {
    adminLabel,
    single: {
      label: t('pro'),
      disc: `data:image/svg+xml;base64,${bytes.toString('base64')}`,
    },
  };
}
