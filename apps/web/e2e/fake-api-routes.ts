import { serveFakeAdsenseCmp } from './fake-adsense-cmp.ts';
import { homeRoutes } from './fake-home-api.ts';
import { planRoutes } from './fake-plans-api.ts';
import { userRoutes } from './fake-user-routes.ts';

/**
 * The route tables the fake API serves beyond its artist, album and track
 * routes: each domain keeps its own table, the router spreads them all.
 */
export const extraFakeRoutes = [
  ...userRoutes,
  ...homeRoutes,
  ...planRoutes,
  { method: 'GET', pathname: '/__adsense-cmp.js', serve: serveFakeAdsenseCmp },
];
