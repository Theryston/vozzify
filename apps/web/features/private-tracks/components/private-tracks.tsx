'use client';

import { PRIVATE_AUDIO_MAX_BYTES } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import type { FormEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { ApiError } from '@/lib/api/api-error';
import { Link, useRouter } from '@/lib/i18n/navigation';

import {
  usePrivateTracks,
  useSubmitPrivateTrack,
} from '../hooks/use-private-tracks';

type AccountUser = {
  id?: string;
  username: string | null;
  emailVerified: boolean;
};

export function PrivateTracks() {
  return (
    <SessionUserBoundary
      render={(user, loading) => (
        <PrivateTracksContent user={user} loading={loading} />
      )}
    />
  );
}

function PrivateTracksContent({
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
    tracks: tracks.data,
    setPaywallOpen,
  });

  if (loading || !user?.username || !user.emailVerified) return null;

  const submitAudio = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(false);
    setUploadError(false);
    if (!tracks.data?.canSubmit) {
      setPaywallOpen(true);
      return;
    }
    if (!isValidPrivateAudio(selected)) {
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
      tracks={tracks.data?.tracks ?? []}
      canSubmit={tracks.data?.canSubmit ?? false}
      loading={tracks.isPending}
      loadError={tracks.isError}
      pending={submit.isPending}
      selected={selected}
      input={input}
      paywallOpen={paywallOpen}
      validationError={validationError}
      uploadError={uploadError}
      onSelected={setSelected}
      onSubmit={submitAudio}
      onPaywallOpenChange={setPaywallOpen}
    />
  );
}

const isValidPrivateAudio = (file: File | undefined) =>
  file !== undefined && file.size > 0 && file.size <= PRIVATE_AUDIO_MAX_BYTES;

function usePrivateTracksPageEffects({
  loading,
  user,
  tracks,
  setPaywallOpen,
}: {
  loading: boolean;
  user: AccountUser | null;
  tracks: { canSubmit: boolean; tracks: unknown[] } | undefined;
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
    if (tracks && !tracks.canSubmit && tracks.tracks.length === 0) {
      setPaywallOpen(true);
    }
  }, [setPaywallOpen, tracks]);
}

type LibraryProps = {
  tracks: { id: string; title: string; artist: string }[];
  canSubmit: boolean;
  loading: boolean;
  loadError: boolean;
  pending: boolean;
  selected: File | undefined;
  input: RefObject<HTMLInputElement | null>;
  paywallOpen: boolean;
  validationError: boolean;
  uploadError: boolean;
  onSelected: (file: File | undefined) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPaywallOpenChange: (open: boolean) => void;
};

function PrivateTracksLibrary(props: LibraryProps) {
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

function ProDialog({
  open,
  onPaywallOpenChange,
}: {
  open: boolean;
  onPaywallOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('privateTracks');
  return (
    <Dialog open={open} onOpenChange={onPaywallOpenChange}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('proTitle')}</DialogTitle>
          <DialogDescription>{t('proDescription')}</DialogDescription>
        </DialogHeader>
        <Button
          render={<Link href="/plans" />}
          onClick={() => onPaywallOpenChange(false)}
        >
          {t('viewPlans')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
