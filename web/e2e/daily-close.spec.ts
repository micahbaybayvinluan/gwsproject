import { expect, test } from '@playwright/test';

/** Sales Associate logs in on a phone, opens Daily Close, fills the Money Breakdown, saves the cash count and exports the report. */
test('daily close smoke: cash count saves and variance is shown', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill('sales.westave');
  await page.getByLabel('Password').fill(process.env.SEED_PASSWORD || 'ChangeMe!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Good day/)).toBeVisible();
  await page.goto('/closing');
  await expect(page.getByText('Expected cash')).toBeVisible();
  await page.getByTestId('denom-1000').fill('2');
  await page.getByTestId('denom-100').fill('3');
  await expect(page.getByTestId('variance')).toBeVisible();
  await page.getByTestId('save-count').click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByText(/Last saved count/)).toBeVisible();
});
