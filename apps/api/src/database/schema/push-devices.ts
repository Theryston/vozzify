import { pushPlatformSchema } from '@vozzify/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';
import { users } from './users.js';

export const pushPlatform = pgEnum('push_platform', pushPlatformSchema.options);

export const pushTokenIndex = 'push_devices_active_token_unique';

export const pushDevices = pgTable(
  'push_devices',
  {
    id: id(),
    installationId: uuid().notNull().unique(),
    secretHash: text().notNull(),
    platform: pushPlatform().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text(),
    active: boolean().notNull(),
    revision: bigint({ mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [
    index().on(table.userId),
    uniqueIndex(pushTokenIndex)
      .on(table.platform, table.token)
      .where(sql`${table.active}`),
    check(
      'push_devices_active_has_token',
      sql`${table.active} = (${table.token} is not null)`,
    ),
  ],
);
