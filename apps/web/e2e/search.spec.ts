import { expect, type Page, type Request, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import { messages as catalogs } from './messages';
import { mockSearchApi, searchParamsOf } from './search-api-mock';

const cases = [
  { locale: 'en', messages: catalogs.en },
  { locale: 'pt-BR', messages: catalogs['pt-BR'] },
] as const;

/** The header is hydrated once its account links render in the browser. */
const headerReady = (page: Page, signIn: string) =>
  expect(
    page.getByRole('banner').getByRole('link', { name: signIn }),
  ).toBeVisible();

const headerField = (page: Page, label: string) =>
  page.getByRole('banner').getByRole('combobox', { name: label });

function lastRequest(calls: Request[]): Request {
  const last = calls[calls.length - 1];
  if (!last) throw new Error('expected at least one search request');
  return last;
}

for (const { locale, messages } of cases) {
  test.describe(`search (${locale})`, () => {
    /**
     * Opens `url` with auth and search mocked and waits for the header,
     * returning the field, the starting URL and the search calls to assert
     * with. Every header test starts here, so the setup never clones.
     */
    async function openWithHeader(page: Page, url: string) {
      await mockAuthApi(page);
      const search = await mockSearchApi(page);
      await page.goto(url);
      await headerReady(page, messages.header.account.signIn);
      return {
        search,
        home: page.url(),
        header: headerField(page, messages.header.search.label),
      };
    }

    test('header typing stays on the page until Enter submits it', async ({
      page,
    }) => {
      const { search, home, header } = await openWithHeader(page, `/${locale}`);

      // No Enter: typing alone never navigates, debounced or not. It asks
      // only for the header suggestions.
      const suggestionsRequest = page.waitForRequest(
        (request) => searchParamsOf(request).query === 'queen',
      );
      await header.fill('queen');
      await suggestionsRequest;
      await expect(page).toHaveURL(home);
      expect(search.calls).toHaveLength(1);
      expect(searchParamsOf(lastRequest(search.calls))).toMatchObject({
        query: 'queen',
        limit: '20',
      });

      await header.press('Enter');
      await expect(page).toHaveURL(`/${locale}/search?q=queen`);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: messages.search.title,
        }),
      ).toBeVisible();
      // The header mirrors `q` (nuqs prefill) and results follow it.
      await expect(header).toHaveValue('queen');
      await expect(
        page.getByRole('main').getByText('Bohemian Rhapsody'),
      ).toBeVisible();
      // The search page asks for its own results: two requests in total, and
      // the full search makes an independent request after navigation.
      expect(search.calls).toHaveLength(2);
      const pageRequest = searchParamsOf(lastRequest(search.calls));
      expect(pageRequest).toMatchObject({ query: 'queen' });
      expect(pageRequest.offset).toBe('0');
    });

    test('header typing on a legacy lyrics link searches the metadata only', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const search = await mockSearchApi(page);
      await page.goto(`/${locale}/search?q=queen&scope=lyrics`);

      const header = headerField(page, messages.header.search.label);
      await expect(header).toHaveValue('queen');
      await header.fill('abba');

      await expect(page).toHaveURL(/q=abba/);
      await expect(header).toHaveValue('abba');
      const abba = [...search.calls]
        .reverse()
        .find((call) => searchParamsOf(call).query === 'abba');
      if (!abba) throw new Error('expected a search request for abba');
      expect(searchParamsOf(abba).scope).toBe('');

      // The existing shortcut still focuses the header search.
      await headerReady(page, messages.header.account.signIn);
      await page.keyboard.press('Control+k');
      await expect(header).toBeFocused();
    });

    test('typing updates the url in place without losing focus', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const search = await mockSearchApi(page);
      await page.goto(`/${locale}/search?q=q`);

      // The query field lives in the header now; the page keeps only the
      // title. A single character already searches.
      const header = headerField(page, messages.header.search.label);
      await expect(header).toHaveValue('q');
      await expect(
        page.getByRole('main').getByText('Bohemian Rhapsody'),
      ).toBeVisible();
      expect(searchParamsOf(lastRequest(search.calls))).toMatchObject({
        query: 'q',
      });

      await header.fill('queen');
      await expect(header).toBeFocused();
      await expect(page).toHaveURL(/q=queen/);
      await expect(
        page.getByRole('main').getByText('Bohemian Rhapsody'),
      ).toBeVisible();
      await expect(header).toBeFocused();
    });

    test('focusing the header field stays on the page', async ({ page }) => {
      const { home, header } = await openWithHeader(page, `/${locale}`);

      // No typing: focusing alone never navigates, keeping the focus.
      await header.focus();

      await page.waitForTimeout(500);
      await expect(page).toHaveURL(home);
      await expect(header).toBeFocused();
      // Empty: the search prompt is nowhere to be seen.
      await expect(
        page
          .getByRole('main')
          .getByRole('heading', { name: messages.search.prompt.title }),
      ).toHaveCount(0);
    });

    test('blurring an empty field stays on the page', async ({ page }) => {
      const { home, header } = await openWithHeader(page, `/${locale}`);

      await header.focus();
      await header.blur();

      // Nothing to go back to: the visitor stays where they were.
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(home);
    });

    test('leaving the search page clears the header field', async ({
      page,
    }) => {
      const { header } = await openWithHeader(
        page,
        `/${locale}/search?q=queen`,
      );
      await expect(header).toHaveValue('queen');

      // Any link off the page (here the brand) empties the field, so stale
      // text never reopens elsewhere.
      await page
        .getByRole('banner')
        .getByRole('link', { name: messages.header.home })
        .click();
      await expect(header).toHaveValue('');
      await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    });

    test('blurring keeps a search reached without a fall', async ({ page }) => {
      await mockAuthApi(page);
      await mockSearchApi(page);
      await page.goto(`/${locale}/search`);

      // No fall happened (direct load), so an empty blur stays put.
      const header = headerField(page, messages.header.search.label);
      await header.focus();
      await expect(page).toHaveURL(`/${locale}/search`);
      await page
        .getByRole('heading', { level: 1, name: messages.search.title })
        .click();
      await expect(page).toHaveURL(`/${locale}/search`);
    });

    test('back and forward keep mirroring q in the header field', async ({
      page,
    }) => {
      // Typing updates `q` in place (history replaces), so the round trip
      // below goes through a pushed page instead.
      const { header } = await openWithHeader(
        page,
        `/${locale}/search?q=queen`,
      );
      await expect(header).toHaveValue('queen');
      await page
        .getByRole('banner')
        .getByRole('link', { name: messages.header.home })
        .click();
      await expect(header).toHaveValue('');

      await page.goBack();
      await expect(page).toHaveURL(/\/search\?q=queen/);
      await expect(header).toHaveValue('queen');
      await page.goForward();
      await expect(header).toHaveValue('');
    });

    test('dims old results while the next query loads', async ({ page }) => {
      await mockAuthApi(page);
      await mockSearchApi(page, { delayMs: 800 });
      await page.goto(`/${locale}/search?q=queen`);

      const main = page.getByRole('main');
      await expect(main.getByText('Bohemian Rhapsody')).toBeVisible();

      const header = headerField(page, messages.header.search.label);
      await header.fill('queen live');

      // The field spins from the first keystroke through the fetch.
      const banner = page.getByRole('banner');
      await expect(banner.getByRole('status')).toBeVisible();
      // Known results stay on screen, dimmed and inert: no skeleton flash.
      const grid = main.locator('[aria-busy="true"]');
      await expect(grid).toBeVisible();
      await expect(grid).toHaveAttribute('data-stale', 'true');

      await expect(page).toHaveURL(/q=queen\+live/);
      await expect(grid).toHaveCount(0);
      await expect(banner.getByRole('status')).toHaveCount(0);
      await expect(main.getByText('Bohemian Rhapsody')).toBeVisible();
    });

    test('a legacy scope=lyrics link renders a normal metadata search, with no toggle', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const search = await mockSearchApi(page);
      await page.goto(`/${locale}/search?q=queen&scope=lyrics`);

      const main = page.getByRole('main');
      await expect(main.getByText('Bohemian Rhapsody')).toBeVisible();
      expect(searchParamsOf(lastRequest(search.calls))).toMatchObject({
        query: 'queen',
      });
      expect(searchParamsOf(lastRequest(search.calls)).scope).toBe('');
      // No toggle: the page renders no pressed scope button.
      await expect(main.locator('[aria-pressed]')).toHaveCount(0);
    });

    test('shows a skeleton while results load', async ({ page }) => {
      await mockAuthApi(page);
      await mockSearchApi(page, { delayMs: 1500 });
      await page.goto(`/${locale}/search?q=queen`);

      await expect(
        page.getByRole('status', { name: messages.search.loading }),
      ).toBeVisible();
      await expect(
        page.getByRole('main').getByText('Bohemian Rhapsody'),
      ).toBeVisible();
    });

    test('shows an empty state when nothing matches', async ({ page }) => {
      await mockAuthApi(page);
      await mockSearchApi(page, { emptyResults: true });
      await page.goto(`/${locale}/search?q=xyzabc`);

      const main = page.getByRole('main');
      await expect(
        main.getByRole('heading', { name: messages.search.empty.title }),
      ).toBeVisible();
      await expect(
        main.getByText(
          messages.search.empty.description.replace('{query}', 'xyzabc'),
        ),
      ).toBeVisible();
    });

    test('shows an error with retry when the catalog is down', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const search = await mockSearchApi(page, { shouldFail: true });
      await page.goto(`/${locale}/search?q=queen`);

      const main = page.getByRole('main');
      await expect(
        main.getByRole('heading', { name: messages.search.error.title }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        main.getByText(messages.search.error.description),
      ).toBeVisible();

      search.shouldFail = false;
      await main
        .getByRole('button', { name: messages.search.error.retry })
        .click();
      await expect(main.getByText('Bohemian Rhapsody')).toBeVisible();
    });

    test('links processed recordings and sends others to sign in first', async ({
      page,
    }) => {
      await mockAuthApi(page);
      await mockSearchApi(page);
      await page.goto(`/${locale}/search?q=queen`);

      const main = page.getByRole('main');
      const linked = main.getByRole('link', { name: /Bohemian Rhapsody/ });
      await expect(linked).toHaveAttribute(
        'href',
        /\/tracks\/clxlinkedtrack01/,
      );
      await linked.click();
      // The Track page itself ships later: what matters is that the card
      // navigates toward it.
      await expect(page).toHaveURL(/\/tracks\/clxlinkedtrack01/);

      await page.goBack();
      await expect(main.getByText('Unreleased Demo')).toBeVisible();
      // Signed out, a result without a Track is a link to sign in first (named
      // after the result), which returns to this search with the request marker.
      const signIn = main.getByRole('link', {
        name: messages.tracks.card.signInLabel.replace(
          '{title}',
          'Unreleased Demo',
        ),
      });
      await expect(signIn).toHaveAttribute(
        'href',
        `/${locale}/sign-in?redirectTo=${encodeURIComponent(
          '/search?q=queen&process=00000000-0000-4000-8000-000000000002',
        )}`,
      );
    });

    test('pages through more results', async ({ page }) => {
      await mockAuthApi(page);
      await mockSearchApi(page, { totalCount: 25 });
      await page.goto(`/${locale}/search?q=queen`);

      const main = page.getByRole('main');
      await expect(main.getByText('Song 20', { exact: true })).toBeVisible();
      await main.getByText('Song 20', { exact: true }).scrollIntoViewIfNeeded();
      await expect(main.getByText('Song 25', { exact: true })).toBeVisible();
    });
  });
}
