import type { HomeHero, HomeTrack } from '@vozzify/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { entityRingClass } from '@/components/entity-header';
import { TrackCoverArt } from '@/features/tracks/components/track-cover-art';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';
import { SponsoredNotice } from '../components/sponsored-notice';
import { HERO_BLOCK_CLASS, HERO_COVER_SIZES } from '../layout-dimensions';
import { rowHeadingId } from '../row-heading-id';

const COVER_CLASS =
  'absolute top-6 right-6 aspect-square w-32 overflow-hidden rounded-2xl shadow-sm sm:rotate-3 md:top-1/2 md:right-10 md:w-56 md:-translate-y-1/2 lg:w-64';

const CTA_CLASS =
  'inline-flex items-center rounded-full bg-background px-5 py-2.5 font-semibold text-foreground text-sm shadow-xs transition-transform duration-200 ease-spring active:scale-[0.97] focus-visible:ring-3 focus-visible:ring-primary-foreground outline-none';

const ARTIST_LINK_CLASS =
  'rounded-sm outline-none underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-primary-foreground';

/** The credit, each name linked to its Artist page when it has one. */
function HeroArtistCredit({ credit }: { credit: HomeTrack['artistCredit'] }) {
  return (
    <>
      {credit.map((entry, index) => (
        // A credit is a fixed ordered list, and one name can appear twice.
        // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity.
        <Fragment key={index}>
          {entry.artistId == null ? (
            entry.name
          ) : (
            <Link
              href={`/artists/${entry.artistId}`}
              className={ARTIST_LINK_CLASS}
            >
              {entry.name}
            </Link>
          )}
          {entry.joinPhrase}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The feed's featured Track: one solid orange block with the cover at its
 * corner, the title in display type and one pill that opens the Track. The
 * sponsored notice, when set, is a caption above the title.
 */
export function HeroLayout({
  row,
  priority,
}: {
  row: HomeHero;
  priority: boolean;
}) {
  const t = useTranslations('home.hero');
  const locale = useLocale();
  const { track } = row;
  const headingId = rowHeadingId(row.id);
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'relative isolate flex items-end overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground md:p-10',
        HERO_BLOCK_CLASS,
        entityRingClass,
      )}
    >
      <div aria-hidden="true" className={COVER_CLASS}>
        <TrackCoverArt
          coverArtUrl={track.coverUrl}
          placeholderSeed={track.id}
          sizes={HERO_COVER_SIZES}
          priority={priority}
        />
      </div>
      <div className="wrap-anywhere relative flex w-full min-w-0 max-w-md flex-col items-start gap-3 pt-36 md:max-w-[calc(100%-16rem)] md:pt-0 lg:max-w-md">
        {row.sponsored ? <SponsoredNotice placement="caption" /> : null}
        <h2
          id={headingId}
          className="font-extrabold text-3xl tracking-tighter sm:text-4xl md:text-5xl"
        >
          {track.title}
        </h2>
        <p className="font-semibold text-sm">
          <HeroArtistCredit credit={track.artistCredit} />
        </p>
        <a
          href={`/${locale}/tracks/${track.id}`}
          className={CTA_CLASS}
          data-home-item-id={track.id}
        >
          {t('sing')}
        </a>
      </div>
    </section>
  );
}
