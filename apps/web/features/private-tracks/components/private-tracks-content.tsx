'use client';

import { createPrivateTrackBodySchema } from '@vozzify/contracts';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { FormEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { useRouter } from '@/lib/i18n/navigation';

import {
  usePrivateTracks,
  useSubmitPrivateTrack,
} from '../hooks/use-private-tracks';

type AccountUser = {
  id?: string;
  username: string | null;
  emailVerified: boolean;
};

export function PrivateTracksContent({
  user,
  loading,
}: {
  user: AccountUser | null;
  loading: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File>();
  const [validationError, setValidationError] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const tracks = usePrivateTracks(user?.id ?? '');
  const submit = useSubmitPrivateTrack(user?.id ?? '');

  usePrivateTracksPageEffects({
    loading,
    user,
    tracks: tracks.data?.pages,
    setPaywallOpen,
  });

  if (loading || !user?.username || !user.emailVerified) return null;

  const submitAudio = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(false);
    setUploadError(false);
    if (!tracks.data?.pages[0]?.canSubmit) {
      setPaywallOpen(true);
      return;
    }
    if (!selected || !isValidPrivateAudio(selected)) {
      setValidationError(true);
      return;
    }
    try {
      await submit.mutateAsync(selected);
      setSelected(undefined);
      if (input.current) input.current.value = '';
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        setValidationError(true);
      } else {
        setUploadError(true);
      }
    }
  };

  return (
    <PrivateTracksLibrary
      tracks={tracks.data?.pages.flatMap((page) => page.items) ?? []}
      canSubmit={tracks.data?.pages[0]?.canSubmit ?? false}
      loading={tracks.isPending}
      loadError={tracks.isError}
      hasMore={tracks.hasNextPage}
      loadingMore={tracks.isFetchingNextPage}
      pending={submit.isPending}
      selected={selected}
      input={input}
      paywallOpen={paywallOpen}
      validationError={validationError}
      uploadError={uploadError}
      onSelected={setSelected}
      onSubmit={submitAudio}
      onPaywallOpenChange={setPaywallOpen}
      onLoadMore={() => void tracks.fetchNextPage()}
    />
  );
}

const isValidPrivateAudio = (file: File) =>
  createPrivateTrackBodySchema.safeParse({ audio: file }).success;

function usePrivateTracksPageEffects({
  loading,
  user,
  tracks,
  setPaywallOpen,
}: {
  loading: boolean;
  user: AccountUser | null;
  tracks: { canSubmit: boolean; items: unknown[] }[] | undefined;
  setPaywallOpen: (open: boolean) => void;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!loading && user === null) {
      router.replace({
        pathname: '/sign-in',
        query: { redirectTo: '/me/tracks' },
      });
    }
  }, [loading, router, user]);

  useEffect(() => {
    const firstPage = tracks?.[0];
    if (firstPage && !firstPage.canSubmit && firstPage.items.length === 0) {
      setPaywallOpen(true);
    }
  }, [setPaywallOpen, tracks]);
}

type LibraryProps = {
  tracks: { id: string; title: string; artist: string }[];
  canSubmit: boolean;
  loading: boolean;
  loadError: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  pending: boolean;
  selected: File | undefined;
  input: RefObject<HTMLInputElement | null>;
  paywallOpen: boolean;
  validationError: boolean;
  uploadError: boolean;
  onSelected: (file: File | undefined) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPaywallOpenChange: (open: boolean) => void;
  onLoadMore: () => void;
};

function PrivateTracksLibrary(props: LibraryProps) {
  const t = useTranslations('privateTracks');
  return (
    <section className="flex flex-col gap-6">
      <PrivateAudioForm {...props} />
      <UploadFeedback
        validationError={props.validationError}
        uploadError={props.uploadError}
      />
      <PrivateTrackRows
        tracks={props.tracks}
        loading={props.loading}
        loadError={props.loadError}
      />
      {props.hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
          >
            {props.loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      ) : null}
      <ProDialog
        open={props.paywallOpen}
        onPaywallOpenChange={props.onPaywallOpenChange}
      />
    </section>
  );
}

function PrivateAudioForm({
  canSubmit,
  pending,
  input,
  onSelected,
  onSubmit,
}: LibraryProps) {
  const t = useTranslations('privateTracks');
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label htmlFor="private-audio" className="font-semibold text-sm">
          {t('chooseAudio')}
        </label>
        <input
          ref={input}
          id="private-audio"
          name="audio"
          type="file"
          accept="audio/*"
          disabled={!canSubmit || pending}
          onChange={(event) => onSelected(event.target.files?.[0])}
          className="min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-semibold file:text-secondary-foreground"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t('uploading') : t('upload')}
      </Button>
    </form>
  );
}

function UploadFeedback({
  validationError,
  uploadError,
}: Pick<LibraryProps, 'validationError' | 'uploadError'>) {
  const t = useTranslations('privateTracks');
  return (
    <>
      {validationError ? (
        <p role="alert" className="text-destructive text-sm">
          {t('invalidAudio')}
        </p>
      ) : null}
      {uploadError ? (
        <p role="alert" className="text-destructive text-sm">
          {t('uploadError')}
        </p>
      ) : null}
    </>
  );
}

function PrivateTrackRows({
  tracks,
  loading,
  loadError,
}: Pick<LibraryProps, 'tracks' | 'loading' | 'loadError'>) {
  const t = useTranslations('privateTracks');
  return (
    <>
      {loading ? <p role="status">{t('loading')}</p> : null}
      {loadError ? (
        <p role="alert" className="text-destructive text-sm">
          {t('loadError')}
        </p>
      ) : null}
      {!loading && !loadError && tracks.length === 0 ? (
        <p className="rounded-2xl bg-card px-5 py-8 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : null}
      {tracks.length ? (
        <ul className="divide-y divide-border rounded-2xl bg-card px-4">
          {tracks.map((track) => (
            <li
              key={track.id}
              className="flex min-h-16 flex-col justify-center py-3"
            >
              <span className="font-semibold">{track.title}</span>
              {track.artist ? (
                <span className="text-muted-foreground text-sm">
                  {track.artist}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

const ProDialog = dynamic(
  () =>
    import('./private-tracks-pro-dialog').then((module) => module.ProDialog),
  { ssr: false },
);
