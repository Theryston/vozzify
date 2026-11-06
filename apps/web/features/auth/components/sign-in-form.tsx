'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SignInBody } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { FieldSeparator } from '@/components/ui/field';
import { useRouter } from '@/lib/i18n/navigation';
import { loadAuthClient } from '../auth-client';
import { type AuthErrorCode, authErrorCode, authRequest } from '../auth-error';
import { lazyResolver } from '../lazy-resolver';
import { authKeys } from '../query-keys';
import { authHref, redirectToFromSearch } from '../redirect-to';
import { browserStorage, rememberCodeSentAt } from '../resend-cooldown';
import { sessionUserOptions } from '../session';
import {
  emailToVerify,
  isSignedInAndOnboarded,
  type SignInCredentials,
  signInCredentials,
} from '../sign-in';
import { useLocationSearch } from '../use-location-search';
import { FormAlert } from './form-alert';
import { GoogleButton } from './google-button';
import { SignInFields } from './sign-in-fields';
import { StepHeader } from './step-header';
import { SubmitButton } from './submit-button';
import { TextLink } from './text-link';

const signInResolver = lazyResolver<SignInBody>(() =>
  import('@vozzify/contracts').then((m) => m.signInBodySchema),
);

type SignInError = AuthErrorCode | 'GOOGLE';

function requestSignIn(credentials: SignInCredentials) {
  return authRequest(() =>
    loadAuthClient().then((client) =>
      credentials.method === 'email'
        ? client.signIn.email({
            email: credentials.email,
            password: credentials.password,
          })
        : client.signIn.username({
            username: credentials.username,
            password: credentials.password,
          }),
    ),
  );
}

/**
 * Signs in, then continues to `redirectTo` (the gate takes users without a
 * username to pick one). An unverified email was just sent a code by the
 * API, so it goes to be verified instead.
 */
function useSignIn(redirectTo: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<SignInError | null>(null);
  // Set once this form signed the user in, so the refreshed session doesn't
  // also trigger the signed-in visitor redirect.
  const signedIn = useRef(false);

  const signIn = async (values: SignInBody) => {
    setError(null);
    const credentials = signInCredentials(values);
    const result = await requestSignIn(credentials);
    if (result.error) {
      const code = authErrorCode(result.error);
      const email = emailToVerify(code, credentials);
      if (email === null) {
        setError(code);
        return;
      }
      rememberCodeSentAt(browserStorage(), email, Date.now());
      router.push(authHref('/verify-email', redirectTo, { email }));
      return;
    }
    signedIn.current = true;
    await queryClient.invalidateQueries({ queryKey: authKeys.session() });
    router.push(redirectTo);
    router.refresh();
  };

  return { signIn, error, setError, signedIn };
}

/** Someone already signed in has nothing to do here: send them on. */
function useLeaveWhenSignedIn(
  redirectTo: string,
  signedIn: { current: boolean },
) {
  const router = useRouter();
  const { data: user } = useQuery(sessionUserOptions());

  useEffect(
    () => () => {
      // Cache Components retains the form's refs while its Activity is hidden.
      // Returning through history must run the signed-in visitor redirect.
      signedIn.current = false;
    },
    [signedIn],
  );

  useEffect(() => {
    if (!signedIn.current && isSignedInAndOnboarded(user)) {
      router.replace(redirectTo);
    }
  }, [user, redirectTo, router, signedIn]);
}

/** The failed attempt's error, or the confirmation of a password reset. */
function SignInNotice({
  error,
  passwordReset,
}: {
  error: SignInError | null;
  passwordReset: boolean;
}) {
  const t = useTranslations('auth');
  const tErrors = useTranslations('authErrors');

  if (error) {
    return (
      <FormAlert>
        {error === 'GOOGLE' ? t('signUp.googleError') : tErrors(error)}
      </FormAlert>
    );
  }
  if (!passwordReset) return null;
  return <FormAlert tone="success">{t('signIn.passwordReset')}</FormAlert>;
}

export function SignInForm() {
  const t = useTranslations('auth');
  const search = useLocationSearch();
  const redirectTo = redirectToFromSearch(search);
  const params = new URLSearchParams(search);
  const googleFailed = params.has('error');
  // Set by the password reset, which sends the user here to sign in again.
  const passwordReset = params.get('reset') === '1';
  const { signIn, error, setError, signedIn } = useSignIn(redirectTo);
  useLeaveWhenSignedIn(redirectTo, signedIn);
  // No defaultValues, so what was typed before hydration is kept (see
  // SignUpForm).
  const form = useForm<SignInBody>({
    resolver: signInResolver,
    mode: 'onTouched',
  });
  useEffect(() => {
    signInResolver.preload().catch(() => {});
  }, []);

  const shownError: SignInError | null =
    error ?? (googleFailed ? 'GOOGLE' : null);

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        overline={t('signIn.overline')}
        title={t('signIn.title')}
        description={t('signIn.description')}
      />
      <form
        noValidate
        onSubmit={form.handleSubmit(signIn)}
        className="flex flex-col gap-5"
      >
        <SignInNotice error={shownError} passwordReset={passwordReset} />
        <SignInFields form={form} redirectTo={redirectTo} />
        <SubmitButton
          pending={form.formState.isSubmitting}
          className="mt-1 w-full"
        >
          {t('signIn.submit')}
        </SubmitButton>
      </form>
      <FieldSeparator>{t('signUp.or')}</FieldSeparator>
      <GoogleButton errorPath="/sign-in" onError={() => setError('GOOGLE')} />
      <p className="text-center text-muted-foreground text-sm">
        {t.rich('signIn.noAccount', {
          link: (chunks) => (
            <TextLink href={authHref('/sign-up', redirectTo)}>
              {chunks}
            </TextLink>
          ),
        })}
      </p>
    </div>
  );
}
