import { Injectable } from '@nestjs/common';
import type { FollowListPage } from '@vozzify/contracts';
import { avatarIdentityFields } from '../plans/subscription-membership.service.js';
import { UsersService } from '../users/users.service.js';
import {
  decodeFollowListCursor,
  encodeFollowListCursor,
} from './follow-list-cursor.js';
import {
  type FollowListPageRow,
  type FollowListSide,
  FollowListsRepository,
} from './follow-lists.repository.js';

/**
 * The followers, following and friends lists of a Profile, read by username.
 * Public: a visitor reads them like the banner. The users service answers
 * `NOT_FOUND` for an unknown username.
 */
@Injectable()
export class FollowListsService {
  constructor(
    private readonly lists: FollowListsRepository,
    private readonly users: UsersService,
  ) {}

  /** One cursor page of a list of the User behind `username`. */
  async listPage(
    side: FollowListSide,
    username: string,
    query: { cursor?: string; limit: number },
  ): Promise<FollowListPage> {
    const ownerId = await this.users.findIdByUsername(username);
    const after = query.cursor
      ? decodeFollowListCursor(query.cursor)
      : undefined;
    const rows = await this.lists.findPage(side, ownerId, {
      after: after && {
        followedAt: new Date(after.followedAt),
        id: after.followId,
      },
      limit: query.limit,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(toListUser),
      nextCursor:
        hasMore && last
          ? encodeFollowListCursor({
              followedAt: last.followedAt.toISOString(),
              followId: last.followId,
            })
          : null,
    };
  }
}

const toListUser = ({
  id,
  username,
  name,
  image,
  ...identity
}: FollowListPageRow) => ({
  id,
  username,
  name,
  image,
  ...avatarIdentityFields(identity),
});
