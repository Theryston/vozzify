import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { AccountPageFrame } from '../../../components/account-page-frame';
import { PrivateTracks } from './private-tracks';

export async function PrivateTracksPage() {
  const t = await getTranslations('privateTracks');
  const { errors, privateTracks } = await getMessages();
  return (
    <AccountPageFrame
      overline={t('overline')}
      title={t('title')}
      description={t('description')}
    >
      <NextIntlClientProvider messages={{ errors, privateTracks }}>
        <PrivateTracks />
      </NextIntlClientProvider>
    </AccountPageFrame>
  );
}
