import { LogoMark } from '@/components/logo-mark';
import type { ProfileOgCard } from './profile-og-card';

export function adminMark(label: string) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#09090b',
        color: 'white',
        borderRadius: 30,
        padding: '6px 16px',
        fontSize: 24,
      }}
    >
      <LogoMark width={26} height={26} style={{ color: 'white' }} />
      {label}
    </div>
  );
}

function sleeveArtwork(card: ProfileOgCard) {
  if (card.avatar) {
    return (
      // biome-ignore lint/performance/noImgElement: ImageResponse embeds the decoded Avatar directly in the PNG.
      <img
        alt=""
        src={card.avatar}
        width={214}
        height={178}
        style={{ objectFit: 'cover' }}
      />
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        width: 214,
        height: 178,
        background: '#fa4900',
        position: 'relative',
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 114,
        fontWeight: 800,
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -62,
          top: -84,
          width: 190,
          height: 190,
          border: '20px solid rgba(0,0,0,.13)',
          borderRadius: 100,
        }}
      />
      {card.initials}
    </div>
  );
}

export function studioSingleImage(
  card: ProfileOgCard,
  single: NonNullable<ProfileOgCard['single']>,
) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexShrink: 0,
        width: 374,
        height: 242,
        alignItems: 'center',
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: the SVG disc is embedded in the generated image. */}
      <img
        src={single.disc}
        width={232}
        height={232}
        alt=""
        style={{ position: 'absolute', top: 5, right: 0 }}
      />
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          top: 86,
          right: 0,
          width: 232,
          justifyContent: 'center',
          fontSize: 21,
          fontWeight: 800,
          color: '#131316',
        }}
      >
        {single.label}
      </div>
      {sleeve(card)}
      {/* The image renderer clips an inline SVG nested inside a rotated layer. */}
      <div
        style={{ display: 'flex', position: 'absolute', left: 210, top: 192 }}
      >
        <LogoMark width={20} height={22} style={{ color: '#fa4900' }} />
      </div>
    </div>
  );
}

function sleeve(card: ProfileOgCard) {
  return (
    <div
      style={{
        width: 232,
        height: 232,
        padding: 9,
        borderRadius: 8,
        background: '#fafafb',
        display: 'flex',
        flexDirection: 'column',
        transform: 'rotate(-5deg)',
      }}
    >
      {sleeveArtwork(card)}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 36,
          gap: 6,
          color: '#131316',
          fontWeight: 800,
          fontSize: 26,
        }}
      >
        <span
          style={{
            maxWidth: 183,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {card.name}
        </span>
      </div>
    </div>
  );
}
