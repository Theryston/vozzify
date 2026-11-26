import { generateKeyPairSync, sign } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { accounts } from '../src/database/schema/auth.js';
import { users } from '../src/database/schema/users.js';
import { takeOtpEmail } from './utils/auth.js';
import { useAuthSpec } from './utils/auth-spec.js';
import { createPasswordUser } from './utils/factories.js';

const issuer = 'https://accounts.google.com';
const iosClientId = 'fixture-ios.apps.googleusercontent.com';
const androidAudience = 'fixture-mobile.apps.googleusercontent.com';
const webClientId = 'fixture-web.apps.googleusercontent.com';
const keysUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const kid = 'test-signing-key';

const identity = {
  sub: 'google-subject',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  email_verified: true,
};

const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const unrelatedKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signGoogleToken(
  claims: Record<string, unknown> = {},
  privateKey = key.privateKey,
) {
  const now = Math.floor(Date.now() / 1000);
  const body = encoded({
    ...identity,
    iss: issuer,
    aud: androidAudience,
    iat: now,
    exp: now + 600,
    ...claims,
  });
  const jwt = `${encoded({ alg: 'RS256', kid })}.${body}`;
  return `${jwt}.${sign('RSA-SHA256', Buffer.from(jwt), privateKey).toString('base64url')}`;
}

function googleSignInBody(token: string) {
  return { provider: 'google', idToken: { token } };
}

beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== keysUrl) return realFetch(input, init);
    return Promise.resolve(
      Response.json({
        keys: [{ ...key.publicKey.export({ format: 'jwk' }), kid }],
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native Google authentication', () => {
  const spec = useAuthSpec({
    env: {
      GOOGLE_CLIENT_ID: webClientId,
      GOOGLE_CLIENT_SECRET: 'fixture-web-secret',
      GOOGLE_NATIVE_CLIENT_IDS: [androidAudience, iosClientId],
    },
  });

  const client = () => request(spec.testApp.app.getHttpServer());
  const submitIdToken = (token: string) =>
    client().post('/v1/auth/sign-in/social').send(googleSignInBody(token));
  const exchange = (token: string) =>
    submitIdToken(token).set('x-vozzify-auth', 'native');

  it('creates one verified User and restores the signed native session', async () => {
    const response = await exchange(signGoogleToken()).expect(200);
    expect(response.body.user).toMatchObject({
      email: identity.email,
      emailVerified: true,
      username: null,
    });
    const session: unknown = response.headers['set-auth-token'];
    expect(session).toEqual(expect.any(String));

    const me = await client()
      .get('/v1/me')
      .set('Authorization', `Bearer ${session}`)
      .expect(200);
    expect(me.body.id).toBe(response.body.user.id);
    await expect(
      spec.testApp.db
        .select()
        .from(accounts)
        .where(eq(accounts.accountId, identity.sub)),
    ).resolves.toEqual([
      expect.objectContaining({ providerId: 'google', userId: me.body.id }),
    ]);
  });

  it('links an existing verified account and signs in under the same subject', async () => {
    const user = await createPasswordUser(spec.testApp.db, {
      email: identity.email,
    });
    const first = await exchange(signGoogleToken({ aud: iosClientId })).expect(
      200,
    );
    expect(first.body.user).toMatchObject({
      id: user.id,
      username: user.username,
      emailVerified: true,
    });
    const returning = await exchange(
      signGoogleToken({ email: 'another-address@example.com' }),
    ).expect(200);
    expect(returning.body.user).toMatchObject({
      id: user.id,
      email: user.email,
    });
    await expect(spec.testApp.db.select().from(users)).resolves.toHaveLength(1);
  });

  it.each([
    ['another app’s audience', () => signGoogleToken({ aud: 'another-app' })],
    ['the web audience', () => signGoogleToken({ aud: webClientId })],
    ['the wrong issuer', () => signGoogleToken({ iss: 'https://example.com' })],
    ['an expired token', () => signGoogleToken({ exp: 1 })],
    [
      'an invalid email claim',
      () => signGoogleToken({ email_verified: 'false' }),
    ],
    ['a missing subject', () => signGoogleToken({ sub: undefined })],
    ['a forged signature', () => signGoogleToken({}, unrelatedKey.privateKey)],
  ])(
    'rejects %s without creating a User or session',
    async (_reason, token) => {
      const rejected = await exchange(token()).expect(401);
      expect(rejected.headers['set-auth-token']).toBeUndefined();
      await expect(spec.testApp.db.select().from(users)).resolves.toHaveLength(
        0,
      );
    },
  );

  it('sends an OTP when a new Google User has an unverified email', async () => {
    const pending = await exchange(
      signGoogleToken({ email_verified: false }),
    ).expect(200);
    expect(pending.body.user).toMatchObject({
      email: identity.email,
      emailVerified: false,
      username: null,
    });

    const { otp } = await takeOtpEmail(spec.testApp, identity.email);
    const verified = await client()
      .post('/v1/auth/email-otp/verify-email')
      .set('x-vozzify-auth', 'native')
      .send({ email: identity.email, otp })
      .expect(200);
    expect(verified.body.user).toMatchObject({
      id: pending.body.user.id,
      emailVerified: true,
      username: null,
    });
    expect(verified.headers['set-auth-token']).toEqual(expect.any(String));
  });

  it('refuses to link an unverified Google email to an existing User', async () => {
    await createPasswordUser(spec.testApp.db, { email: identity.email });
    const response = await exchange(
      signGoogleToken({ email_verified: false }),
    ).expect(401);
    expect(response.headers['set-auth-token']).toBeUndefined();
    await expect(
      spec.testApp.db
        .select()
        .from(accounts)
        .where(eq(accounts.providerId, 'google')),
    ).resolves.toEqual([]);
  });
});

describe('direct web Google authentication without mobile configuration', () => {
  const spec = useAuthSpec({
    env: {
      GOOGLE_CLIENT_ID: webClientId,
      GOOGLE_CLIENT_SECRET: 'fixture-web-secret',
      GOOGLE_NATIVE_CLIENT_IDS: undefined,
    },
  });

  const webSignIn = (claims: Record<string, unknown> = {}) =>
    spec.client
      .post('/v1/auth/sign-in/social')
      .send(googleSignInBody(signGoogleToken({ aud: webClientId, ...claims })));

  it('continues to accept authentic tokens for the existing web client ID', async () => {
    const response = await webSignIn().expect(200);
    expect(response.headers['set-auth-token']).toBeUndefined();
    const profile = await spec.client.get('/v1/me').expect(200);
    expect(profile.body).toMatchObject({ email: identity.email });
  });

  it('rejects a token for a different audience', async () => {
    await webSignIn({ aud: androidAudience }).expect(401);
    await expect(spec.testApp.db.select().from(users)).resolves.toHaveLength(0);
  });

  it('refuses to link an unverified Google email in the web exchange', async () => {
    await createPasswordUser(spec.testApp.db, { email: identity.email });
    await webSignIn({ email_verified: false }).expect(401);
    await expect(
      spec.testApp.db
        .select()
        .from(accounts)
        .where(eq(accounts.providerId, 'google')),
    ).resolves.toEqual([]);
  });

  it('requires a mobile audience configuration to issue a signed native bearer', async () => {
    await request(spec.testApp.app.getHttpServer())
      .post('/v1/auth/sign-in/social')
      .set('x-vozzify-auth', 'native')
      .send(googleSignInBody(signGoogleToken({ aud: webClientId })))
      .expect(401);
  });
});
