import { Test } from '@nestjs/testing';
import type { SyncPushDeviceBody } from '@vozzify/contracts';
import { PushDevicesRepository } from './push-devices.repository.js';
import { PushDevicesService } from './push-devices.service.js';

const user = { id: 'from-session', emailVerified: true, username: 'ana' };
const session = { user, sessionId: 'active-session' };
const identity = {
  installationId: '2565ee17-1ef7-4b50-be40-536a19cb6a68',
  installationSecret: 'a'.repeat(64),
  platform: 'ios',
  revision: 1,
} as const;
const activation = {
  ...identity,
  active: true,
  token: 'provider-token',
} as const satisfies SyncPushDeviceBody;

describe('PushDevicesService', () => {
  const repository = { sync: vi.fn<PushDevicesRepository['sync']>() };
  let service: PushDevicesService;

  beforeEach(async () => {
    repository.sync.mockReset().mockResolvedValue('accepted');
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDevicesService,
        { provide: PushDevicesRepository, useValue: repository },
      ],
    }).compile();
    service = moduleRef.get(PushDevicesService);
  });

  it.each([
    [{ ...user, emailVerified: false }, 'FORBIDDEN'],
    [{ ...user, username: null }, 'USERNAME_REQUIRED'],
  ] as const)(
    'rejects ineligible activation before writing',
    async (current, code) => {
      await expect(
        service.sync({ ...session, user: current }, activation),
      ).rejects.toMatchObject({ code });
      expect(repository.sync).not.toHaveBeenCalled();
    },
  );

  it('persists an installation digest, provider token and the active session', async () => {
    await service.sync(session, activation);
    expect(repository.sync).toHaveBeenCalledExactlyOnceWith({
      installationId: identity.installationId,
      // SHA-256 of the installation proof; the content does not reach storage.
      secretHash:
        'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
      userId: session.user.id,
      sessionId: session.sessionId,
      platform: 'ios',
      revision: 1,
      token: 'provider-token',
    });
  });

  it('allows deactivation during onboarding and removes both token and session linkage', async () => {
    await service.sync(
      { ...session, user: { ...user, username: null } },
      {
        ...identity,
        active: false,
      },
    );
    expect(repository.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: session.user.id,
        sessionId: null,
        token: null,
      }),
    );
  });

  it.each([
    ['not-owned', 'FORBIDDEN'],
    ['token-in-use', 'CONFLICT'],
  ] as const)('translates a repository result of %s', async (result, code) => {
    repository.sync.mockResolvedValue(result);
    await expect(service.sync(session, activation)).rejects.toMatchObject({
      code,
    });
  });
});
