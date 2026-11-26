import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  fireEvent,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import '../app/_layout';

const request = jest.spyOn(globalThis, 'fetch');
const recoveryEmail = 'recover@example.com';
const newPassword = 'New-password-123';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
  jest.spyOn(SecureStore, 'deleteItemAsync').mockResolvedValue(undefined);
});

afterEach(() => {
  request.mockReset();
  jest.useRealTimers();
});

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function press(role: 'button' | 'link', name: string) {
  await userEvent.press(await screen.findByRole(role, { name }));
}

async function fill(label: string, value: string) {
  await fireEvent.changeText(await screen.findByLabelText(label), value);
}

function expectRequest(index: number, path: string, values: object) {
  const [url, options] = request.mock.calls[index] ?? [];
  expect(String(url)).toMatch(new RegExp(`/v1/auth/${path}$`));
  expect(options?.method).toBe('POST');
  expect(JSON.parse(String(options?.body))).toEqual(values);
}

describe('mobile password recovery', () => {
  it('validates the email and opens the same reset screen for either account state', async () => {
    request.mockImplementation(async () => json({ success: true }));
    const router = await renderRouter('./app', { initialUrl: '/sign-in' });
    await press('link', 'Forgot your password?');
    await fill('Email', 'invalid');
    await press('button', 'Send reset code');
    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeOnTheScreen();
    expect(request).not.toHaveBeenCalled();

    for (const email of ['known@example.com', 'unknown@example.com']) {
      await fill('Email', email);
      await press('button', 'Send reset code');
      expect(await screen.findByText('Set a new password')).toBeOnTheScreen();
      expect(
        await screen.findByText(
          `If an account exists for ${email}, we sent it a six-digit code.`,
        ),
      ).toBeOnTheScreen();
      expect(router.getPathname()).toBe('/forgot-password/reset');
      await press('link', 'Use a different email');
    }

    expectRequest(0, 'email-otp/request-password-reset', {
      email: 'known@example.com',
    });
    expectRequest(1, 'email-otp/request-password-reset', {
      email: 'unknown@example.com',
    });
  });

  it('shows code and password feedback, rejects incorrect and expired codes, and resumes the original action after signing in', async () => {
    const user = {
      id: 'recovering-user',
      email: recoveryEmail,
      emailVerified: true,
      username: 'recovered',
    };
    request
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ code: 'INVALID_OTP' }, 400))
      .mockResolvedValueOnce(json({ code: 'OTP_EXPIRED' }, 400))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(
        json({ user }, 200, { 'set-auth-token': 'signed.session' }),
      );

    const router = await renderRouter('./app');
    await userEvent.press(await screen.findByTestId('open-components'));
    await userEvent.press(await screen.findByTestId('gallery-sign-in-overlay'));
    await press('link', 'Forgot your password?');
    await fill('Email', recoveryEmail);
    await press('button', 'Send reset code');

    await fill('Reset code', '123');
    await fill('New password', 'abcdef');
    expect(
      await screen.findByText('Password strength: Weak'),
    ).toBeOnTheScreen();
    await fill('New password', 'abc');
    await press('button', 'Reset password');
    expect(
      await screen.findByText('Enter the 6-digit code.'),
    ).toBeOnTheScreen();
    expect(
      await screen.findByText('Use between 6 and 128 characters.'),
    ).toBeOnTheScreen();
    expect(request).toHaveBeenCalledTimes(1);

    await fill('New password', newPassword);
    expect(
      await screen.findByText('Password strength: Strong'),
    ).toBeOnTheScreen();
    for (const message of [
      "That code isn't right. Check it and try again.",
      'This code has expired. Request a new one.',
    ]) {
      await fill('Reset code', '123456');
      await press('button', 'Reset password');
      expect(
        await screen.findByRole('alert', { name: message }),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Reset code')).toHaveProp('value', '');
    }

    await fill('Reset code', '654321');
    await press('button', 'Reset password');
    expect(
      await screen.findByText(
        'Password changed. Sign in with your new password.',
      ),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expectRequest(3, 'email-otp/reset-password', {
      email: recoveryEmail,
      otp: '654321',
      password: newPassword,
    });
    await fill('Email or Username', recoveryEmail);
    await fill('Password', newPassword);
    await press('button', 'Sign in');
    expect(await screen.findByText('A native overlay')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/components');
    expectRequest(4, 'sign-in/email', {
      email: recoveryEmail,
      password: newPassword,
    });
  });

  it('keeps the resend countdown for the normalized email across re-entry and restarts it after a resend', async () => {
    jest.useFakeTimers();
    request.mockImplementation(async () => json({ success: true }));
    const email = 'cooldown@example.com';
    await renderRouter('./app', { initialUrl: '/forgot-password' });

    await fill('Email', '  COOLDOWN@EXAMPLE.COM  ');
    await press('button', 'Send reset code');
    expect(await screen.findByTestId('resend-code')).toBeDisabled();
    await act(async () => jest.advanceTimersByTime(30_000));
    await press('link', 'Use a different email');
    await fill('Email', email);
    await press('button', 'Send reset code');
    expect(await screen.findByTestId('resend-code')).toBeDisabled();
    expect(
      screen.getByText(/Send a new code in 2[89]s|Send a new code in 30s/),
    ).toBeOnTheScreen();
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(30_000));
    await waitFor(() =>
      expect(screen.getByTestId('resend-code')).toBeEnabled(),
    );
    await press('button', 'Send a new code');
    expect(
      await screen.findByText('A new code was requested. Check your email.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('resend-code')).toBeDisabled();
    expectRequest(1, 'email-otp/request-password-reset', { email });
  });

  it('keeps recovery separate from verification and requests a Portuguese email', async () => {
    const email = 'verify-and-recover@example.com';
    request
      .mockResolvedValueOnce(
        json({ user: { id: 'unverified', email, emailVerified: false } }),
      )
      .mockResolvedValueOnce(json({ success: true }));

    await renderRouter('./app', { initialUrl: '/components' });
    await userEvent.press(await screen.findByTestId('language-pt-BR'));
    await userEvent.press(await screen.findByTestId('return-home'));
    await userEvent.press(await screen.findByTestId('open-sign-in'));
    await press('link', 'Criar conta');
    await fill('Nome', 'Ana');
    await fill('E-mail', email);
    await fill('Senha', 'abcdef');
    await press('button', 'Criar conta');
    expect(await screen.findByTestId('resend-code')).toBeDisabled();

    await press('link', 'Entrar');
    await press('link', 'Esqueceu sua senha?');
    await fill('E-mail', email);
    await press('button', 'Enviar código de redefinição');
    expect(await screen.findByText('Crie uma nova senha')).toBeOnTheScreen();
    expect(request).toHaveBeenCalledTimes(2);
    expectRequest(1, 'email-otp/request-password-reset', { email });
    expect(
      new Headers(request.mock.calls[1]?.[1]?.headers).get('accept-language'),
    ).toBe('pt-BR');
  });

  it.each(['', '&email=invalid'])(
    'lets a visitor request a code when the reset address is missing or invalid (%s)',
    async (emailParam) => {
      const router = await renderRouter('./app', {
        initialUrl: `/forgot-password/reset?redirectTo=https%3A%2F%2Fexample.com${emailParam}`,
      });
      expect(
        await screen.findByText('Request a reset code first'),
      ).toBeOnTheScreen();
      await press('link', 'Request a code');
      expect(await screen.findByText('Reset your password')).toBeOnTheScreen();
      await press('link', 'Sign in');
      expect(router.getPathname()).toBe('/sign-in');
      expect(request).not.toHaveBeenCalled();
    },
  );
});
