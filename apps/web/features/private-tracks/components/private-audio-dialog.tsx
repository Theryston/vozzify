import {
  createPrivateTrackBodySchema,
  privateTrackUploadErrorDetailsSchema,
} from '@vozzify/contracts';
import { UploadIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, type RefObject, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldError } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api/api-error';
import { useSubmitPrivateTrack } from '../hooks/use-private-tracks';

type AudioPickerProps = {
  pending: boolean;
  input: RefObject<HTMLInputElement | null>;
  selected: File | undefined;
  problem: 'invalidAudio' | 'missingVideoAudio' | 'uploadError' | undefined;
  onSelected: (file: File | undefined) => void;
};

export function PrivateAudioDialog({ userId }: { userId: string }) {
  const t = useTranslations('privateTracks');
  const [open, setOpen] = useState(false);
  const submit = useSubmitPrivateTrack(userId);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submit.isPending) setOpen(nextOpen);
      }}
    >
      <DialogTrigger render={<Button className="w-full sm:w-auto" />}>
        <UploadIcon data-icon="inline-start" />
        {t('newTrack')}
      </DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('newTrack')}</DialogTitle>
          <DialogDescription id="private-audio-hint">
            {t('audioLimits')}
          </DialogDescription>
        </DialogHeader>
        <PrivateAudioForm
          pending={submit.isPending}
          onUpload={async (file) => {
            await submit.mutateAsync(file);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PrivateAudioForm({
  pending,
  onUpload,
}: {
  pending: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const t = useTranslations('privateTracks');
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File>();
  const [problem, setProblem] = useState<AudioPickerProps['problem']>();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProblem(undefined);
    if (
      !selected ||
      !createPrivateTrackBodySchema.safeParse({ audio: selected }).success
    ) {
      setProblem('invalidAudio');
      return;
    }
    try {
      await onUpload(selected);
      setSelected(undefined);
    } catch (error) {
      setProblem(uploadProblem(error));
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex min-w-0 flex-col items-start gap-4"
    >
      <AudioPicker
        pending={pending}
        input={input}
        selected={selected}
        problem={problem}
        onSelected={(file) => {
          setSelected(file);
          setProblem(undefined);
        }}
      />
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? t('uploading') : t('upload')}
      </Button>
    </form>
  );
}

function AudioPicker({
  pending,
  input,
  selected,
  problem,
  onSelected,
}: AudioPickerProps) {
  const t = useTranslations('privateTracks');
  const description = problem ? 'private-audio-error' : 'private-audio-hint';
  const invalid = problem === 'invalidAudio' || problem === 'missingVideoAudio';

  return (
    <Field data-invalid={invalid}>
      <input
        ref={input}
        aria-label={t('chooseAudio')}
        id="private-audio"
        name="audio"
        type="file"
        accept="audio/*,video/*"
        disabled={pending}
        onChange={(event) => onSelected(event.target.files?.[0])}
        hidden
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          aria-invalid={invalid}
          aria-describedby={description}
          onClick={() => input.current?.click()}
        >
          <UploadIcon data-icon="inline-start" />
          {t('chooseAudio')}
        </Button>
        <p
          aria-live="polite"
          className="min-w-0 break-words font-medium text-foreground text-sm"
        >
          {selected?.name}
        </p>
      </div>
      {problem ? (
        <FieldError id="private-audio-error">{t(problem)}</FieldError>
      ) : null}
    </Field>
  );
}

function uploadProblem(error: unknown): AudioPickerProps['problem'] {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') {
    return 'uploadError';
  }
  return privateTrackUploadErrorDetailsSchema.safeParse(error.details).success
    ? 'missingVideoAudio'
    : 'invalidAudio';
}
