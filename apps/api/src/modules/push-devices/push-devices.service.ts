import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { SyncPushDeviceBody } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import type { AuthUser } from '../auth/auth.js';
import { PushDevicesRepository } from './push-devices.repository.js';

@Injectable()
export class PushDevicesService {
  constructor(private readonly devices: PushDevicesRepository) {}

  async sync(user: AuthUser, body: SyncPushDeviceBody): Promise<void> {
    if (body.active && !user.emailVerified) {
      throw new AppException('FORBIDDEN', 'Email verification required');
    }
    if (body.active && !user.username) {
      throw new AppException('USERNAME_REQUIRED', 'Username required');
    }
    const { active, installationId, installationSecret, platform, revision } =
      body;
    const result = await this.devices.sync({
      installationId,
      secretHash: createHash('sha256').update(installationSecret).digest('hex'),
      platform,
      revision,
      userId: user.id,
      active,
      token: body.active ? body.token : null,
    });
    if (result === 'not-owned') {
      throw new AppException('FORBIDDEN', 'Invalid installation proof');
    }
    if (result === 'token-in-use') {
      throw new AppException(
        'CONFLICT',
        'Push token belongs to another installation',
      );
    }
  }
}
