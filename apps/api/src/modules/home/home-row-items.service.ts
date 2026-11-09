import { Injectable } from '@nestjs/common';
import type { HomeRowItemsPage } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { HomeFeedService } from './home-feed.service.js';
import {
  decodeHomeRowItemsCursor,
  encodeHomeRowItemsCursor,
} from './home-row-items-cursor.js';
import {
  PRIVATE_HOME_CACHE_CONTROL,
  PUBLIC_HOME_CACHE_CONTROL,
} from './home-rules.js';
import { HomeVisitService } from './home-visit.service.js';

@Injectable()
export class HomeRowItemsService {
  constructor(
    private readonly visits: HomeVisitService,
    private readonly feeds: HomeFeedService,
  ) {}

  async getPage(
    rowId: string,
    cursor: string,
    userId?: string,
  ): Promise<{ page: HomeRowItemsPage; cacheControl: string }> {
    const decoded = decodeHomeRowItemsCursor(cursor);
    const row = await this.visits.rowItemsVersion(
      decoded.version,
      decoded.rowId,
      userId,
      decoded.locale,
    );
    if (
      decoded.rowId !== rowId ||
      !row ||
      (row.layout !== 'standard' && row.layout !== 'vocal-range')
    ) {
      throw new AppException('NOT_FOUND', 'Home row is no longer served');
    }
    if (decoded.position >= row.items.length) {
      throw new AppException('NOT_FOUND', 'Home row page is no longer served');
    }
    const nextCursor = nextHomeRowItemsCursor(decoded, row.items.length);
    const cacheControl =
      userId === undefined
        ? PUBLIC_HOME_CACHE_CONTROL
        : PRIVATE_HOME_CACHE_CONTROL;
    if (row.layout === 'standard') {
      const pageRow = {
        ...row,
        items: row.items.slice(decoded.position, decoded.position + 12),
      };
      const [linkedRow] = await this.feeds.withArtistLinks([pageRow]);
      return {
        page: {
          rowId,
          layout: row.layout,
          items:
            linkedRow?.layout === 'standard' ? linkedRow.items : pageRow.items,
          nextCursor,
        },
        cacheControl,
      };
    }
    const pageRow = {
      ...row,
      items: row.items.slice(decoded.position, decoded.position + 12),
    };
    const [linkedRow] = await this.feeds.withArtistLinks([pageRow]);
    return {
      page: {
        rowId,
        layout: row.layout,
        items:
          linkedRow?.layout === 'vocal-range' ? linkedRow.items : pageRow.items,
        nextCursor,
      },
      cacheControl,
    };
  }
}

const nextHomeRowItemsCursor = (
  cursor: ReturnType<typeof decodeHomeRowItemsCursor>,
  totalItems: number,
): string | null => {
  const nextPosition = cursor.position + 12;
  return nextPosition < totalItems
    ? encodeHomeRowItemsCursor({ ...cursor, position: nextPosition })
    : null;
};
