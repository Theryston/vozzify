import { describe, expect, it } from 'vitest';
import { encodeTupleCursor } from '../../common/cursor/tuple-cursor.js';
import {
  decodeHomeRowItemsCursor,
  encodeHomeRowItemsCursor,
} from './home-row-items-cursor.js';

describe('Home Row item cursor', () => {
  it('round-trips the frozen visit, locale, Row and next position', () => {
    const cursor = {
      version: 'a1b2c3d4e5f60718',
      rowId: 'pin-row_123',
      position: 12,
      locale: 'pt-BR' as const,
    };

    expect(decodeHomeRowItemsCursor(encodeHomeRowItemsCursor(cursor))).toEqual(
      cursor,
    );
  });

  it.each(['', 'garbage', 'WyJub3QtYS12ZXJzaW9uIiwiYWJjIl0'])(
    'rejects malformed cursor %s',
    (cursor) => {
      expect(() => decodeHomeRowItemsCursor(cursor)).toThrow();
    },
  );

  it('rejects tuple payloads with fields after the position', () => {
    const cursor = encodeTupleCursor([
      'a1b2c3d4e5f60718',
      'en:pin-row:12:extra',
    ]);

    expect(() => decodeHomeRowItemsCursor(cursor)).toThrow();
  });
});
