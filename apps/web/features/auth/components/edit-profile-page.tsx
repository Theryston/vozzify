import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { AccountPageFrame } from '../../../components/account-page-frame';
import { EditProfile } from './edit-profile';

/**
 * Frame of `/me/edit`: the heading is part of the static page, the form
 * below it loads with the session. Adds the message namespaces the form
 * needs, only on this page.
 */
export async function EditProfilePage() {
  const t = await getTranslations('profile.edit');
  const { avatarIdentity, errors, auth, profile } = await getMessages();

  return (
    <AccountPageFrame
      overline={t('overline')}
      title={t('title')}
      description={t('description')}
    >
      <NextIntlClientProvider
        messages={{
          avatarIdentity,
          errors,
          auth: { fields: auth.fields },
          profile,
        }}
      >
        <EditProfile />
      </NextIntlClientProvider>
    </AccountPageFrame>
  );
}
