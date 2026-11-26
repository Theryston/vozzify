import {
  type ProfileChip,
  type ProfileChipMessages,
  profileChips,
} from '../profile-chips';
import type { ProfileOgSource } from './profile-og-source';

/** What the preview image draws: already translated, already trimmed. */
export type ProfileOgCard = {
  name: string;
  username: string;
  initials: string;
  /** A `data:` URL of the Avatar, or undefined to draw the initials. */
  avatar: string | undefined;
  chips: ProfileChip[];
  adminLabel?: string;
  single?: { disc: string; label: string };
};

export type ProfileOgCardInput = {
  source: ProfileOgSource;
  identity?: Pick<ProfileOgCard, 'adminLabel' | 'single'>;
  messages: ProfileChipMessages;
  /** The Avatar as a `data:` URL, when there is one to draw. */
  avatar: string | undefined;
  /** The initials of the Name, drawn when there is no Avatar. */
  initials: string;
};

/**
 * Longer texts would run past the card: the image renderer does not wrap
 * inside a chip, so a long artist name would run under the Avatar.
 */
const MAX_NAME_CHARACTERS = 60;
const MAX_CHIP_VALUE_CHARACTERS = 32;

/**
 * The card for a Profile's banner. Pure: the image route supplies the
 * translated chip messages, the fetched Avatar and its initials.
 */
export function profileOgCard({
  source,
  messages,
  avatar,
  initials,
  identity,
}: ProfileOgCardInput): ProfileOgCard {
  return {
    name: truncateText(source.name, MAX_NAME_CHARACTERS),
    username: source.username,
    ...identity,
    initials,
    avatar,
    chips: profileChips(source, messages).map((chip) => ({
      ...chip,
      value: truncateText(chip.value, MAX_CHIP_VALUE_CHARACTERS),
    })),
  };
}

/**
 * Cuts `text` to `maxCharacters` by code point, ending with an ellipsis, so
 * an accent or an emoji is never split in half.
 */
export function truncateText(text: string, maxCharacters: number): string {
  const characters = [...text];
  if (characters.length <= maxCharacters) {
    return text;
  }
  return `${characters.slice(0, maxCharacters - 1).join('')}…`;
}
