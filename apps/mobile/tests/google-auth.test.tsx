import {
  GoogleSignin,
  type SignInSuccessResponse,
} from '@react-native-google-signin/google-signin';
import { screen, userEvent, waitFor } from '@testing-library/react-native';
import {
  AUTH_VERIFICATION_CODE_ISSUED_HEADER,
  type CurrentUser,
} from '@vozzify/contracts';
import Constants from 'expo-constants';
import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Load the shell before spying on Expo's fetch transport.
import '../app/_layout';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(),
  },
  isCancelledResponse: (value: { type: string }) => value.type === 'cancelled',
}));

jest.setTimeout(15_000);

const google = {
  webClientId: 'test-web.apps.googleusercontent.com',
  iosClientId: 'test-ios.apps.googleusercontent.com',
};
const account = { id: 'user-1', email: 'ada@example.com' };
const googleResponse: SignInSuccessResponse = {
  type: 'success',
  data: {
    user: {
      ...account,
      name: 'Ada',
      familyName: null,
      givenName: 'Ada',
      photo: null,
    },
    scopes: [],
    idToken: 'id-token-from-google',
    serverAuthCode: null,
  },
};
const selectAccount = jest.mocked(GoogleSignin.signIn);
let request: jest.SpiedFunction<typeof fetch>;
const credentialError = /^Could not continue with Google[.]/;
const originalExpoConfig = Constants.expoConfig;

