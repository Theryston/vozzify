import { expect, type Locator, type Page, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import {
  type Hit,
  lastOf,
  mockSuggestions,
  PNG,
  RANKED,
  registerTrack,
} from './header-suggestions-fixtures';
import { messages as catalogs } from './messages';
import { searchParamsOf } from './search-api-mock';

const localeCatalogs = (['en', 'pt-BR'] as const).map((locale) => ({
  locale,
  messages: catalogs[locale],
}));

for (const { locale, messages } of localeCatalogs) {
  const suggestions = messages.header.search.suggestions;
  const searchForLabel = (query: string) =>
    suggestions.searchFor.replace('{query}', query);

  /** The header field and its locator helpers, shared by every test below. */
  const header = (page: Page) =>
    page
      .getByRole('banner')
      .getByRole('combobox', { name: messages.header.search.label });
  const list = (page: Page) =>
    page.getByRole('listbox', { name: suggestions.label });
  const rowLink = (page: Page, name: string | RegExp) =>
    list(page).getByRole('option', { name });
  const spinner = (page: Page) =>
    page
      .getByRole('banner')
      .getByRole('status', { name: messages.header.search.loading });

  /** Opens `path` with auth and suggestions mocked, once the header is up. */
  async function open(page: Page, path: string, hits?: Hit[]) {
    await mockAuthApi(page);
    const calls = await mockSuggestions(page, hits);
    await page.goto(path);
    await expect(
      page
        .getByRole('banner')
        .getByRole('link', { name: messages.header.account.signIn }),
    ).toBeVisible();
    return { calls, home: page.url() };
  }

  /** Types `query`, waits for the list, then leaves the field. */
  async function typeThenBlur(page: Page, query: string) {
    await header(page).fill(query);
    await expect(list(page)).toBeVisible();
    await header(page).blur();
    await expect(list(page)).toHaveCount(0);
  }

  test.describe(`header suggestions (${locale})`, () => {
    test('lists the Recordings in the order the catalog ranks them', async ({
      page,
    }) => {
      const { home } = await open(page, `/${locale}`);

      await header(page).fill('queen');
      const rows = list(page).getByRole('option');
      await expect(rows).toHaveCount(21);
      for (const [index, hit] of RANKED.slice(0, 20).entries()) {
        await expect(rows.nth(index)).toContainText(hit.title);
        await expect(rows.nth(index)).toContainText(hit.artist);
      }
      await expect(rows.last()).toContainText(searchForLabel('queen'));
      await expect(page).toHaveURL(home);
    });

    test('asks for twenty suggestions and caps the panel at twenty Recordings', async ({
      page,
    }) => {
      const { calls } = await open(page, `/${locale}`);

      await header(page).fill('queen');
      await expect(rowLink(page, /Radio Ga Ga/)).toBeVisible();
      expect(searchParamsOf(lastOf(calls))).toMatchObject({
        query: 'queen',
        limit: '20',
      });
      // Twenty Recordings plus the Search-for row; the fixture has 25 hits.
      await expect(list(page).getByRole('option')).toHaveCount(21);
      await expect(rowLink(page, /Search result 25/)).toHaveCount(0);
    });

    test('keeps all matches when fewer than twenty are available', async ({
      page,
    }) => {
      await open(page, `/${locale}`, RANKED.slice(0, 2));

      await header(page).fill('queen');
      const rows = list(page).getByRole('option');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText('Under Pressure');
      await expect(rows.nth(1)).toContainText('Radio Ga Ga');
      await expect(rows.last()).toContainText(searchForLabel('queen'));
    });

    test('scrolls to and opens a late suggestion with the keyboard', async ({
      page,
    }) => {
      await registerTrack('late-result-track');
      await open(page, `/${locale}`);
      const field = header(page);
      await field.fill('queen');
      const lateResult = rowLink(page, /Search result 20/);
      await expect(lateResult).toBeVisible();
      await expect(list(page).getByRole('option')).toHaveCount(21);

      for (let index = 0; index < 20; index += 1) {
        await field.press('ArrowDown');
      }
      await expect(lateResult).toHaveAttribute('aria-selected', 'true');
      const panel = lateResult.locator(
        'xpath=ancestor::*[@data-slot="popover-content"]',
      );
      const scroll = await panel.evaluate((element) => ({
        top: element.scrollTop,
        panelTop: element.getBoundingClientRect().top,
        rowTop: element
          .querySelector('[data-highlighted]')
          ?.getBoundingClientRect().top,
        bottom: element.getBoundingClientRect().bottom,
        rowBottom: element
          .querySelector('[data-highlighted]')
          ?.getBoundingClientRect().bottom,
      }));
      expect(scroll.top).toBeGreaterThan(0);
      expect(scroll.rowTop).toBeGreaterThanOrEqual(scroll.panelTop);
      expect(scroll.rowBottom).toBeLessThanOrEqual(scroll.bottom);

      await field.press('Enter');
      await expect(page).toHaveURL(/\/tracks\/late-result-track/);
    });

    test('shows the cover art, or the placeholder, at the design size', async ({
      page,
    }) => {
      await page.route('**/_next/image**', (route) =>
        route.fulfill({ contentType: 'image/png', body: PNG }),
      );
      await open(page, `/${locale}`);

      await header(page).fill('queen');
      const rows = list(page).getByRole('option');
      const art = rows.nth(0).locator('img');
      await expect(art).toHaveCount(1);
      await expect(art).toHaveJSProperty('naturalWidth', 1);
      await expect(rows.nth(1).locator('img')).toHaveCount(0);

      // The list opens with a 200ms zoom, which scales the covers too: measure
      // once that animation has finished, or the box can be a fraction off.
      await expect
        .poll(() =>
          list(page).evaluate(
            (element) =>
              element.closest('[data-slot="popover-content"]')?.getAnimations()
                .length ?? 0,
          ),
        )
        .toBe(0);

      // 48px covers, rows at least 56px tall, the 150ms colour transition.
      const cover = await art.boundingBox();
      expect(cover?.width).toBe(48);
      expect(cover?.height).toBe(48);
      for (let index = 0; index < 20; index += 1) {
        const row = await rows.nth(index).boundingBox();
        expect(row?.height ?? 0).toBeGreaterThanOrEqual(56);
      }
      await expect(rowLink(page, /Radio Ga Ga/)).toHaveCSS(
        'transition-duration',
        '0.15s',
      );
    });

    test('a suggestion with a Track opens its Track page and clears the field', async ({
      page,
    }) => {
      await registerTrack('seedtrack02');
      await open(page, `/${locale}`);

      await header(page).fill('bohemian');
      await rowLink(page, /Radio Ga Ga/).click();
      await expect(page).toHaveURL(/\/tracks\/seedtrack02/);
      // The field lets go of the query, so the next page does not reopen it.
      await expect(header(page)).toHaveValue('');
      await header(page).focus();
      await expect(list(page)).toHaveCount(0);
    });

    test('the Search-for row goes to the full search with the query normalized', async ({
      page,
    }) => {
      await open(page, `/${locale}`);

      await header(page).fill('  under   pressure ');
      await rowLink(page, searchForLabel('under pressure')).click();
      await expect(page).toHaveURL(`/${locale}/search?q=under+pressure`);
      await expect(header(page)).toHaveValue('under pressure');
    });

    test('the Search-for row stays for an empty match', async ({ page }) => {
      await open(page, `/${locale}`, []);

      await header(page).fill('xyzabc');
      await expect(list(page).getByText(suggestions.noSongs)).toBeVisible();
      await expect(rowLink(page, searchForLabel('xyzabc'))).toBeVisible();
    });

    test('the list stays off on the search page', async ({ page }) => {
      await mockAuthApi(page);
      await mockSuggestions(page);
      await page.goto(`/${locale}/search`);

      await header(page).fill('queen');
      await expect(page).toHaveURL(/q=queen/);
      await expect(list(page)).toHaveCount(0);
    });

    test('blurring closes the list without navigating', async ({ page }) => {
      const { home } = await open(page, `/${locale}`);

      await typeThenBlur(page, 'queen');
      await expect(page).toHaveURL(home);
    });

    test('a click outside closes the list without navigating', async ({
      page,
    }) => {
      const { home } = await open(page, `/${locale}`);

      await header(page).fill('queen');
      await expect(list(page)).toBeVisible();
      await page.mouse.click(5, 600);
      await expect(list(page)).toHaveCount(0);
      await expect(page).toHaveURL(home);
    });

    test('clicking the field with text reopens the cached suggestions', async ({
      page,
    }) => {
      const { calls } = await open(page, `/${locale}`);

      await typeThenBlur(page, 'queen');
      const requests = calls.length;
      await header(page).click();
      await expect(list(page).getByRole('option').first()).toBeVisible();
      expect(calls).toHaveLength(requests);
    });

    test('the hotkey reopens the cached suggestions', async ({ page }) => {
      const { calls } = await open(page, `/${locale}`);

      await typeThenBlur(page, 'queen');
      const requests = calls.length;
      await page.keyboard.press('Control+k');
      await expect(header(page)).toBeFocused();
      await expect(list(page).getByRole('option').first()).toBeVisible();
      expect(calls).toHaveLength(requests);
    });

    test('the spinner shows from the first keystroke, not only during the fetch', async ({
      page,
    }) => {
      await open(page, `/${locale}`);

      await header(page).press('q');
      // Well before the debounce ends and the fetch runs: the field spins.
      await expect(spinner(page)).toBeVisible({ timeout: 150 });
      await expect(spinner(page)).toHaveCount(0);
    });

    test('a blank field never spins', async ({ page }) => {
      await open(page, `/${locale}`);

      await header(page).fill('queen');
      await expect(spinner(page)).toHaveCount(0);
      await header(page).fill('');
      await expect(spinner(page)).toHaveCount(0);
    });
  });

  test.describe(`header suggestions on touch (${locale})`, () => {
    test.use({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });

    /** On a phone the field opens from the search button, then takes text. */
    async function openOnPhone(page: Page): Promise<Locator> {
      await open(page, `/${locale}`);
      await page
        .getByRole('banner')
        .getByRole('button', { name: messages.header.search.open })
        .tap();
      await expect(header(page)).toBeFocused();
      return header(page);
    }

    test('tapping a Recording opens its Track page', async ({ page }) => {
      await registerTrack('seedtrack02');
      const field = await openOnPhone(page);

      await field.fill('queen');
      await rowLink(page, /Radio Ga Ga/).tap();
      await expect(page).toHaveURL(/\/tracks\/seedtrack02/);
    });

    test('tapping the Search-for row goes to the full search', async ({
      page,
    }) => {
      const field = await openOnPhone(page);

      await field.fill('queen');
      await rowLink(page, searchForLabel('queen')).tap();
      await expect(page).toHaveURL(`/${locale}/search?q=queen`);
    });

    /** Opens the phone field and types a query that shows the list. */
    async function typedOnPhone(page: Page) {
      const field = await openOnPhone(page);
      const home = page.url();
      await field.fill('queen');
      await expect(list(page)).toBeVisible();
      return { field, home };
    }

    test('the first Escape closes the list and the second collapses the field', async ({
      page,
    }) => {
      const { field, home } = await typedOnPhone(page);

      await field.press('Escape');
      await expect(list(page)).toHaveCount(0);
      await expect(field).toBeFocused();
      await expect(field).toHaveValue('queen');
      await field.press('Escape');
      await expect(field).toBeHidden();
      await expect(page).toHaveURL(home);
    });

    test('Cancel collapses the field and closes the list without navigating', async ({
      page,
    }) => {
      const { field, home } = await typedOnPhone(page);

      await page
        .getByRole('banner')
        .getByRole('button', { name: messages.header.search.cancel })
        .tap();
      await expect(field).toBeHidden();
      await expect(list(page)).toHaveCount(0);
      await expect(page).toHaveURL(home);
    });

    test('arrows and Enter open the highlighted Track on a phone', async ({
      page,
    }) => {
      await registerTrack('seedtrack02');
      const { field } = await typedOnPhone(page);

      await field.press('ArrowDown');
      await field.press('ArrowDown');
      await expect(list(page).locator('[data-highlighted]')).toContainText(
        'Radio Ga Ga',
      );
      await field.press('Enter');
      await expect(page).toHaveURL(/\/tracks\/seedtrack02/);
    });

    test('Enter with nothing highlighted goes to the full search on a phone', async ({
      page,
    }) => {
      const { field } = await typedOnPhone(page);

      await field.press('Enter');
      await expect(page).toHaveURL(`/${locale}/search?q=queen`);
    });

    test('Enter on a blank phone field does nothing', async ({ page }) => {
      const field = await openOnPhone(page);
      const home = page.url();

      await field.press('Enter');
      await expect(page).toHaveURL(home);
      await expect(list(page)).toHaveCount(0);
    });

    test('the phone field and list expose the same combobox roles', async ({
      page,
    }) => {
      const { field } = await typedOnPhone(page);
      const radio = rowLink(page, /Radio Ga Ga/);

      await expect(field).toHaveAttribute('aria-expanded', 'true');
      await expect(field).toHaveAttribute(
        'aria-controls',
        'header-suggestions-listbox',
      );
      await expect(list(page)).toHaveAttribute(
        'id',
        'header-suggestions-listbox',
      );
      await expect(list(page).getByRole('option')).toHaveCount(7);
      await expect(radio).toBeVisible();
      await field.press('ArrowDown');
      await field.press('ArrowDown');
      await expect(radio).toHaveAttribute('aria-selected', 'true');
      await expect(field).toHaveAttribute(
        'aria-activedescendant',
        (await radio.getAttribute('id')) ?? '',
      );

      await field.press('Escape');
      await expect(list(page)).toHaveCount(0);
      await expect(field).toHaveAttribute('aria-expanded', 'false');
      await expect(field).not.toHaveAttribute('aria-activedescendant');
    });
  });

  test.describe(`header suggestion keyboard (${locale})`, () => {
    /** The one row the keyboard highlights, Search-for row included. */
    const highlightedRow = (page: Page) =>
      list(page).locator('[data-highlighted]');

    /** Opens the header and types a query, once its first row is rendered. */
    // Arrows before the answer lands would be reset by it, so wait for rows.
    const typedWithRows = async (page: Page) => {
      const opened = await open(page, `/${locale}`);
      await header(page).fill('queen');
      await expect(rowLink(page, /Radio Ga Ga/)).toBeVisible();
      return opened;
    };

    test('arrows move the highlight, and Enter opens the highlighted Track', async ({
      page,
    }) => {
      await registerTrack('seedtrack02');
      await typedWithRows(page);
      await header(page).press('ArrowDown');
      await header(page).press('ArrowDown');
      await expect(highlightedRow(page)).toContainText('Radio Ga Ga');
      await header(page).press('Enter');
      await expect(page).toHaveURL(/\/tracks\/seedtrack02/);
    });

    test('ArrowUp from nothing highlights the Search-for row, and ArrowDown wraps back to the first row', async ({
      page,
    }) => {
      await typedWithRows(page);
      await header(page).press('ArrowUp');
      await expect(highlightedRow(page)).toContainText(searchForLabel('queen'));
      await header(page).press('ArrowDown');
      await expect(highlightedRow(page)).toContainText('Under Pressure');
    });

    test('Enter on the highlighted Search-for row goes to the full search', async ({
      page,
    }) => {
      await open(page, `/${locale}`);

      await header(page).fill('queen');
      await header(page).press('ArrowUp');
      await header(page).press('Enter');
      await expect(page).toHaveURL(`/${locale}/search?q=queen`);
    });

    test('Enter with nothing highlighted goes to the full search', async ({
      page,
    }) => {
      await open(page, `/${locale}`);

      await header(page).fill('  queen ');
      await header(page).press('Enter');
      await expect(page).toHaveURL(`/${locale}/search?q=queen`);
      await expect(header(page)).toHaveValue('queen');
    });

    test('Enter on a blank field does nothing', async ({ page }) => {
      const { home } = await open(page, `/${locale}`);

      await header(page).focus();
      await header(page).press('Enter');
      await expect(page).toHaveURL(home);
      await expect(list(page)).toHaveCount(0);
    });

    test('the first Escape closes the list, keeps the focus and the text', async ({
      page,
    }) => {
      const { home } = await typedWithRows(page);
      await header(page).press('ArrowDown');
      await expect(highlightedRow(page)).toHaveCount(1);
      await header(page).press('Escape');
      await expect(list(page)).toHaveCount(0);
      await expect(header(page)).toBeFocused();
      await expect(header(page)).toHaveValue('queen');
      await expect(page).toHaveURL(home);
    });

    test('the arrows do nothing on a closed list', async ({ page }) => {
      const { home } = await open(page, `/${locale}`);

      await header(page).focus();
      await header(page).press('ArrowDown');
      await header(page).press('ArrowUp');
      await expect(list(page)).toHaveCount(0);
      await expect(header(page)).toBeFocused();
      await expect(header(page)).toHaveValue('');
      await expect(page).toHaveURL(home);
    });

    test('the field is a combobox that names its listbox and the highlighted option', async ({
      page,
    }) => {
      await open(page, `/${locale}`);
      const field = header(page);

      await expect(field).toHaveAttribute('aria-expanded', 'false');
      await expect(field).not.toHaveAttribute('aria-controls');
      await field.fill('queen');
      await expect(list(page)).toBeVisible();
      await expect(field).toHaveAttribute('aria-expanded', 'true');
      await expect(field).toHaveAttribute(
        'aria-controls',
        'header-suggestions-listbox',
      );
      await expect(list(page)).toHaveAttribute(
        'id',
        'header-suggestions-listbox',
      );

      await expect(rowLink(page, /Radio Ga Ga/)).toBeVisible();
      await field.press('ArrowDown');
      await field.press('ArrowDown');
      const radio = rowLink(page, /Radio Ga Ga/);
      await expect(radio).toHaveAttribute('aria-selected', 'true');
      await expect(rowLink(page, /Under Pressure/)).toHaveAttribute(
        'aria-selected',
        'false',
      );
      await expect(field).toHaveAttribute(
        'aria-activedescendant',
        (await radio.getAttribute('id')) ?? '',
      );

      await field.press('Escape');
      await expect(field).toHaveAttribute('aria-expanded', 'false');
      await expect(field).not.toHaveAttribute('aria-activedescendant');
    });

    // Deliberate on desktop too: the second Escape blurs and collapses the
    // field, as the header did before the keyboard work. Small screens also
    // collapse (see the phone tests), so the blur is the desktop part.
    test('the second Escape blurs the field on desktop and keeps the text', async ({
      page,
    }) => {
      await typedWithRows(page);
      await header(page).press('Escape');
      await expect(list(page)).toHaveCount(0);
      await expect(header(page)).toBeFocused();
      await header(page).press('Escape');
      await expect(header(page)).not.toBeFocused();
      await expect(header(page)).toHaveValue('queen');
    });
  });
}
