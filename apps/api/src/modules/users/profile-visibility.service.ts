import { Injectable, Logger } from '@nestjs/common';
import {
  type AvatarIdentity,
  cacheTags,
  type ProfileSection,
  type ProfileVisibility,
  profileSectionSchema,
  type UpdateProfileVisibilityBody,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { avatarIdentityFields } from '../plans/subscription-membership.service.js';
import {
  ProfileVisibilityRepository,
  type ProfileVisibilityRow,
  type ProfileVisibilityValues,
} from './profile-visibility.repository.js';

/** The stored flag of each section of a Profile. */
const SECTION_FLAG = {
  summary: 'showSummarySection',
  practiceHistory: 'showPracticeHistorySection',
  favorites: 'showFavoritesSection',
} as const satisfies Record<ProfileSection, keyof ProfileVisibilityRow>;

/** What the owner sees: every section, whatever its flag. */
const EVERY_SECTION: ProfileVisibility = {
  summary: true,
  practiceHistory: true,
  favorites: true,
};

/** A Profile as one viewer may read it: its User, and the sections shown to them. */
export type ProfileView = { userId: string; shown: ProfileVisibility };

export type SocialProfile = {
  username: string | null;
  shown: ProfileVisibility;
  appearance?: {
    name: string;
    image: string | null;
    avatarIdentity?: AvatarIdentity;
  };
};

const toVisibility = (row: ProfileVisibilityRow): ProfileVisibility => ({
  summary: row.showSummarySection,
  practiceHistory: row.showPracticeHistorySection,
  favorites: row.showFavoritesSection,
});

/** Only the flags the request names: an absent one keeps its stored value. */
const toValues = (
  changes: UpdateProfileVisibilityBody,
): ProfileVisibilityValues => {
  const values: ProfileVisibilityValues = {};
  for (const section of profileSectionSchema.options) {
    const visible = changes[section];
    if (visible !== undefined) {
      values[SECTION_FLAG[section]] = visible;
    }
  }
  return values;
};

const requireRow = (
  row: ProfileVisibilityRow | undefined,
): ProfileVisibilityRow => {
  if (!row) {
    throw new AppException('UNAUTHORIZED', 'User no longer exists');
  }
  return row;
};

/** Why something failed, looking through wrappers to their `cause`. */
const reasonOf = (error: unknown): string => {
  const cause = error instanceof Error ? error.cause : undefined;
  const failure = cause ?? error;
  return failure instanceof Error ? failure.message : String(failure);
};

/**
 * Which sections of a Profile visitors see. The owner always sees every
 * section; a visitor asking for a hidden one gets `NOT_FOUND`, and a counter
 * that belongs to a hidden section is withheld from the visitor's view of
 * another section.
 */
@Injectable()
export class ProfileVisibilityService {
  private readonly logger = new Logger(ProfileVisibilityService.name);

  constructor(
    private readonly repository: ProfileVisibilityRepository,
    private readonly webRevalidation: WebRevalidationService,
  ) {}

  /** The owner's flags. */
  async getVisibility(userId: string): Promise<ProfileVisibility> {
    return toVisibility(requireRow(await this.repository.findById(userId)));
  }

  /**
   * Saves the flags given (a partial update) and returns all of them. The
   * Profile banner and the Favorite songs section are cached under their
   * tags, so both are refreshed: a hidden section must not stay visible in a
   * cache.
   */
  async updateVisibility(
    userId: string,
    changes: UpdateProfileVisibilityBody,
  ): Promise<ProfileVisibility> {
    const values = toValues(changes);
    if (Object.keys(values).length === 0) {
      return this.getVisibility(userId);
    }
    const row = requireRow(await this.repository.update(userId, values));
    if (row.username !== null) {
      await this.revalidateSections(row.username);
    }
    return toVisibility(row);
  }

  /** The sections a visitor sees of the Profile (the same answer for everyone else). */
  async getShownSections(username: string): Promise<ProfileVisibility> {
    return (await this.viewOf(username, undefined)).shown;
  }

  /** Live section visibility for several public Profiles, keyed by User ID. */
  async getShownSectionsByUserIds(
    userIds: string[],
  ): Promise<Map<string, SocialProfile>> {
    const rows = await this.repository.findManyByIds(userIds);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          username: row.username,
          shown: toVisibility(row),
          ...(row.name === undefined
            ? {}
            : {
                appearance: {
                  name: row.name,
                  image: row.image ?? null,
                  ...avatarIdentityFields(row),
                },
              }),
        },
      ]),
    );
  }

  /**
   * The Profile as the viewer may read one section of it. Returns the User's
   * ID, which the section's reads need. An unknown username and a hidden
   * section are both `NOT_FOUND`.
   */
  async readSection(
    username: string,
    section: ProfileSection,
    viewerId: string | undefined,
  ): Promise<ProfileView> {
    const view = await this.viewOf(username, viewerId);
    if (!view.shown[section]) {
      throw new AppException('NOT_FOUND', 'Section not found');
    }
    return view;
  }

  /** The Profile's User and the sections shown to this viewer. */
  private async viewOf(
    username: string,
    viewerId: string | undefined,
  ): Promise<ProfileView> {
    const row = await this.repository.findByUsername(username.toLowerCase());
    if (!row) {
      throw new AppException('NOT_FOUND', 'User not found');
    }
    return {
      userId: row.id,
      shown: viewerId === row.id ? EVERY_SECTION : toVisibility(row),
    };
  }

  /** Best effort: the change is already saved, so a failed enqueue is only logged. */
  private async revalidateSections(username: string): Promise<void> {
    try {
      await this.webRevalidation.revalidate([
        cacheTags.userProfile(username),
        cacheTags.userFavorites(username),
      ]);
    } catch (error) {
      this.logger.warn(
        `Could not enqueue the Profile revalidation: ${reasonOf(error)}`,
      );
    }
  }
}
