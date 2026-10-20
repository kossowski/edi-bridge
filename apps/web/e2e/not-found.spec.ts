import { expect, test } from '@playwright/test'

test('an unknown address answers 404 and shows "Page not found" inside the app frame', async ({
  page,
}) => {
  const response = await page.goto('/no-such-page')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect(page.locator('header')).toBeVisible()
})
