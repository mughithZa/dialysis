import { test, expect } from '@playwright/test';
import ar from '../client/src/i18n/ar.json' with { type: 'json' };
import en from '../client/src/i18n/en.json' with { type: 'json' };

test.use({ baseURL: process.env.E2E_BASE_URL });

const STAFF_PASSWORD = 'e2e-pass-1';

test('Arabic: chosen on the login page, right-to-left everywhere, remembered and saved for reminders', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: ar.language.ar }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  await page.getByLabel(ar.login.username).fill('desk');
  await page.getByLabel(ar.login.password).fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: ar.login.submit }).click();
  await expect(page.getByRole('heading', { name: ar.nav.today })).toBeVisible();
  await expect(page.getByRole('link', { name: ar.nav.patients }).last()).toBeVisible();

  // the server now knows, so push reminders go out in Arabic
  await expect.poll(async () => (await (await page.request.get('/api/auth/me')).json()).language).toBe('ar');

  // remembered on this device
  await page.reload();
  await expect(page.getByRole('heading', { name: ar.nav.today })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // and back to English from the user menu
  await page.getByRole('button', { name: ar.userMenu.label }).click();
  await page.getByRole('menuitem', { name: en.language.en }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: en.nav.today })).toBeVisible();
});
