import { useQuery } from '@tanstack/react-query';
import { setUsernameBodySchema } from '@vozzify/contracts';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@vozzify/contracts/auth-rules';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { checkUsername } from '../../../lib/auth/auth-api';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthField, AuthNotice } from './auth-field';
import { AuthFrame } from './auth-frame';

function useUsernameAvailability(username: string) {
  const [candidate, setCandidate] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setCandidate(username), 300);
    return () => clearTimeout(timer);
  }, [username]);
  const query = useQuery({
    queryKey: ['username-availability', candidate],
    queryFn: ({ signal }) => checkUsername(candidate, signal),
    enabled:
      candidate === username &&
      setUsernameBodySchema.safeParse({ username }).success,
    retry: false,
    staleTime: 30_000,
  });
  return candidate === username
    ? query
    : { data: undefined, isFetching: false };
}

function UsernameForm() {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const auth = useMobileAuth();
  const [raw, setRaw] = useState('');
  const username = raw.trim().toLowerCase();
  const availability = useUsernameAvailability(username);
  const form = useAuthSubmit(setUsernameBodySchema, auth.chooseUsername);
  const taken =
    availability.data?.available === false ||
    form.error === 'USERNAME_IS_ALREADY_TAKEN';
  const notice = availability.isFetching
    ? 'checking'
    : availability.data?.available && !taken
      ? 'available'
      : undefined;
  return (
    <>
      <AuthField
        label={t('username')}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={raw}
        error={
          form.invalid.has('username')
            ? t('usernameInvalid', {
                min: USERNAME_MIN_LENGTH,
                max: USERNAME_MAX_LENGTH,
              })
            : undefined
        }
        onChangeText={(value) => {
          setRaw(value);
          form.clear('username');
        }}
      />
      {notice ? <AuthNotice>{t(`setupUsername.${notice}`)}</AuthNotice> : null}
      {taken || form.error ? (
        <AuthNotice error>
          {errors(
            taken ? 'USERNAME_IS_ALREADY_TAKEN' : (form.error ?? 'UNKNOWN'),
          )}
        </AuthNotice>
      ) : null}
      <Button
        disabled={form.pending || taken}
        onPress={() => void form.submit({ username })}
        testID="submit-username"
      >
        {form.pending ? t('submitting') : t('setupUsername.submit')}
      </Button>
    </>
  );
}

export function SetupUsernameScreen() {
  const t = useTranslations('auth.setupUsername');
  return (
    <AuthFrame title={t('title')} description={t('description')}>
      <UsernameForm />
    </AuthFrame>
  );
}
