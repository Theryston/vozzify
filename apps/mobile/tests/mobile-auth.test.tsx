import { onlineManager } from '@tanstack/react-query';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router as appRouter } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

// Load the native shell before spying on fetch so Expo has installed its transport.
import '../app/_layout';

let mockInternetReachable = true;

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockImplementation(async () => ({
    isConnected: true,
    isInternetReachable: mockInternetReachable,
  })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Cold Expo Router loading runs through Babel when coverage is enabled.
jest.setTimeout(15_000);

const request = jest.spyOn(globalThis, 'fetch');
const readSecureStore = jest.spyOn(SecureStore, 'getItemAsync');
const writeSecureStore = jest.spyOn(SecureStore, 'setItemAsync');
const removeSecureStore = jest.spyOn(SecureStore, 'deleteItemAsync');

beforeEach(() => {
  mockInternetReachable = true;
  let saved: string | null = null;
  readSecureStore.mockReset();
  writeSecureStore.mockReset();
  removeSecureStore.mockReset();
  readSecureStore.mockImplementation(async () => saved);
  writeSecureStore.mockImplementation(async (_key, value) => {
    saved = value;
  });
  removeSecureStore.mockImplementation(async () => {
    saved = null;
  });
});

const stillNeedsUsername = {
  id: 'user-1',
  email: 'new@example.com',
  emailVerified: true,
  username: null,
};

function currentUser(username: string | null) {
  return {
    ...stillNeedsUsername,
    username,
    role: 'USER',
    name: 'Ana',
    image: null,
    createdAt: '2026-11-26T00:00:00Z',
  };
}

function deferResponse() {
  let respond: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  return { promise, respond };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function fill(label: string, value: string) {
  await userEvent.type(await screen.findByLabelText(label), value);
}

async function press(name: string) {
  await userEvent.press(await screen.findByRole('button', { name }));
}

afterEach(() => {
  request.mockReset();
});

function authResponse(
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    username: string | null;
  } = {
    id: 'user-1',
    email: 'ana@example.com',
    emailVerified: true,
    username: 'ana',
  },
) {
  return new Response(JSON.stringify({ user }), {
    headers: { 'set-auth-token': 'signed.session' },
  });
}

describe('mobile credential sign-in', () => {
  it.each([
    ['ana@example.com', 'email'],
    ['ana', 'username'],
  ])(
    'uses a legacy password with %s and returns to the gallery',
    async (identifier, method) => {
      request.mockResolvedValueOnce(authResponse());
      const router = await renderRouter('./app', {
        initialUrl: '/sign-in?redirectTo=%2Fcomponents',
      });

      await userEvent.type(
        screen.getByLabelText('Email or Username'),
        identifier,
      );
      await userEvent.type(screen.getByLabelText('Password'), 'old');
      await userEvent.press(screen.getByRole('button', { name: 'Sign in' }));

      expect(
        await screen.findByText('Foundation components'),
      ).toBeOnTheScreen();
      await waitFor(() => expect(router.getPathname()).toBe('/components'));
      expect(String(request.mock.calls[0]?.[0])).toMatch(
        new RegExp(`/v1/auth/sign-in/${method}$`),
      );
      expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
        [method]: identifier,
        password: 'old',
      });
    },
  );
});

