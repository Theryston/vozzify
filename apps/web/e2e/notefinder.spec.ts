import { expect, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import { messages } from './messages';

for (const locale of ['en', 'pt-BR'] as const) {
  const copy = messages[locale];

  test(`announces the change and links to the FAQ in ${locale}`, async ({
    page,
  }) => {
    await mockAuthApi(page);
    await page.goto(`/${locale}/terms?from=notefinder&keep=1`);
    const dialog = page.getByRole('dialog', {
      name: copy.notefinderNotice.title,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('link', { name: copy.notefinderNotice.learnMore })
      .click();
    await expect(page).toHaveURL(`/${locale}/notefinder`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      copy.notefinder.title,
    );
    for (const question of Object.values(copy.notefinder.questions)) {
      await expect(
        page.getByRole('heading', { name: question.title }),
      ).toBeVisible();
      await expect(
        page.getByText(question.answer, { exact: true }),
      ).toBeVisible();
    }
    await expect(page).toHaveTitle(`${copy.notefinder.metaTitle} | Vozzify`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/notefinder$`),
    );
    await page.goto(`/${locale}/terms?from=notefinder`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });
}

for (const method of ['button', 'close', 'escape', 'backdrop'] as const) {
  test(`remembers dismissal via ${method} across pages, reloads and locales`, async ({
    page,
  }) => {
    await mockAuthApi(page);
    await page.goto('/en/sign-in?from=notefinder&redirectTo=%2Fterms');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (method === 'escape') await page.keyboard.press('Escape');
    else if (method === 'backdrop') await page.mouse.click(5, 5);
    else
      await dialog
        .getByRole('button', {
          name:
            method === 'button'
              ? messages.en.notefinderNotice.dismiss
              : messages.en.notefinderNotice.close,
          exact: true,
        })
        .click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/redirectTo=%2Fterms/);
    expect(
      await page.evaluate(() =>
        localStorage.getItem('vozzify:notefinder-announcement-dismissed'),
      ),
    ).toBe('true');
    await page.reload();
    await expect(
      page.getByLabel(messages.en.auth.fields.email.label),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await page.goto('/pt-BR/terms?from=notefinder');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });
}

test('opens after client navigation, but only for the exact parameter', async ({
  page,
}) => {
  await mockAuthApi(page);
  await page.goto('/en/notefinder?from=other');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() =>
    window.history.pushState(null, '', '?from=notefinder'),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('can be dismissed when local storage is blocked', async ({ page }) => {
  await mockAuthApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/en/terms?from=notefinder');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('button', {
      name: messages.en.notefinderNotice.dismiss,
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.history.pushState(null, '', '?from=other'));
  await page.evaluate(() =>
    window.history.pushState(null, '', '?from=notefinder'),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('fits a small screen', async ({ page }) => {
  await mockAuthApi(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/pt-BR/terms?from=notefinder');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link')).toBeInViewport();
  await expect(
    dialog.getByRole('button', {
      name: messages['pt-BR'].notefinderNotice.dismiss,
      exact: true,
    }),
  ).toBeInViewport();
});
