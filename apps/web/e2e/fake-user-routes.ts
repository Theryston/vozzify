import {
  privateAttemptRoute,
  userAttemptsRoute,
} from './fake-user-attempts.ts';
import { userFavoritesRoute } from './fake-user-favorites.ts';
import { userProfileRoute } from './fake-user-profile.ts';
import { userVisibilityRoutes } from './fake-user-visibility.ts';

/**
 * The reads of a Profile: its banner, favorite songs and practice history,
 * plus the owner's session and the section visibility the reads honor.
 */
export const userRoutes = [
  userProfileRoute,
  userFavoritesRoute,
  userAttemptsRoute,
  privateAttemptRoute,
  ...userVisibilityRoutes,
];
