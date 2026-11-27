import { randomBytes, randomUUID } from 'node:crypto';
import type { SyncPushDeviceBody } from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { sessions } from '../src/database/schema/auth.js';
import {
  pushDeviceInstallations,
  pushDevices,
} from '../src/database/schema/push-devices.js';
import { users } from '../src/database/schema/users.js';
import { useAuthSpec } from './utils/auth-spec.js';
import {
  createPasswordUser,
  DEFAULT_PASSWORD,
  type User,
} from './utils/factories.js';

function installation(platform: SyncPushDeviceBody['platform'] = 'ios') {
  return {
    installationId: randomUUID(),
    installationSecret: randomBytes(32).toString('hex'),
    platform,
  };
}

describe('PUT /v1/me/push-devices', () => {
  const spec = useAuthSpec();
  const client = () => request(spec.testApp.app.getHttpServer());
  const rows = () => spec.testApp.db.select().from(pushDevices);

  async function signIn(username?: null) {
    const user = await createPasswordUser(spec.testApp.db, {
      ...(username === null && { username }),
    });
    return signInUser(user);
  }

  async function signInUser(user: User) {
    const response = await client()
      .post('/v1/auth/sign-in/email')
      .set('x-vozzify-auth', 'native')
      .send({ email: user.email, password: DEFAULT_PASSWORD })
      .expect(200);
    const token: unknown = response.headers['set-auth-token'];
    expect(typeof token).toBe('string');
    return { id: user.id, authorization: `Bearer ${token}` };
  }

  function sync(authorization: string, body: SyncPushDeviceBody) {
    return client()
      .put('/v1/me/push-devices')
      .set('Authorization', authorization)
      .send(body);
  }

  it('requires an authenticated, eligible User for activation and validates the contract', async () => {
    const body = {
      ...installation(),
      active: true,
      token: 'token',
      revision: 1,
    } as const;
    await client().put('/v1/me/push-devices').send(body).expect(401);
    const incomplete = await signIn(null);
    await sync(incomplete.authorization, body)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('USERNAME_REQUIRED'));

    const signedIn = await signIn();
    await sync(signedIn.authorization, { ...body, token: ' ' }).expect(400);
    await spec.testApp.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, signedIn.id));
    await sync(signedIn.authorization, body).expect(403);
    expect(await rows()).toEqual([]);
  });

  it('persists one registration per installation, rotates its token and fences retries after revocation', async () => {
    const user = await signIn();
    const device = installation('android');
    const activation = {
      ...device,
      active: true,
      token: 'fcm-token',
      revision: 1,
    } as const;
    await Promise.all([
      sync(user.authorization, activation).expect(204),
      sync(user.authorization, activation).expect(204),
    ]);
    expect(await rows()).toEqual([
      expect.objectContaining({
        installationId: device.installationId,
        token: 'fcm-token',
        platform: 'android',
        userId: user.id,
        active: true,
      }),
    ]);
    const [saved] = await spec.testApp.db
      .select()
      .from(pushDeviceInstallations);
    expect(saved?.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved?.secretHash).not.toBe(device.installationSecret);

    await sync(user.authorization, {
      ...activation,
      token: 'rotated-fcm-token',
      revision: 2,
    }).expect(204);
    expect(await rows()).toEqual([
      expect.objectContaining({ token: 'rotated-fcm-token', active: true }),
    ]);
    const revocation = { ...device, active: false, revision: 3 } as const;
    await sync(user.authorization, revocation).expect(204);
    await sync(user.authorization, activation).expect(204);
    await sync(user.authorization, revocation).expect(204);
    expect(await rows()).toEqual([
      expect.objectContaining({ token: null, active: false, revision: 3 }),
    ]);
    await sync(user.authorization, {
      ...activation,
      token: 'token-after-grant',
      revision: 4,
    }).expect(204);
    expect(await rows()).toEqual([
      expect.objectContaining({ token: 'token-after-grant', active: true }),
    ]);
  });

  it('transfers only the proven installation and rejects unrelated writes or a colliding token', async () => {
    const first = await signIn();
    const second = await signIn();
    const sharedDevice = installation();
    const shared = {
      ...sharedDevice,
      active: true,
      token: 'shared-apns-token',
      revision: 1,
    } as const;
    const independent = {
      ...installation(),
      active: true,
      token: 'independent-apns-token',
      revision: 1,
    } as const;
    await sync(first.authorization, shared).expect(204);
    await sync(first.authorization, independent).expect(204);
    const secondDevice = {
      ...installation(),
      active: true,
      token: 'second-apns-token',
      revision: 1,
    } as const;
    await sync(second.authorization, secondDevice).expect(204);
    const wrongProof = {
      ...sharedDevice,
      installationSecret: independent.installationSecret,
      revision: 99,
    };
    await sync(second.authorization, { ...wrongProof, active: false }).expect(
      403,
    );
    await sync(first.authorization, {
      ...wrongProof,
      active: true,
      token: 'replacement',
    }).expect(403);
    await sync(second.authorization, {
      ...secondDevice,
      token: shared.token,
      revision: 2,
    }).expect(409);
    await sync(second.authorization, { ...shared, revision: 2 }).expect(204);
    await sync(first.authorization, shared).expect(204);
    expect(await rows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          installationId: shared.installationId,
          token: shared.token,
          userId: second.id,
          active: true,
        }),
        expect.objectContaining({
          installationId: independent.installationId,
          token: independent.token,
          userId: first.id,
          active: true,
        }),
        expect.objectContaining({
          installationId: secondDevice.installationId,
          token: secondDevice.token,
          userId: second.id,
          active: true,
        }),
      ]),
    );
    expect(await rows()).toHaveLength(3);
  });

  it('records a revocation received before the original activation, even during onboarding', async () => {
    const eligible = await signIn();
    const onboarding = await signIn(null);
    const device = installation();
    await sync(onboarding.authorization, {
      ...device,
      active: false,
      revision: 2,
    }).expect(204);
    await sync(eligible.authorization, {
      ...device,
      active: true,
      token: 'late-apns-token',
      revision: 1,
    }).expect(204);
    expect(await rows()).toEqual([
      expect.objectContaining({ token: null, active: false, revision: 2 }),
    ]);
  });

  it('moves an installation using the new session after the previous session expired', async () => {
    const previous = await signIn();
    const current = await signIn();
    const device = installation();
    const active = {
      ...device,
      active: true,
      token: 'ongoing-apns-token',
      revision: 1,
    } as const;
    await sync(previous.authorization, active).expect(204);
    await spec.testApp.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.userId, previous.id));

    await sync(previous.authorization, {
      ...device,
      active: false,
      revision: 2,
    }).expect(401);
    await sync(current.authorization, {
      ...device,
      active: false,
      revision: 2,
    }).expect(204);
    await sync(current.authorization, { ...active, revision: 3 }).expect(204);
    expect(await rows()).toEqual([
      expect.objectContaining({
        userId: current.id,
        active: true,
        token: active.token,
        revision: 3,
      }),
    ]);
  });

  it.each(['expired', 'revoked'] as const)(
    'deactivates a device with a %s session without a new login, preserving other devices',
    async (reason) => {
      const user = await createPasswordUser(spec.testApp.db);
      const first = await signInUser(user);
      const other = await signInUser(user);
      const firstDevice = {
        ...installation(),
        active: true,
        token: 'first-apns-token',
        revision: 1,
      } as const;
      const otherDevice = {
        ...installation(),
        active: true,
        token: 'other-apns-token',
        revision: 1,
      } as const;
      await sync(first.authorization, firstDevice).expect(204);
      await sync(other.authorization, otherDevice).expect(204);
      const [ownRegistration] = await spec.testApp.db
        .select({ sessionId: pushDeviceInstallations.sessionId })
        .from(pushDeviceInstallations)
        .where(
          eq(
            pushDeviceInstallations.installationId,
            firstDevice.installationId,
          ),
        );
      if (!ownRegistration?.sessionId)
        throw new Error('Missing registration session');

      if (reason === 'expired') {
        await spec.testApp.db
          .update(sessions)
          .set({ expiresAt: new Date(0) })
          .where(eq(sessions.id, ownRegistration.sessionId));
      } else {
        await client()
          .post('/v1/auth/sign-out')
          .set('Authorization', first.authorization)
          .expect(200);
      }

      expect(await rows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            installationId: firstDevice.installationId,
            active: false,
            token: null,
            revision: 1,
          }),
          expect.objectContaining({
            installationId: otherDevice.installationId,
            active: true,
            token: otherDevice.token,
          }),
        ]),
      );
      await sync(first.authorization, { ...firstDevice, revision: 2 }).expect(
        401,
      );
      await sync(other.authorization, {
        ...firstDevice,
        installationSecret: otherDevice.installationSecret,
        revision: 2,
      }).expect(403);
    },
  );
});
