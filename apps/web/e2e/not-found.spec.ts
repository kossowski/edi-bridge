import { expect, type Page, test } from '@playwright/test'

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  return errors
}

test('an unknown address answers 404 and shows "Page not found" inside the app frame', async ({
  page,
}) => {
  const errors = collectErrors(page)
  const response = await page.goto('/no-such-page')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  const main = page.getByRole('main')
  await expect(main.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
  await expect(main.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
  // Chromium logs the 404 of the document itself.
  expect(errors.filter((error) => !error.startsWith('Failed to load resource'))).toEqual([])
})

test('a known workspace address answers 200 without errors', async ({ page }) => {
  const errors = collectErrors(page)
  const response = await page.goto('/documents')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(errors).toEqual([])
})
