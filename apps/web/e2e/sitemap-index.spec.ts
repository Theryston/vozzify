import { expect, type Page, test } from '@playwright/test';

const localOrigin = 'http://localhost:3000';
// Listed in SITEMAP_EXTRA_HOSTS by e2e/web-server-env.ts. The site URL is
// the default (http://localhost:3000), so its origin is plain http.
const extraHost = 'vozzify.example';
const extraOrigin = `http://${extraHost}`;

// The fake API caps a listing page at two entries: the fake's Albums (6) and
// Artists (5) therefore span three files each, and its Users (2) one. Pages
// and Tracks list their first file only.
const contentSitemaps = [
  '/pages/sitemap/0.xml',
  '/tracks/sitemap/0.xml',
  '/albums/sitemap/0.xml',
  '/albums/sitemap/1.xml',
  '/albums/sitemap/2.xml',
  '/artists/sitemap/0.xml',
  '/artists/sitemap/1.xml',
  '/artists/sitemap/2.xml',
  '/users/sitemap/0.xml',
];

const sitemapNamespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';

type ParsedSitemap = {
  parseErrors: number;
  root: string | null;
  namespace: string | null;
  locs: string[];
};

/**
 * Parses the document with the browser's XML parser, the way a crawler's
 * would: a malformed file reports a parser error instead of passing a
 * string match. `locs` are the `<loc>` values in document order.
 */
const parseSitemap = (page: Page, xml: string): Promise<ParsedSitemap> =>
  page.evaluate(
    ({ source, namespace }) => {
      const doc = new DOMParser().parseFromString(source, 'application/xml');
      return {
        parseErrors: doc.getElementsByTagName('parsererror').length,
        root: doc.documentElement.localName,
        namespace: doc.documentElement.namespaceURI,
        locs: Array.from(
          doc.getElementsByTagNameNS(namespace, 'loc'),
          (element) => element.textContent ?? '',
        ),
      };
    },
    { source: xml, namespace: sitemapNamespace },
  );

test.describe('sitemap index', () => {
  test('lists every content sitemap file at the requesting host', async ({
    page,
    request,
  }) => {
    const response = await request.get('/sitemap.xml', { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/xml');
    expect(response.headers()['cache-control']).toContain('s-maxage=');
    expect(response.headers().vary).toContain('X-Forwarded-Host, Host');
    const parsed = await parseSitemap(page, await response.text());
    expect(parsed.parseErrors).toBe(0);
    expect(parsed.root).toBe('sitemapindex');
    expect(parsed.namespace).toBe(sitemapNamespace);
    expect(parsed.locs).toEqual(
      contentSitemaps.map((path) => `${localOrigin}${path}`),
    );
  });

  test('takes the host from the forwarded headers when it is a known domain', async ({
    page,
    request,
  }) => {
    const response = await request.get('/sitemap.xml', {
      headers: { 'x-forwarded-host': extraHost },
    });

    expect(response.status()).toBe(200);
    const parsed = await parseSitemap(page, await response.text());
    expect(parsed.parseErrors).toBe(0);
    expect(parsed.locs).toEqual(
      contentSitemaps.map((path) => `${extraOrigin}${path}`),
    );
  });

  test('answers with the site origin for a host it does not know', async ({
    page,
    request,
  }) => {
    const response = await request.get('/sitemap.xml', {
      headers: { 'x-forwarded-host': 'unknown.example' },
    });

    expect(response.status()).toBe(200);
    const parsed = await parseSitemap(page, await response.text());
    expect(parsed.locs).toEqual(
      contentSitemaps.map((path) => `${localOrigin}${path}`),
    );
  });
});

test.describe('general pages shard', () => {
  test('lists public pages and the auth pages in both locales with hreflang', async ({
    page,
    request,
  }) => {
    const response = await request.get('/pages/sitemap/0.xml', {
      headers: { 'x-forwarded-host': extraHost },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/xml');
    expect(response.headers().vary).toContain('X-Forwarded-Host, Host');
    const xml = await response.text();
    const parsed = await parseSitemap(page, xml);
    expect(parsed.parseErrors).toBe(0);
    expect(parsed.root).toBe('urlset');
    expect(parsed.locs).toEqual([
      `${extraOrigin}/en`,
      `${extraOrigin}/pt-BR`,
      `${extraOrigin}/en/terms`,
      `${extraOrigin}/pt-BR/terms`,
      `${extraOrigin}/en/plans`,
      `${extraOrigin}/pt-BR/plans`,
      `${extraOrigin}/en/notefinder`,
      `${extraOrigin}/pt-BR/notefinder`,
      `${extraOrigin}/en/sign-in`,
      `${extraOrigin}/pt-BR/sign-in`,
      `${extraOrigin}/en/sign-up`,
      `${extraOrigin}/pt-BR/sign-up`,
    ]);
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="pt-BR" href="${extraOrigin}/pt-BR/terms"/>`,
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="${extraOrigin}/terms"/>`,
    );
  });

  test('answers 404 past its only file', async ({ request }) => {
    expect((await request.get('/pages/sitemap/1.xml')).status()).toBe(404);
  });
});

test.describe('robots.txt', () => {
  test('references the index of the requesting host', async ({ request }) => {
    const response = await request.get('/robots.txt', { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    expect(response.headers().vary).toContain('X-Forwarded-Host, Host');
    expect(await response.text()).toContain(
      `Sitemap: ${localOrigin}/sitemap.xml`,
    );
  });
});

test.describe('crawler paths are not redirected to a locale', () => {
  for (const path of ['/sitemap.xml', '/pages/sitemap/0.xml', '/robots.txt']) {
    test(`${path} answers 200 for a visitor from Brazil`, async ({
      request,
    }) => {
      const response = await request.get(path, {
        headers: { 'cf-ipcountry': 'BR' },
        maxRedirects: 0,
      });

      expect(response.status()).toBe(200);
      expect(response.headers().location).toBeUndefined();
    });
  }
});
