import type { Locale } from '@vozzify/contracts';
import { localeSchema } from '@vozzify/contracts';
import {
  decodeTupleCursor,
  encodeTupleCursor,
} from '../../common/cursor/tuple-cursor.js';
import { AppException } from '../../common/errors/app-exception.js';

export type HomeRowItemsCursor = {
  version: string;
  rowId: string;
  position: number;
  locale: Locale;
};

export const encodeHomeRowItemsCursor = (cursor: HomeRowItemsCursor): string =>
  encodeTupleCursor([
    cursor.version,
    `${cursor.locale}:${cursor.rowId}:${String(cursor.position)}`,
  ]);

export const decodeHomeRowItemsCursor = (
  cursor: string,
): HomeRowItemsCursor => {
  const invalid = () => new AppException('VALIDATION_FAILED', 'Invalid cursor');
  const [version, rowPosition] = decodeTupleCursor(cursor);
  const parts = rowPosition.split(':');
  if (parts.length !== 3) throw invalid();
  const [localeText, rowId, positionText] = parts;
  const position = Number(positionText);
  const locale = localeSchema.safeParse(localeText);
  if (
    !/^[0-9a-f]{16}$/.test(version) ||
    !locale.success ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(rowId ?? '') ||
    !Number.isSafeInteger(position) ||
    position < 1 ||
    String(position) !== positionText
  ) {
    throw invalid();
  }
  return { version, rowId: rowId ?? '', position, locale: locale.data };
};
