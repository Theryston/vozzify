import type { ReactElement } from 'react';
import type { ProfileChip } from '../profile-chips';
import type { ProfileOgCard } from './profile-og-card';
import { adminMark, studioSingleImage } from './profile-og-identity-image';

/** The preview's size, the Open Graph and Twitter card standard. */
export const PROFILE_OG_WIDTH = 1200;
export const PROFILE_OG_HEIGHT = 630;

/**
 * The card's colors. They must match the tokens they stand for: the card's
 * orange is `primary` in DESIGN.md and `apps/web/app/globals.css`
 * (`#FA4900`), and the text on it is `primary-foreground` (white). They are
 * written out here because the image renderer cannot read CSS variables, so a
 * change to the token has to be made here too.
 *
 * The typeface is the site's Figtree (`profile-og-fonts.ts`), so the card's
 * weights match the page's.
 */
const CARD_BACKGROUND = '#FA4900';
const CARD_TEXT = '#FFFFFF';

const AVATAR_SIZE = 300;

/**
 * The preview card (DESIGN.md "Featured blocks"): an orange block with the
 * Name and `@username` on the left, the chips under them, and the Avatar, or
 * the initials on white, on the right. Built by plain functions rather than
 * components because the image renderer takes the element tree as it is.
 */
export function profileOgImage(card: ProfileOgCard): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: CARD_BACKGROUND,
        color: CARD_TEXT,
        padding: '72px',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {decorationRing()}
      {textColumn(card)}
      {card.single ? studioSingleImage(card, card.single) : avatarElement(card)}
      {brandMark()}
    </div>
  );
}

/** The one oversized shape, white at 10% (DESIGN.md: the only decoration). */
function decorationRing(): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        right: '-140px',
        top: '-140px',
        width: '600px',
        height: '600px',
        borderRadius: '300px',
        border: '90px solid rgba(255, 255, 255, 0.1)',
      }}
    />
  );
}

function textColumn(card: ProfileOgCard): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        maxWidth: '700px',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: '76px',
          fontWeight: 800,
          lineHeight: 1.05,
        }}
      >
        {card.name}
      </div>
      <div style={{ display: 'flex', fontSize: '34px', fontWeight: 600 }}>
        {`@${card.username}`}
      </div>
      {card.adminLabel && adminMark(card.adminLabel)}
      {chipRow(card.chips)}
    </div>
  );
}

function chipRow(chips: ProfileChip[]): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        marginTop: '12px',
      }}
    >
      {chips.map((chip) => (
        <div
          key={chip.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            border: '2px solid rgba(255, 255, 255, 0.45)',
            borderRadius: '999px',
            padding: '8px 22px',
            fontSize: '24px',
          }}
        >
          <div style={{ display: 'flex', fontWeight: 700 }}>{chip.label}</div>
          <div style={{ display: 'flex', fontWeight: 700 }}>{chip.value}</div>
        </div>
      ))}
    </div>
  );
}

function brandMark(): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        left: '72px',
        bottom: '40px',
        fontSize: '26px',
        fontWeight: 800,
      }}
    >
      Vozzify
    </div>
  );
}

/**
 * The picture, decorative: the name sits next to it in the card. Without one,
 * the initials on white, as the banner draws them.
 */
function avatarElement(card: ProfileOgCard): ReactElement {
  const size = {
    width: `${AVATAR_SIZE}px`,
    height: `${AVATAR_SIZE}px`,
    borderRadius: `${AVATAR_SIZE / 2}px`,
  };
  if (card.avatar !== undefined) {
    return (
      // biome-ignore lint/performance/noImgElement: this tree is drawn to a PNG by the image renderer, where next/image does not run
      <img
        src={card.avatar}
        alt=""
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        style={{ ...size, objectFit: 'cover' }}
      />
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...size,
        background: CARD_TEXT,
        color: CARD_BACKGROUND,
        fontSize: '120px',
        fontWeight: 800,
      }}
    >
      {card.initials}
    </div>
  );
}
