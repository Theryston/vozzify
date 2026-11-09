import { expect, test } from '@playwright/test';
import { mockAdminPinsApi } from './admin-pins-api-mock';
import { adminUser } from './admin-users';
import { mockAuthApi } from './auth-api-mock';
import { messages } from './messages';

test('an admin can create an editorial Pin with 48 ordered Tracks', async ({
  page,
  context,
}) => {
  await mockAuthApi(page, { user: adminUser });
  await context.addCookies([
    {
      name: 'vozzify.session_token',
      value: 'signed-in',
      url: 'http://localhost:3000',
    },
    {
      name: 'vozzify-e2e-session',
      value: 'signed-in',
      url: 'http://localhost:3000',
    },
  ]);
  const tracks = Array.from({ length: 49 }, (_, index) => ({
    id: `trk_editorial_${index}`,
    title: `Editorial Track ${String(index).padStart(2, '0')}`,
    artistCredit: [{ name: 'Fixture Artist', joinPhrase: '' }],
    coverUrl: null,
  }));
  const api = await mockAdminPinsApi(page, { tracks });
  const form = messages.en.adminHomePins.form;

  await page.goto('/en/admin/home-pins');
  await page
    .getByRole('button', { name: messages.en.adminHomePins.create })
    .click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByLabel(form.trackPicker.searchLabel);
  await page.clock.install();
  for (const track of tracks.slice(0, 48)) {
    await search.fill(track.title);
    await page.clock.fastForward(301);
    const result = dialog.getByRole('button', {
      name: new RegExp(track.title),
    });
    await expect(result).toBeEnabled();
    await result.click();
  }

  await expect(
    dialog.getByRole('button', { name: /Remove Editorial Track/ }),
  ).toHaveCount(48);
  await expect(dialog.getByText('Up to 48 Tracks')).toBeVisible();
  await search.fill(tracks[48]?.title ?? 'Editorial Track 48');
  await page.clock.fastForward(301);
  await expect(
    dialog.getByRole('button', { name: /Editorial Track 48/ }),
  ).toBeDisabled();

  await dialog.getByLabel(form.titleEn.label).fill('Long selection');
  await dialog.getByLabel(form.titlePt.label).fill('Seleção longa');
  await dialog.getByRole('button', { name: form.submitCreate }).click();
  await expect(page.getByText('Long selection')).toBeVisible();

  const posted = api.calls
    .map((call) => call.postDataJSON())
    .find(
      (body): body is { source: { trackIds: string[] } } =>
        !!body &&
        typeof body === 'object' &&
        'source' in body &&
        typeof body.source === 'object' &&
        body.source !== null &&
        'trackIds' in body.source,
    );
  expect(posted?.source.trackIds).toEqual(
    tracks.slice(0, 48).map((track) => track.id),
  );

  await page
    .getByRole('button', { name: messages.en.adminHomePins.edit })
    .click();
  const editDialog = page.getByRole('dialog');
  await expect(
    editDialog.getByRole('button', { name: /Remove Editorial Track/ }),
  ).toHaveCount(48);
  await expect(
    editDialog.getByText('Editorial Track 47', { exact: true }),
  ).toBeVisible();
});
