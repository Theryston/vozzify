import {
  buildSitemapUrlset,
  type SitemapUrlEntry,
} from '@/lib/sitemap/sitemap-xml';

/**
 * Last change of the curated pages. They have no record to take it from, so
 * it is bumped by hand when one of their texts changes.
 */
const generalPagesUpdatedAt = '2026-11-06T00:00:00.000Z';

/**
 * The curated general pages. Sign-in and sign-up are listed on purpose:
 * auth entry points are indexable by decision, with the lowest priority.
 */
const generalPages: readonly SitemapUrlEntry[] = [
  { segments: [], updatedAt: generalPagesUpdatedAt, type: 'home' },
  {
    segments: ['terms'],
    updatedAt: generalPagesUpdatedAt,
    type: 'page',
  },
  {
    segments: ['plans'],
    updatedAt: generalPagesUpdatedAt,
    type: 'page',
  },
  {
    segments: ['notefinder'],
    updatedAt: generalPagesUpdatedAt,
    type: 'page',
  },
  {
    segments: ['sign-in'],
    updatedAt: generalPagesUpdatedAt,
    type: 'auth',
  },
  {
    segments: ['sign-up'],
    updatedAt: generalPagesUpdatedAt,
    type: 'auth',
  },
];

/** The general-pages shard, with absolute URLs for the requested origin. */
export function generalPagesSitemapXml(siteUrl: string): string {
  return buildSitemapUrlset(generalPages, siteUrl);
}
