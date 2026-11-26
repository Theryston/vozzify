'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  PRIVATE_TRACK_METADATA_MAX_LENGTH,
  type PrivateTrackDetail,
  type UpdatePrivateTrackMetadataBody,
  updatePrivateTrackMetadataBodySchema,
} from '@vozzify/contracts';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { type UseFormRegister, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useUpdatePrivateTrackMetadata } from '../hooks/use-private-track-metadata';
import { PrivateTrackRecordingPicker } from './private-track-recording-picker';

const resolveMetadataChanges = zodResolver(
  updatePrivateTrackMetadataBodySchema,
);

export function PrivateTrackMetadataDialog({
  track,
  featured = false,
}: {
  track: PrivateTrackDetail;
  featured?: boolean;
}) {
  const t = useTranslations('privateTracks.metadata');
  const [open, setOpen] = useState(false);
  const update = useUpdatePrivateTrackMetadata(track.ownerId, track.id);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (update.isPending) return;
        if (next) update.reset();
        setOpen(next);
      }}
    >
      <MetadataTrigger featured={featured} />
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('edit')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {open ? (
          <MetadataForm
            track={track}
            pending={update.isPending}
            failed={update.isError}
            onSave={(body) =>
              update.mutate(body, { onSuccess: () => setOpen(false) })
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MetadataTrigger({ featured }: { featured: boolean }) {
  const t = useTranslations('privateTracks.metadata');
  return (
    <DialogTrigger
      aria-label={t('edit')}
      title={t('edit')}
      render={
        <Button
          variant={featured ? 'outline' : 'ghost'}
          size={featured ? 'icon-sm' : 'icon'}
          className={
            featured
              ? 'relative after:absolute after:-inset-1 after:rounded-full after:content-[""]'
              : undefined
          }
        />
      }
    >
      <Pencil aria-hidden="true" />
    </DialogTrigger>
  );
}

type FormProps = {
  track: PrivateTrackDetail;
  pending: boolean;
  failed: boolean;
  onSave: (body: UpdatePrivateTrackMetadataBody) => void;
};
type PickerSelection = Parameters<
  typeof PrivateTrackRecordingPicker
>[0]['selected'];

function useMetadataForm(
  track: PrivateTrackDetail,
  onSave: FormProps['onSave'],
) {
  const [selected, setSelected] = useState<PickerSelection>(
    track.recording ?? null,
  );
  const [initialValues] = useState<UpdatePrivateTrackMetadataBody>(() => ({
    title: track.title,
    artist: track.artist,
    recordingMbid: track.recording?.mbid,
  }));
  const form = useForm({
    defaultValues: initialValues,
    resolver: ({ title, artist, recordingMbid }, context, options) => {
      // Existing source tags can exceed the length allowed for owner edits.
      const changes = {
        ...(title !== initialValues.title ? { title } : {}),
        ...(artist !== initialValues.artist ? { artist } : {}),
        ...(recordingMbid !== initialValues.recordingMbid
          ? { recordingMbid }
          : {}),
      };
      return resolveMetadataChanges(changes, context, options);
    },
  });
  const select = (choice: PickerSelection) => {
    setSelected(choice);
    form.setValue('recordingMbid', choice?.mbid ?? null, { shouldDirty: true });
  };
  const submit = form.handleSubmit(onSave);
  return { selected, select, submit, form };
}

function MetadataForm({ track, pending, failed, onSave }: FormProps) {
  const t = useTranslations('privateTracks.metadata');
  const id = useId();
  const { selected, select, submit, form } = useMetadataForm(track, onSave);
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {(['title', 'artist'] as const).map((name) => (
        <MetadataTextField
          key={name}
          name={name}
          id={`${id}-${name}`}
          error={Boolean(form.formState.errors[name])}
          pending={pending}
          register={form.register}
        />
      ))}
      <PrivateTrackRecordingPicker
        selected={selected}
        pending={pending}
        select={select}
      />
      {failed ? <FieldError>{t('saveError')}</FieldError> : null}
      <Button
        type="submit"
        className="self-end"
        disabled={pending || !form.formState.isDirty}
      >
        {pending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}

function MetadataTextField({
  name,
  id,
  error,
  pending,
  register,
}: {
  name: 'title' | 'artist';
  id: string;
  error: boolean;
  pending: boolean;
  register: UseFormRegister<UpdatePrivateTrackMetadataBody>;
}) {
  const t = useTranslations('privateTracks.metadata');
  return (
    <Field data-invalid={error}>
      <FieldLabel htmlFor={id}>{t(name)}</FieldLabel>
      <Input
        id={id}
        maxLength={PRIVATE_TRACK_METADATA_MAX_LENGTH}
        aria-invalid={error}
        aria-describedby={error ? `${id}-error` : undefined}
        readOnly={pending}
        {...register(name)}
      />
      {error ? (
        <FieldError id={`${id}-error`}>{t('invalidText')}</FieldError>
      ) : null}
    </Field>
  );
}
