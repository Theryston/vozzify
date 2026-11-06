import { describe, expect, it } from 'vitest';

import { generalPagesSitemapXml } from './general-pages-sitemap-xml';

const origin = 'https://vozzify.com';

const urlBlocks = (xml: string): string[] =>
  [...xml.matchAll(/<url>(.*?)<\/url>/g)].map((match) => match[1] ?? '');

const locOf = (block: string): string =>
  block.match(/<loc>([^<]*)<\/loc>/)?.[1] ?? '';

describe('generalPagesSitemapXml', () => {
  it('lists public pages and the auth entry points once per locale', () => {
    const locs = urlBlocks(generalPagesSitemapXml(origin)).map(locOf);

    expect(locs).toEqual([
      `${origin}/en`,
      `${origin}/pt-BR`,
      `${origin}/en/terms`,
      `${origin}/pt-BR/terms`,
      `${origin}/en/plans`,
      `${origin}/pt-BR/plans`,
      `${origin}/en/notefinder`,
      `${origin}/pt-BR/notefinder`,
      `${origin}/en/sign-in`,
      `${origin}/pt-BR/sign-in`,
      `${origin}/en/sign-up`,
      `${origin}/pt-BR/sign-up`,
    ]);
  });

  it('points every URL at all translations plus x-default', () => {
    const blocks = urlBlocks(generalPagesSitemapXml(origin));

    for (const block of blocks) {
      expect(block).toContain('hreflang="en"');
      expect(block).toContain('hreflang="pt-BR"');
      expect(block).toContain('hreflang="x-default"');
    }
    const terms = blocks.find((block) => locOf(block) === `${origin}/en/terms`);
    expect(terms).toContain(`href="${origin}/en/terms"`);
    expect(terms).toContain(`href="${origin}/pt-BR/terms"`);
    expect(terms).toContain(`hreflang="x-default" href="${origin}/terms"`);
    const home = blocks.find((block) => locOf(block) === `${origin}/en`);
    expect(home).toContain(`hreflang="x-default" href="${origin}/"`);
  });

  it('gives each type its priority and changefreq, home highest and auth lowest', () => {
    const blockFor = (loc: string) =>
      urlBlocks(generalPagesSitemapXml(origin)).find(
        (block) => locOf(block) === loc,
      ) ?? '';

    expect(blockFor(`${origin}/en`)).toContain(
      '<changefreq>daily</changefreq><priority>1.0</priority>',
    );
    expect(blockFor(`${origin}/en/terms`)).toContain(
      '<changefreq>monthly</changefreq><priority>0.6</priority>',
    );
    expect(blockFor(`${origin}/en/sign-in`)).toContain(
      '<changefreq>monthly</changefreq><priority>0.3</priority>',
    );
  });

  it('carries a lastmod on every URL', () => {
    for (const block of urlBlocks(generalPagesSitemapXml(origin))) {
      expect(block).toMatch(
        /<lastmod>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/lastmod>/,
      );
    }
  });

  it('is a urlset document', () => {
    const xml = generalPagesSitemapXml(origin);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(xml.endsWith('</urlset>')).toBe(true);
  });
});
