import { Injectable, Optional } from '@nestjs/common';
import type { AvatarIdentity, FollowListPage } from '@vozzify/contracts';
import { UserAvatarIdentityService } from '../users/user-avatar-identity.service.js';
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
    @Optional() private readonly avatars?: UserAvatarIdentityService,
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
    const identities = await this.avatars?.findByUserIds(
      page.map(({ id }) => id),
    );
    return {
      items: page.map((row) => toListUser(row, identities?.get(row.id))),
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

const toListUser = (
  { id, username, name, image }: FollowListPageRow,
  avatarIdentity: AvatarIdentity | undefined,
) => ({
  id,
  username,
  name,
  image,
  ...(avatarIdentity && { avatarIdentity }),
});
