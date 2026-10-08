import { expect, test } from '@playwright/test'

test('the shell shows the name of the current Workspace', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Nordwind Handel GmbH')).toBeVisible()
})
