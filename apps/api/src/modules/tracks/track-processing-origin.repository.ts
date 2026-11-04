import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { legacyProcessingOrigins } from '../../database/schema/legacy-recording-imports.js';

/** Only the attempt is exempt: a later User retry follows the ordinary rules. */
export const ordinaryProcessing = (processingId: AnyPgColumn) =>
  sql`not exists (select 1 from ${legacyProcessingOrigins} where ${legacyProcessingOrigins.id} = ${processingId})`;