beforeEach(() => {
  jest.replaceProperty(Constants, 'expoConfig', {
    ...originalExpoConfig,
    name: 'Vozzify',
    slug: 'vozzify',
    extra: { ...originalExpoConfig?.extra, google },
  });
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
  selectAccount.mockReset();
  request = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sessionResponse(
  username: string | null,
  options: {
    email?: string;
    emailVerified?: boolean;
    codeIssued?: boolean;
  } = {},
) {
  const { email = account.email, emailVerified = true, codeIssued } = options;
  return new Response(
    JSON.stringify({ user: { ...account, email, username, emailVerified } }),
    {
      headers: {
        'set-auth-token': 'signed.session',
        ...(codeIssued
          ? { [AUTH_VERIFICATION_CODE_ISSUED_HEADER]: 'true' }
          : {}),
      },
    },
  );
}

async function pressGoogle() {
  await userEvent.press(
    await screen.findByRole('button', { name: 'Continue with Google' }),
  );
}

describe('native Google auth screens', () => {
  it('sends a new verified Google User from sign-up to Username setup', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    selectAccount.mockResolvedValueOnce(googleResponse);
    request.mockResolvedValueOnce(sessionResponse(null));
    const router = await renderRouter('./app', { initialUrl: '/sign-up' });

    await pressGoogle();

    expect(await screen.findByText('Choose your Username')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/setup-username');
    expect(GoogleSignin.configure).toHaveBeenCalledWith(google);
    const [url, options] = request.mock.calls[0] ?? [];
    expect(String(url)).toMatch('/v1/auth/sign-in/social');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(new Headers(options?.headers).get('x-vozzify-auth')).toBe('native');
    expect(JSON.parse(String(options?.body))).toEqual({
      provider: 'google',
      idToken: { token: googleResponse.data.idToken },
    });
  });

  it('lets a pending Google User request a code when the exchange issued none', async () => {
    selectAccount.mockResolvedValueOnce(googleResponse);
    request.mockResolvedValueOnce(
      sessionResponse(null, {
        email: 'pending@example.com',
        emailVerified: false,
      }),
    );
    await renderRouter('./app', { initialUrl: '/sign-in' });

    await pressGoogle();

    expect(await screen.findByText('Verify your email')).toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeEnabled();
  });

  it('keeps an existing cooldown for the normalized email when Google issues no new code', async () => {
    const sentAt = Date.now() - 10_000;
    jest
      .mocked(SecureStore.getItemAsync)
      .mockResolvedValueOnce(
        JSON.stringify({ verification: { email: 'Ada@Example.com', sentAt } }),
      );
    selectAccount.mockResolvedValueOnce(googleResponse);
    request.mockResolvedValueOnce(
      sessionResponse(null, { emailVerified: false }),
    );
    await renderRouter('./app', { initialUrl: '/sign-in' });

    await pressGoogle();

    expect(await screen.findByText('Verify your email')).toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeDisabled();
    const writes = jest.mocked(SecureStore.setItemAsync).mock.calls;
    const saved = JSON.parse(writes[writes.length - 1]?.[1] ?? '{}');
    expect(saved).toMatchObject({ verification: { sentAt } });
  });

  it('requires email verification and Username setup before resuming an action', async () => {
    selectAccount.mockResolvedValueOnce(googleResponse);
    request
      .mockResolvedValueOnce(
        sessionResponse(null, { emailVerified: false, codeIssued: true }),
      )
      .mockResolvedValueOnce(sessionResponse(null))
      .mockResolvedValueOnce(new Response(JSON.stringify({ available: true })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...account,
            username: 'ada',
            emailVerified: true,
            name: 'Ada',
            role: 'USER',
            image: null,
            createdAt: '2026-11-26T00:00:00Z',
          } satisfies CurrentUser),
        ),
      );
    const router = await renderRouter('./app', {
      initialUrl: '/sign-up?redirectTo=%2Fcomponents&action=open-overlay',
    });

    await pressGoogle();
    expect(await screen.findByText('Verify your email')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/verify-email');
    expect(screen.queryByText('A native overlay')).not.toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeDisabled();
    const writes = jest.mocked(SecureStore.setItemAsync).mock.calls;
    const saved = JSON.parse(writes[writes.length - 1]?.[1] ?? '{}');
    expect(saved).toMatchObject({
      verification: { email: account.email, sentAt: expect.any(Number) },
      continuation: { destination: '/components', action: 'open-overlay' },
    });

    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.press(screen.getByRole('button', { name: 'Verify email' }));

    expect(await screen.findByText('Choose your Username')).toBeOnTheScreen();
    expect(screen.queryByText('A native overlay')).not.toBeOnTheScreen();
    await userEvent.type(screen.getByLabelText('Username'), 'ada');
    expect(await screen.findByText('Username available')).toBeOnTheScreen();
    await userEvent.press(
      screen.getByRole('button', { name: 'Save Username' }),
    );

    expect(await screen.findByText('A native overlay')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/components');
  });

  it('returns to Home after a returning User selects Google without a destination', async () => {
    selectAccount.mockResolvedValueOnce(googleResponse);
    request.mockResolvedValueOnce(sessionResponse('ada'));
    const router = await renderRouter('./app', { initialUrl: '/sign-in' });

    await pressGoogle();

    expect(await screen.findByText('Signed in as @ada')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  it('continues the saved destination when Google signs in after password recovery', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(
      JSON.stringify({
        passwordReset: { destination: '/components', action: 'open-overlay' },
      }),
    );
    selectAccount.mockResolvedValueOnce(googleResponse);
    request.mockResolvedValueOnce(sessionResponse('ada'));
    const router = await renderRouter('./app', { initialUrl: '/sign-in' });

    await pressGoogle();

    expect(await screen.findByText('A native overlay')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/components');
  });

  it('keeps the sign-in form after cancellation and resumes the pending action on retry', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    selectAccount
      .mockResolvedValueOnce({ type: 'cancelled', data: null })
      .mockResolvedValueOnce(googleResponse);
    request.mockResolvedValueOnce(sessionResponse('ada'));
    const router = await renderRouter('./app', {
      initialUrl: '/sign-in?redirectTo=%2Fcomponents&action=open-overlay',
    });
    const identifier = await screen.findByLabelText('Email or Username');
    await userEvent.type(identifier, 'ada');

    await pressGoogle();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    });
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('ada')).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: true,
    });

    await pressGoogle();

    expect(await screen.findByText('A native overlay')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/components');
  });

  it.each([
    [
      'provider error',
      () => selectAccount.mockRejectedValueOnce(new Error('SDK error')),
    ],
    [
      'missing ID token',
      () =>
        selectAccount.mockResolvedValueOnce({
          ...googleResponse,
          data: { ...googleResponse.data, idToken: null },
        }),
    ],
    [
      'API rejection',
      () => {
        selectAccount.mockResolvedValueOnce(googleResponse);
        request.mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'INVALID_TOKEN' }), {
            status: 401,
          }),
        );
      },
    ],
  ])('shows a localized, recoverable %s on sign-up', async (_reason, fail) => {
    fail();
    const router = await renderRouter('./app', {
      initialUrl: '/sign-up?redirectTo=%2Fcomponents',
    });
    await userEvent.type(await screen.findByLabelText('Name'), 'Ada');

    await pressGoogle();

    expect(await screen.findByRole('alert')).toHaveTextContent(credentialError);
    expect(screen.getByDisplayValue('Ada')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Create account' }),
    ).toBeEnabled();
    expect(router.getPathname()).toBe('/sign-up');
    expect(router.getSearchParams()).toMatchObject({
      redirectTo: '/components',
    });
  });
});
