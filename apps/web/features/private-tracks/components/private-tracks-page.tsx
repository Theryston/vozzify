import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { PrivateTracksEntry } from './private-tracks-entry';

export async function PrivateTracksPage() {
  const { errors, privateTracks, tracks } = await getMessages();
  const { durationShort, durationLong, durationLabel } = tracks.practice;
  return (
    <NextIntlClientProvider
      messages={{
        errors,
        privateTracks,
        tracks: { practice: { durationShort, durationLong, durationLabel } },
      }}
    >
      <PrivateTracksEntry />
    </NextIntlClientProvider>
  );
}
