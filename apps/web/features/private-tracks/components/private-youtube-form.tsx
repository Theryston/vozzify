import {
  type CreatePrivateYouTubeTrackBody,
  createPrivateYouTubeTrackBodySchema,
} from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { isApiError } from '@/lib/api/api-error';

export function PrivateYouTubeForm({
  pending,
  onSubmitLink,
}: {
  pending: boolean;
  onSubmitLink: (body: CreatePrivateYouTubeTrackBody) => Promise<void>;
}) {
  const t = useTranslations('privateTracks');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<'invalidYouTube' | 'youtubeError'>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = createPrivateYouTubeTrackBodySchema.safeParse({ url });
    if (!parsed.success) {
      setError('invalidYouTube');
      return;
    }
    setError(undefined);
    try {
      await onSubmitLink(parsed.data);
    } catch (error) {
      setError(
        isApiError(error) && error.code === 'VALIDATION_FAILED'
          ? 'invalidYouTube'
          : 'youtubeError',
      );
    }
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col items-start gap-4"
    >
      <Field data-invalid={error === 'invalidYouTube'}>
        <FieldLabel htmlFor="private-youtube-url">
          {t('youtubeLink')}
        </FieldLabel>
        <Input
          id="private-youtube-url"
          type="url"
          value={url}
          disabled={pending}
          maxLength={2048}
          aria-invalid={error === 'invalidYouTube'}
          aria-describedby={
            error ? 'private-youtube-error' : 'private-youtube-hint'
          }
          onChange={(event) => {
            setUrl(event.target.value);
            setError(undefined);
          }}
        />
        {error && (
          <FieldError id="private-youtube-error">{t(error)}</FieldError>
        )}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {t(pending ? 'submittingYouTube' : 'submitYouTube')}
      </Button>
    </form>
  );
}
