import { expect, test } from '@playwright/test'

const redirects: ReadonlyArray<{ from: string; to: string; search?: Record<string, string> }> = [
  { from: '/runs', to: '/documents' },
  { from: '/runs/run-0042', to: '/documents/run-0042' },
  { from: '/order-lifecycle', to: '/orders' },
  { from: '/order-lifecycle?businessReference=PO-4711', to: '/orders/PO-4711' },
  {
    from: `/order-lifecycle?businessReference=${encodeURIComponent('PO 4711')}`,
    to: `/orders/${encodeURIComponent('PO 4711')}`,
  },
  {
    from: `/order-lifecycle?businessReference=${encodeURIComponent('4711/2026')}`,
    to: '/orders',
    search: { q: '4711/2026' },
  },
]

for (const { from, to, search } of redirects) {
  test(`an old link to ${from} redirects permanently to ${to}`, async ({ request }) => {
    const response = await request.get(from, { maxRedirects: 0 })

    expect(response.status()).toBe(308)
    const location = new URL(response.headers().location ?? '', 'http://localhost')
    expect(location.pathname).toBe(to)

    if (search) expect(Object.fromEntries(location.searchParams)).toMatchObject(search)
  })
}

test('an old order lifecycle link opens the order page', async ({ page }) => {
  const response = await page.goto('/order-lifecycle?businessReference=PO-4711')

  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(/\/orders\/PO-4711(\?|$)/)
})
