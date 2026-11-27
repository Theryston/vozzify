import { PUSH_PLATFORMS } from '@vozzify/contracts';
import { and, eq, gt, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  pgView,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';
import { sessions } from './auth.js';
import { users } from './users.js';

export const pushPlatform = pgEnum('push_platform', PUSH_PLATFORMS);

export const pushTokenIndex = 'push_device_installations_session_token_unique';

export const pushDeviceInstallations = pgTable(
  'push_device_installations',
  {
    id: id(),
    installationId: uuid().notNull().unique(),
    secretHash: text().notNull(),
    platform: pushPlatform().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text().references(() => sessions.id, { onDelete: 'set null' }),
    token: text(),
    revision: bigint({ mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [
    index().on(table.userId),
    index().on(table.sessionId),
    uniqueIndex(pushTokenIndex)
      .on(table.platform, table.token)
      .where(sql`${table.sessionId} is not null`),
    check(
      'push_device_installations_session_has_token',
      sql`${table.sessionId} is null or ${table.token} is not null`,
    ),
  ],
);

// A revoked or expired session stops authorizing the registration immediately.
// Keep its installation proof and revision even when Better Auth deletes it.
export const pushDevices = pgView('push_devices').as((qb) => {
  const installation = pushDeviceInstallations;
  return qb
    .select({
      id: installation.id,
      installationId: installation.installationId,
      platform: installation.platform,
      userId: installation.userId,
      revision: installation.revision,
      active: sql<boolean>`${sessions.id} is not null`.as('active'),
      token: sql<
        string | null
      >`case when ${sessions.id} is not null then ${installation.token} end`.as(
        'token',
      ),
    })
    .from(installation)
    .leftJoin(
      sessions,
      and(
        eq(installation.sessionId, sessions.id),
        eq(installation.userId, sessions.userId),
        gt(sessions.expiresAt, sql`now()`),
      ),
    );
});
