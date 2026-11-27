import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, lt } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  pushDeviceInstallations as installations,
  pushTokenIndex,
} from '../../database/schema/push-devices.js';
import { isUniqueViolation } from '../../database/unique-violation.js';

type PushDeviceWrite = Omit<
  typeof installations.$inferInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class PushDevicesRepository {
  constructor(private readonly transaction: TransactionHost<DatabaseAdapter>) {}

  async sync(
    device: PushDeviceWrite,
  ): Promise<'accepted' | 'not-owned' | 'token-in-use'> {
    const {
      sessionId,
      token,
      userId,
      revision,
      installationId,
      secretHash,
      platform,
    } = device;
    const ownsInstallation = and(
      eq(installations.secretHash, secretHash),
      eq(installations.platform, platform),
    );
    const db = this.transaction.tx;
    try {
      const [changed] = await db
        .insert(installations)
        .values(device)
        .onConflictDoUpdate({
          target: installations.installationId,
          set: { sessionId, token, userId, revision },
          setWhere: and(ownsInstallation, lt(installations.revision, revision)),
        })
        .returning({ id: installations.id });
      if (changed) return 'accepted';
    } catch (error) {
      if (isUniqueViolation(error, pushTokenIndex)) return 'token-in-use';
      throw new Error('Could not persist push device registration');
    }
    // A duplicate or superseded command succeeds without changing the row.
    // Check the proof even when the revision is stale.
    const [owned] = await db
      .select({ id: installations.id })
      .from(installations)
      .where(
        and(eq(installations.installationId, installationId), ownsInstallation),
      );
    return owned ? 'accepted' : 'not-owned';
  }
}
