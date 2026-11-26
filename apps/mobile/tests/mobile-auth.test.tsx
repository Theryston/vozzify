import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Cold Expo Router loading runs through Babel when coverage is enabled.
jest.setTimeout(15_000);

const request = jest.spyOn(globalThis, 'fetch');
const readSecureStore = jest.spyOn(SecureStore, 'getItemAsync');
const writeSecureStore = jest.spyOn(SecureStore, 'setItemAsync');
const removeSecureStore = jest.spyOn(SecureStore, 'deleteItemAsync');

beforeEach(() => {
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
      .mockResolvedValueOnce(json({ available: true }))
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
      await screen.findByText('Code sent to new@example.com'),
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
    expect(await screen.findByText('Username available')).toBeOnTheScreen();
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

describe('auth restoration and retry', () => {
  it('retains a saved session on a connection failure and lets the user retry', async () => {
    readSecureStore.mockResolvedValue(
      JSON.stringify({ token: 'signed.session' }),
    );
    request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user: { ...stillNeedsUsername, username: 'ana' } }),
          { headers: { 'set-auth-token': 'renewed.session' } },
        ),
      );
    await renderRouter('./app', { initialUrl: '/sign-in' });
    expect(
      await screen.findByText(/could not restore your session/i),
    ).toBeOnTheScreen();
    expect(writeSecureStore).not.toHaveBeenCalled();
    await press('Try again');
    expect(await screen.findByText('Signed in as @ana')).toBeOnTheScreen();
    expect(writeSecureStore).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ token: 'renewed.session' }),
      expect.any(Object),
    );
  });

  it('discards an expired session and directs visitors away from Username setup', async () => {
    readSecureStore.mockResolvedValueOnce(
      JSON.stringify({ token: 'expired.session' }),
    );
    request.mockResolvedValueOnce(json(null));
    await renderRouter('./app', { initialUrl: '/setup-username' });
    expect(await screen.findByText('Sign in to Vozzify')).toBeOnTheScreen();
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

it('can leave email verification and return to the original screen without reopening verification', async () => {
  request.mockResolvedValueOnce(json({ code: 'EMAIL_NOT_VERIFIED' }, 403));
  await renderRouter('./app', {
    initialUrl: '/sign-in?redirectTo=%2Fcomponents',
  });
  await fill('Email or Username', 'leave@example.com');
  await fill('Password', 'old');
  await press('Sign in');
  expect(
    await screen.findByText('Code sent to leave@example.com'),
  ).toBeOnTheScreen();
  await userEvent.press(screen.getByRole('link', { name: 'Return to app' }));
  expect(await screen.findByText('Foundation components')).toBeOnTheScreen();
  expect(screen.queryByText('Verify your email')).toBeNull();
});

it('gates a cold-open gallery during restoration and retains it through Username setup', async () => {
  const session = deferResponse();
  readSecureStore.mockResolvedValueOnce(
    JSON.stringify({ token: 'signed.session' }),
  );
  request
    .mockReturnValueOnce(session.promise)
    .mockResolvedValueOnce(json({ available: true }))
    .mockResolvedValueOnce(json(currentUser('ana')));
  const router = await renderRouter('./app', { initialUrl: '/components' });
  expect(screen.getByLabelText('Restoring your session')).toBeOnTheScreen();
  expect(screen.queryByTestId('overlay-open')).toBeNull();
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
  expect(await screen.findByText('Sign in to Vozzify')).toBeOnTheScreen();
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
  expect(await screen.findByText('Sign in to Vozzify')).toBeOnTheScreen();

  await act(async () => submission.respond(json({ user: stillNeedsUsername })));
  expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(writeSecureStore).not.toHaveBeenCalled();
  expect(router.getPathname()).toBe('/sign-in');
  expect(screen.queryByText('Verify your email')).toBeNull();
});

it('offers retry on a cold-open gallery when session restoration is offline', async () => {
  readSecureStore.mockResolvedValue(
    JSON.stringify({ token: 'signed.session' }),
  );
  request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(json({ user: stillNeedsUsername }));
  await renderRouter('./app', { initialUrl: '/components' });
  expect(
    await screen.findByText(/could not restore your session/i),
  ).toBeOnTheScreen();
  expect(screen.queryByTestId('overlay-open')).toBeNull();
  await press('Try again');
  expect(await screen.findByText('Choose your Username')).toBeOnTheScreen();
  expect(screen.queryByTestId('overlay-open')).toBeNull();
});
