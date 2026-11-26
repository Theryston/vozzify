import request from 'supertest';
import { signUp, takeOtpEmail } from './utils/auth.js';
import { useAuthSpec } from './utils/auth-spec.js';
import { createPasswordUser, DEFAULT_PASSWORD } from './utils/factories.js';

describe('native session transport', () => {
  const spec = useAuthSpec();
  const nativeClient = () => request(spec.testApp.app.getHttpServer());

  it('verifies an emailed code and uses a signed session at the REST API', async () => {
    const email = 'native@example.com';
    await signUp(spec.client, {
      name: 'Native User',
      email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    const { otp } = await takeOtpEmail(spec.testApp, email);
    const verification = await nativeClient()
      .post('/v1/auth/email-otp/verify-email')
      .set('x-vozzify-auth', 'native')
      .send({ email, otp })
      .expect(200);
    const token: unknown = verification.headers['set-auth-token'];
    expect(typeof token).toBe('string');
    const authorization = `Bearer ${token}`;
    await nativeClient()
      .get('/v1/auth/get-session')
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) =>
        expect(body.user).toMatchObject({ email, emailVerified: true }),
      );
    await nativeClient()
      .put('/v1/me/username')
      .set('Authorization', authorization)
      .send({ username: 'native_user' })
      .expect(200);
    await nativeClient()
      .get('/v1/me')
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ email, username: 'native_user' }),
      );
    await nativeClient()
      .get('/v1/me')
      .set('Authorization', `Bearer ${verification.body.token}`)
      .expect(401);
  });

  it('exports a signed token only for the native credential exchange', async () => {
    const user = await createPasswordUser(spec.testApp.db);
    const credentials = { email: user.email, password: DEFAULT_PASSWORD };
    const signIn = () =>
      nativeClient().post('/v1/auth/sign-in/email').send(credentials);
    const browser = await signIn()
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(browser.headers['set-auth-token']).toBeUndefined();
    const browserWithMarker = await signIn()
      .set('Origin', 'http://localhost:3000')
      .set('x-vozzify-auth', 'native')
      .expect(200);
    expect(browserWithMarker.headers['set-auth-token']).toBeUndefined();
    const browserWithCookie = await signIn()
      .set('Cookie', 'preference=light')
      .set('Origin', 'http://localhost:3000')
      .set('x-vozzify-auth', 'native')
      .expect(200);
    expect(browserWithCookie.headers['set-auth-token']).toBeUndefined();
    const native = await signIn().set('x-vozzify-auth', 'native').expect(200);
    expect(native.headers['set-auth-token']).toEqual(expect.any(String));
  });
});