describe('mobile email onboarding', () => {
  it('validates sign-up, accepts a weak valid password, handles code and Username conflicts, and resumes the overlay once', async () => {
    request
      .mockResolvedValueOnce(
        json({ user: { ...stillNeedsUsername, emailVerified: false } }),
      )
      .mockResolvedValueOnce(json({ code: 'INVALID_OTP' }, 400))
      .mockResolvedValueOnce(json({ code: 'OTP_EXPIRED' }, 400))
      .mockResolvedValueOnce(authResponse(stillNeedsUsername))
      .mockResolvedValueOnce(json({ available: true }))
      .mockResolvedValueOnce(
        json(
          { statusCode: 409, code: 'CONFLICT', message: 'Already taken' },
          409,
        ),
      )
      .mockResolvedValueOnce(json(currentUser(null)))
      .mockRejectedValueOnce(new Error('Availability request failed'))
      .mockResolvedValueOnce(json(currentUser('second_choice')));
    await renderRouter('./app');
    await userEvent.press(await screen.findByTestId('open-components'));
    await userEvent.press(await screen.findByTestId('gallery-sign-in-overlay'));
    await userEvent.press(
      await screen.findByRole('link', { name: 'Create account' }),
    );
    await press('Create account');
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(request).not.toHaveBeenCalled();

    await fill('Name', 'Ana');
    await fill('Email', stillNeedsUsername.email);
    await fill('Password', 'abcdef');
    expect(screen.getByText('Password strength: Weak')).toBeOnTheScreen();
    await press('Create account');

    expect(
      await screen.findByText(
        'Enter the six-digit code we sent to new@example.com.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeDisabled();
    await press('Verify email');
    expect(screen.getByText('Enter the 6-digit code.')).toBeOnTheScreen();
    await fill('Verification code', '123456');
    await press('Verify email');
    expect(
      await screen.findByText("That code isn't right. Check it and try again."),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Verification code')).toHaveDisplayValue('');
    await fill('Verification code', '123456');
    await press('Verify email');
    expect(await screen.findByText(/code has expired/i)).toBeOnTheScreen();
    await fill('Verification code', '654321');
    await press('Verify email');

    await press('Save Username');
    expect(
      screen.getByText('Use 3–50 letters, digits or underscores.'),
    ).toBeOnTheScreen();
    await fill('Username', 'First_Choice');
    expect(await screen.findByText('Username available')).toBeOnTheScreen();
    expect(JSON.parse(String(request.mock.calls[4]?.[1]?.body))).toEqual({
      username: 'first_choice',
    });
    await press('Save Username');
    expect(await screen.findByRole('alert')).toHaveTextContent(/taken/i);

    const input = screen.getByLabelText('Username');
    await userEvent.clear(input);
    await fill('Username', 'Second_Choice');
    expect(
      await screen.findByText(
        'Could not check availability. You can still try saving.',
      ),
    ).toBeOnTheScreen();
    await press('Save Username');
    expect(await screen.findByText('A native overlay')).toBeOnTheScreen();
    await userEvent.press(screen.getByTestId('overlay-dismiss'));
    expect(screen.queryByText('A native overlay')).toBeNull();
    await userEvent.press(screen.getByTestId('return-home'));
    expect(
      await screen.findByText('Signed in as @second_choice'),
    ).toBeOnTheScreen();
    await userEvent.press(screen.getByTestId('open-components'));
    expect(screen.queryByText('A native overlay')).toBeNull();
  });

  it('asks for the email after an unverified Username sign-in and restores verification after relaunch', async () => {
    request.mockResolvedValueOnce(json({ code: 'EMAIL_NOT_VERIFIED' }, 403));
    const router = await renderRouter('./app', { initialUrl: '/sign-in' });
    await fill('Email or Username', 'ana');
    await fill('Password', 'old');
    await press('Sign in');
    expect(await screen.findByLabelText('Email')).toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeDisabled();

    await router.unmount();
    const reopened = await renderRouter('./app');
    expect(await screen.findByText('Verify your email')).toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeDisabled();
    expect(reopened.getPathname()).toBe('/verify-email');
  });

  it('resends after sixty seconds and retains the new countdown on re-entry', async () => {
    let now = new Date('2026-11-26T00:00:00Z').getTime();
    const date = jest.spyOn(Date, 'now').mockImplementation(() => now);
    readSecureStore.mockResolvedValueOnce(
      JSON.stringify({
        verification: { email: 'resend@example.com', sentAt: now - 59_000 },
      }),
    );
    request.mockResolvedValueOnce(json({ success: true }));
    try {
      const router = await renderRouter('./app');
      expect(
        await screen.findByText('Send a new code in 1s'),
      ).toBeOnTheScreen();

      now += 1000;
      expect(
        await screen.findByText('Send a new code', {}, { timeout: 2000 }),
      ).toBeOnTheScreen();
      await press('Send a new code');
      expect(
        await screen.findByText('Send a new code in 60s'),
      ).toBeOnTheScreen();
      expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
        email: 'resend@example.com',
        type: 'email-verification',
      });
      await router.unmount();
      await renderRouter('./app');
      expect(
        await screen.findByText('Send a new code in 60s'),
      ).toBeOnTheScreen();
    } finally {
      date.mockRestore();
    }
  });

  it('restores a signed session and falls back to Home for a foreign continuation', async () => {
    request.mockResolvedValueOnce(
      json({
        user: { ...stillNeedsUsername, username: 'ana' },
      }),
    );
    readSecureStore.mockResolvedValueOnce(
      JSON.stringify({ token: 'signed.session' }),
    );
    const router = await renderRouter('./app', {
      initialUrl: '/sign-in?redirectTo=https%3A%2F%2Fexample.com',
    });
    expect(await screen.findByText('Signed in as @ana')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer signed.session');
  });

  it('restores an incomplete session and asks for Username before arrival', async () => {
    request.mockResolvedValueOnce(json({ user: stillNeedsUsername }));
    readSecureStore.mockResolvedValueOnce(
      JSON.stringify({
        token: 'signed.session',
        continuation: { destination: '/components' },
      }),
    );
    const router = await renderRouter('./app');
    expect(await screen.findByText('Choose your Username')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/setup-username');
  });
});

describe('background session restoration', () => {
  it('keeps a new sign-in when the saved-session request completes late', async () => {
    const late = deferResponse();
    readSecureStore.mockResolvedValueOnce(
      JSON.stringify({ token: 'saved.session' }),
    );
    request
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(authResponse());

    await renderRouter('./app', { initialUrl: '/sign-in' });
    await fill('Email or Username', 'ana');
    await fill('Password', 'old');
    await press('Sign in');
    expect(await screen.findByText('Signed in as @ana')).toBeOnTheScreen();
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

    await act(async () =>
      late.respond(
        authResponse({
          ...stillNeedsUsername,
          username: 'previous',
        }),
      ),
    );
    expect(screen.getByText('Signed in as @ana')).toBeOnTheScreen();
    expect(screen.queryByText('Signed in as @previous')).toBeNull();
  });

  it('keeps the sign-in form available when session validation fails', async () => {
    readSecureStore.mockResolvedValue(
      JSON.stringify({ token: 'signed.session' }),
    );
    request.mockRejectedValueOnce(new Error('offline'));
    await renderRouter('./app', { initialUrl: '/sign-in' });
    expect(
      await screen.findByRole('header', { name: 'Sign in' }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(writeSecureStore).not.toHaveBeenCalled();
  });

  it('discards an expired session and directs visitors away from Username setup', async () => {
    readSecureStore.mockResolvedValueOnce(
      JSON.stringify({ token: 'expired.session' }),
    );
    request.mockResolvedValueOnce(json(null));
    await renderRouter('./app', { initialUrl: '/setup-username' });
    expect(
      await screen.findByRole('header', { name: 'Sign in' }),
    ).toBeOnTheScreen();
    expect(writeSecureStore).toHaveBeenCalledWith(
      expect.any(String),
      '{}',
      expect.any(Object),
    );
  });

  it('cleans up a corrupted record and offers to show and hide the typed password', async () => {
    readSecureStore.mockResolvedValueOnce('corrupted record');
    await renderRouter('./app', { initialUrl: '/sign-in' });
    const label = 'Password';
    expect(await screen.findByLabelText(label)).toHaveProp(
      'secureTextEntry',
      true,
    );
    await userEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByLabelText(label)).toHaveProp('secureTextEntry', false);
    await userEvent.press(screen.getByLabelText('Hide password'));
    expect(screen.getByLabelText(label)).toHaveProp('secureTextEntry', true);
    expect(removeSecureStore).toHaveBeenCalledTimes(1);
  });

  it('prompts for verification before Username setup on an unverified restored session', async () => {
    readSecureStore.mockResolvedValueOnce(
      JSON.stringify({ token: 'signed.session' }),
    );
    request.mockResolvedValueOnce(
      json({
        user: {
          ...stillNeedsUsername,
          email: 'restore@example.com',
          emailVerified: false,
        },
      }),
    );
    await renderRouter('./app', { initialUrl: '/setup-username' });
    expect(
      await screen.findByText('Email to verify: restore@example.com'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeEnabled();
  });
});

it('can use system back to leave verification without reopening it', async () => {
  request.mockResolvedValueOnce(json({ code: 'EMAIL_NOT_VERIFIED' }, 403));
  await renderRouter('./app', { initialUrl: '/components' });
  await userEvent.press(await screen.findByTestId('gallery-sign-in-overlay'));
  await fill('Email or Username', 'leave@example.com');
  await fill('Password', 'old');
  await press('Sign in');
  expect(
    await screen.findByText(
      'Enter the six-digit code we sent to leave@example.com.',
    ),
  ).toBeOnTheScreen();
  await act(async () => appRouter.back());
  expect(await screen.findByText('Foundation components')).toBeOnTheScreen();
  expect(screen.queryByText('Verify your email')).toBeNull();
});

it('renders a cold-open gallery during validation and resumes Username setup when the session returns', async () => {
  mockInternetReachable = false;
  const session = deferResponse();
  readSecureStore.mockResolvedValueOnce(
    JSON.stringify({ token: 'signed.session' }),
  );
  request
    .mockReturnValueOnce(session.promise)
    .mockResolvedValueOnce(json({ available: true }))
    .mockResolvedValueOnce(json(currentUser('ana')));
  const router = await renderRouter('./app', { initialUrl: '/components' });
  expect(screen.getByText('Foundation components')).toBeOnTheScreen();
  expect(screen.getByTestId('overlay-open')).toBeOnTheScreen();
  expect(screen.queryByTestId('gallery-sign-in-overlay')).toBeNull();
  await act(async () => session.respond(json({ user: stillNeedsUsername })));

  expect(await screen.findByText('Choose your Username')).toBeOnTheScreen();
  expect(screen.queryByText('Foundation components')).toBeNull();
  expect(writeSecureStore).toHaveBeenCalledWith(
    expect.any(String),
    JSON.stringify({
      token: 'signed.session',
      continuation: { destination: '/components' },
    }),
    expect.any(Object),
  );
  await waitFor(() => expect(onlineManager.isOnline()).toBe(false));
  await fill('Username', 'ana');
  expect(await screen.findByText('Username available')).toBeOnTheScreen();
  await press('Save Username');
  expect(await screen.findByText('Foundation components')).toBeOnTheScreen();
  await waitFor(() => expect(router.getPathname()).toBe('/components'));
});

it('reconciles a Username already saved on another device after a conflict', async () => {
  readSecureStore.mockResolvedValueOnce(
    JSON.stringify({ token: 'signed.session' }),
  );
  request
    .mockResolvedValueOnce(json({ user: stillNeedsUsername }))
    .mockResolvedValueOnce(json({ available: true }))
    .mockResolvedValueOnce(
      json(
        { statusCode: 409, code: 'CONFLICT', message: 'Username already set' },
        409,
      ),
    )
    .mockResolvedValueOnce(json(currentUser('already_set')));
  await renderRouter('./app');
  await fill('Username', 'try_this');
  expect(await screen.findByText('Username available')).toBeOnTheScreen();
  await press('Save Username');
  expect(
    await screen.findByText('Signed in as @already_set'),
  ).toBeOnTheScreen();
  expect(String(request.mock.calls[3]?.[0])).toMatch(/\/v1\/me$/);
  expect(
    new Headers(request.mock.calls[3]?.[1]?.headers).get('authorization'),
  ).toBe('Bearer signed.session');
});

it('clears a revoked session during Username setup and keeps the requested destination for sign-in', async () => {
  readSecureStore.mockResolvedValueOnce(
    JSON.stringify({ token: 'signed.session' }),
  );
  request
    .mockResolvedValueOnce(json({ user: stillNeedsUsername }))
    .mockResolvedValueOnce(json({ available: true }))
    .mockResolvedValueOnce(
      json(
        { statusCode: 401, code: 'UNAUTHORIZED', message: 'Session revoked' },
        401,
      ),
    )
    .mockResolvedValueOnce(authResponse());
  await renderRouter('./app', { initialUrl: '/components' });
  await fill('Username', 'available');
  expect(await screen.findByText('Username available')).toBeOnTheScreen();
  await press('Save Username');
  expect(
    await screen.findByRole('header', { name: 'Sign in' }),
  ).toBeOnTheScreen();
  await fill('Email or Username', 'ana');
  await fill('Password', 'old');
  await press('Sign in');
  expect(await screen.findByText('Foundation components')).toBeOnTheScreen();
});

it('ignores a successful sign-up response after leaving the form', async () => {
  const submission = deferResponse();
  request.mockReturnValueOnce(submission.promise);
  const router = await renderRouter('./app', { initialUrl: '/sign-up' });
  await fill('Name', 'Ana');
  await fill('Email', 'abandoned@example.com');
  await fill('Password', 'abcdef');
  await press('Create account');
  await userEvent.press(screen.getByRole('link', { name: 'Sign in' }));
  expect(
    await screen.findByRole('header', { name: 'Sign in' }),
  ).toBeOnTheScreen();

  await act(async () => submission.respond(json({ user: stillNeedsUsername })));
  expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(writeSecureStore).not.toHaveBeenCalled();
  expect(router.getPathname()).toBe('/sign-in');
  expect(screen.queryByText('Verify your email')).toBeNull();
});

it('keeps the cold-open gallery usable as a visitor when session validation fails', async () => {
  readSecureStore.mockResolvedValue(
    JSON.stringify({ token: 'signed.session' }),
  );
  request.mockRejectedValueOnce(new Error('offline'));
  const router = await renderRouter('./app', { initialUrl: '/components' });
  expect(
    await screen.findByTestId('gallery-sign-in-overlay'),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('overlay-open')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(router.getPathname()).toBe('/components');
  expect(request).toHaveBeenCalledTimes(1);
});
