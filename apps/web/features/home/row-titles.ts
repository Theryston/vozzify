/**
 * The row titles this web can translate. The feed names a title by key, so a
 * key missing here (a row the web doesn't know yet) hides its row instead of
 * showing a raw key. Adding a row kind to the API means adding its key here
 * and to both locale files.
 */
export const HOME_ROW_TITLE_KEYS = [
  'home.rows.trendingToday',
  'home.rows.newTracks',
  'home.rows.mostSung',
  'home.rows.mostFavorited',
  'home.rows.top10Week',
  'home.rows.genres',
  'home.rows.popularGenre',
  'home.rows.featuredArtists',
  'home.rows.featuredAlbums',
  'home.rows.pinned',
  'home.rows.easyToStart',
  'home.rows.higherVoices',
  'home.rows.lowerVoices',
  'home.rows.continueSinging',
  'home.rows.singAgain',
  'home.rows.becauseYouSang',
  'home.rows.moreOfYourGenres',
  'home.rows.forYou',
  'home.rows.yourMostSungArtists',
  'home.rows.explore',
  'home.rows.withinYourVoice',
  'home.rows.challengeYourRange',
  'home.rows.dailyTarget',
  'home.rows.peopleWhoSingWhatYouSing',
  'home.rows.similarVoices',
] as const;

export type HomeRowTitleKey = (typeof HOME_ROW_TITLE_KEYS)[number];

const KNOWN_TITLE_KEYS: ReadonlySet<string> = new Set(HOME_ROW_TITLE_KEYS);

export const isHomeRowTitleKey = (key: string): key is HomeRowTitleKey =>
  KNOWN_TITLE_KEYS.has(key);
