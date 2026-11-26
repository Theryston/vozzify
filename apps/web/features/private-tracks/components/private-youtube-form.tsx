import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreatePrivateYouTubeTrackBody,
  createPrivateYouTubeTrackBodySchema,
  PRIVATE_YOUTUBE_URL_MAX_LENGTH,
} from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
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
  const { register, handleSubmit, formState, setError, clearErrors } =
    useForm<CreatePrivateYouTubeTrackBody>({
      resolver: zodResolver(createPrivateYouTubeTrackBodySchema),
      defaultValues: { url: '' },
    });
  const error = formState.errors.url;

  const submit = handleSubmit(async (body) => {
    try {
      await onSubmitLink(body);
    } catch (error) {
      const invalid = isApiError(error) && error.code === 'VALIDATION_FAILED';
      setError('url', { type: invalid ? 'invalid' : 'provider' });
    }
  });

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col items-start gap-4"
    >
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="private-youtube-url">
          {t('youtubeLink')}
        </FieldLabel>
        <Input
          id="private-youtube-url"
          type="url"
          disabled={pending}
          maxLength={PRIVATE_YOUTUBE_URL_MAX_LENGTH}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? 'private-youtube-error' : 'private-youtube-hint'
          }
          {...register('url', { onChange: () => clearErrors('url') })}
        />
        {error && (
          <FieldError id="private-youtube-error">
            {t(error.type === 'provider' ? 'youtubeError' : 'invalidYouTube')}
          </FieldError>
        )}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {t(pending ? 'submittingYouTube' : 'submitYouTube')}
      </Button>
    </form>
  );
}
