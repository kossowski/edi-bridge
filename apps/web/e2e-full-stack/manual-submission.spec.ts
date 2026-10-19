import { expect, test } from '@playwright/test'

import { invoiceFixture, setUpInvoiceFlow } from './invoice-flow'

const apiUrl = `http://localhost:${process.env.API_PORT ?? '3001'}`

function operatorLogin() {
  const email = process.env.OPERATOR_EMAIL
  const password = process.env.OPERATOR_PASSWORD

  if (email === undefined || password === undefined) {
    throw new Error('Set OPERATOR_EMAIL and OPERATOR_PASSWORD to the Operator of the stack.')
  }

  return { email, password }
}

test('a manually submitted invoice reaches delivered in the Documents list', async ({
  page,
  baseURL,
}) => {
  const { email, password } = operatorLogin()

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)

  if (baseURL === undefined) {
    throw new Error('Set baseURL in the Playwright config to the web origin of the stack.')
  }

  const { inboundChannel } = await setUpInvoiceFlow({
    request: page.request,
    url: apiUrl,
    origin: baseURL,
  })

  await page.goto('/documents')
  await page.getByRole('button', { name: 'Upload a document' }).click()

  const sheet = page.getByRole('dialog', { name: 'Upload a document' })

  await sheet.getByRole('combobox', { name: 'Where does the document come from?' }).click()
  await page.getByRole('option', { name: inboundChannel.name }).click()
  await sheet.getByLabel('File').setInputFiles(invoiceFixture)
  await sheet.getByRole('button', { name: 'Upload', exact: true }).click()

  await expect(sheet.getByRole('heading', { name: '1 document created' })).toBeVisible()

  const runHref = await sheet
    .getByRole('list', { name: 'Created documents' })
    .getByRole('link')
    .getAttribute('href')

  if (runHref === null) {
    throw new Error('The created Run has no link')
  }

  await sheet.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^All/ }).click()
  await expect(page).toHaveURL(/status=all/)

  const run = page
    .getByRole('list', { name: 'Documents, newest first' })
    .getByRole('listitem')
    .filter({ has: page.locator(`a[href="${runHref}"]`) })

  // The full-stack profile has no live events, so the list only shows a new status on reload.
  await expect(async () => {
    await page.reload()
    await expect(run.getByText('Delivered', { exact: true })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
})
