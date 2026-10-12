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

test('client-side navigation to glossary entries highlights them without errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/documents')
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached()

  for (const id of ['orders', 'run']) {
    await page.evaluate(`window.next.router.push('/help#${id}')`)

    const entry = page.locator(`#${id}`)

    await expect(entry).toHaveAttribute('data-targeted')
    await expect(entry).toBeInViewport()
  }

  expect(errors).toEqual([])
})
