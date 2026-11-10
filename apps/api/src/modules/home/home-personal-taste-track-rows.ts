import type { HomeRow, HomeRowTitle, HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { composeHomeRows } from './home-feed-composer.js';
import type { PersonalTaste } from './home-personal.js';
import type { PersonalTrackCandidate } from './home-personal.repository.js';
import { tasteMatch } from './home-personal-recommendations.js';
import { PERSONAL_DISCOVERY_ROW_MIN_ITEMS } from './home-rules.js';

export const artistKeyOf = (track: PersonalTrackCandidate): string =>
  track.artistCredit[0]?.mbid ?? track.artistCredit[0]?.name ?? track.id;

export const homeTrackOf = (track: PersonalTrackCandidate): HomeTrack => ({
  id: track.id,
  title: track.title,
  coverUrl: track.coverUrl,
  artistCredit: track.artistCredit.map((credit) => ({
    name: credit.name,
    joinPhrase: credit.joinPhrase,
    artistId: null,
  })),
  durationMs: track.durationMs,
  vocalRange:
    track.vocalRangeLowest === null || track.vocalRangeHighest === null
      ? null
      : { lowest: track.vocalRangeLowest, highest: track.vocalRangeHighest },
});

export const composeTasteTrackRow = (options: {
  id: string;
  title: HomeRowTitle;
  cards: PersonalTrackCandidate[];
  taste?: PersonalTaste;
  mastered: ReadonlySet<string>;
  used: ReadonlySet<string>;
  sourcePoolsByRow?: Record<string, HomeTrack[]>;
}): HomeRow | undefined => {
  const candidates = options.cards
    .filter(
      (card) => !options.mastered.has(card.id) && !options.used.has(card.id),
    )
    .map((card) => ({
      id: card.id,
      artistKey: artistKeyOf(card),
      artistKeys: homeArtistKeys(card.artistCredit, card.id),
      hasCover: card.coverUrl !== null,
      isCompleted: true,
      track: homeTrackOf(card),
      score: options.taste
        ? tasteMatch(card.genres, artistKeyOf(card), options.taste)
        : 0,
    }));
  candidates.sort((a, b) => b.score - a.score);
  if (options.sourcePoolsByRow)
    options.sourcePoolsByRow[options.id] = candidates.map(({ track }) => track);
  const [composed] = composeHomeRows(
    [
      {
        id: options.id,
        layout: 'standard' as const,
        title: options.title,
        items: candidates,
      },
    ],
    { minimumItems: { standard: PERSONAL_DISCOVERY_ROW_MIN_ITEMS } },
  );
  return composed
    ? {
        id: composed.id,
        layout: 'standard',
        title: composed.title ?? options.title,
        items: composed.items.map((card) => card.track),
      }
    : undefined;
};
