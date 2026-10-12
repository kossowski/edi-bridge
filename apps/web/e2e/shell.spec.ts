import { expect, test } from '@playwright/test'

test('the shell shows the name of the current Workspace', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Nordwind Handel GmbH')).toBeVisible()
})

test('a link to a glossary entry scrolls to and highlights it', async ({ page }) => {
  await page.goto('/help#reprocess')

  const entry = page.locator('#reprocess')

  await expect(entry).toHaveAttribute('data-targeted')
  await expect(entry).toBeInViewport()
})
