import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, lt } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  pushDevices,
  pushTokenIndex,
} from '../../database/schema/push-devices.js';
import { isUniqueViolation } from '../../database/unique-violation.js';

type PushDeviceWrite = Omit<
  typeof pushDevices.$inferInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class PushDevicesRepository {
  constructor(private readonly transaction: TransactionHost<DatabaseAdapter>) {}

  async sync(
    device: PushDeviceWrite,
  ): Promise<'accepted' | 'not-owned' | 'token-in-use'> {
    const {
      active,
      token,
      userId,
      revision,
      installationId,
      secretHash,
      platform,
    } = device;
    const ownsInstallation = and(
      eq(pushDevices.secretHash, secretHash),
      eq(pushDevices.platform, platform),
    );
    const db = this.transaction.tx;
    try {
      const [changed] = await db
        .insert(pushDevices)
        .values(device)
        .onConflictDoUpdate({
          target: pushDevices.installationId,
          set: { active, token, userId, revision },
          setWhere: and(ownsInstallation, lt(pushDevices.revision, revision)),
        })
        .returning({ id: pushDevices.id });
      if (changed) return 'accepted';
    } catch (error) {
      if (isUniqueViolation(error, pushTokenIndex)) return 'token-in-use';
      throw new Error('Could not persist push device registration');
    }
    // A duplicate or superseded command succeeds without changing the row.
    // Check the proof even when the revision is stale.
    const [owned] = await db
      .select({ id: pushDevices.id })
      .from(pushDevices)
      .where(
        and(eq(pushDevices.installationId, installationId), ownsInstallation),
      );
    return owned ? 'accepted' : 'not-owned';
  }
}
