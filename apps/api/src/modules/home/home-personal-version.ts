import { createHash } from 'node:crypto';
import type { HomeRow, Locale } from '@vozzify/contracts';

/** Names a snapshot with its owner, locale and full row composition. */
export const personalHomeVersion = (
  userId: string,
  locale: Locale,
  algorithmVersion: number,
  rows: HomeRow[],
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        audience: 'personal',
        algorithmVersion,
        userId,
        locale,
        rows,
      }),
    )
    .digest('hex')
    .slice(0, 16);
