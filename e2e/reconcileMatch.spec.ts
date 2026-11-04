import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const open = async (page: Page, account: string) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await page.locator('nav.main-nav').getByRole('button', { name: /Reconcile/ }).click()
  await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
  await page.getByRole('button', { name: `Start reconciliation for ${account}` }).click()
  await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
  await page.getByLabel(/This is the first reconciliation here/).check()
  await page.getByRole('button', { name: /Continue to matching/ }).click()
  await expect(page.getByRole('heading', { name: 'Match transactions to the statement' })).toBeVisible()
}
const difference = (page: Page) => page.getByTestId('remaining-difference')
const confirm = (page: Page) => page.getByTestId('bulk-confirm')

test.describe('Reconcile: Match step', () => {
  test('has one compact toolbar with the four actions', async ({ page }) => {
    await mockApp(page)
    await open(page, 'Chase Business Checking')
    const toolbar = page.getByRole('toolbar', { name: 'Match actions' })
    for (const name of [/Clear all shown/, /Unclear all shown/, /Clear all suggested matches/, /Reload transactions/]) {
      await expect(toolbar.getByRole('button', { name })).toBeVisible()
    }
  })

  test('bulk clearing and unclearing need confirmation and can be cancelled', async ({ page }) => {
    await mockApp(page)
    await open(page, 'Chase Business Checking')
    const before = await difference(page).innerText()
    await page.getByRole('button', { name: /Clear all shown/ }).click()
    await expect(confirm(page)).toContainText('matching, unclaimed statement item')
    await expect(difference(page)).toHaveText(before)
    await confirm(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm(page)).toHaveCount(0)
    await expect(difference(page)).toHaveText(before)

    await page.getByRole('button', { name: /Clear all shown/ }).click()
    await confirm(page).getByRole('button', { name: /^Confirm/ }).click()
    await expect(difference(page)).not.toHaveText(before)
    await page.getByRole('button', { name: /Unclear all shown/ }).click()
    await expect(confirm(page)).toContainText('Remove the cleared mark')
    await expect(difference(page)).not.toHaveText(before)
    await confirm(page).getByRole('button', { name: /^Confirm/ }).click()
    await expect(difference(page)).toHaveText(before)
  })

  test('a suggestion shows its statement item and evidence and is accepted one at a time', async ({ page }) => {
    await mockApp(page)
    await open(page, 'Chase Business Checking')
    const accepts = page.getByRole('button', { name: /^Accept Match/ })
    const total = await accepts.count()
    expect(total).toBeGreaterThan(1)
    const row = page.getByTestId('recon-row').filter({ hasText: 'Accept Match' }).first()
    await expect(row).toContainText('Suggested statement item')
    await expect(row).toContainText('Amount')
    await expect(row).toContainText(/Same date|apart/)
    await expect(row.getByTestId('txn-state')).toHaveText('Not yet reviewed')
    await accepts.first().click()
    await expect(accepts).toHaveCount(total - 1)
    await expect(page.getByRole('button', { name: new RegExp(`Clear all suggested matches \\(${total - 1}\\)`) })).toBeVisible()
    await expect(page.getByTestId('txn-state').filter({ hasText: 'Matched and cleared' })).toHaveCount(1)
  })

  test('uncleared items are not all labelled as confirmed outstanding items', async ({ page }) => {
    await mockApp(page)
    await open(page, 'Chase Business Checking')
    await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
    await confirm(page).getByRole('button', { name: /^Confirm/ }).click()
    await expect(page.getByTestId('recon-row').getByText(/Outstanding check|Deposit in transit/)).toHaveCount(0)
    await expect(page.getByTestId('txn-state').filter({ hasText: 'Matched and cleared' }).first()).toBeVisible()
  })

  test('the difference is explained, and zero does not claim success on its own', async ({ page }) => {
    await mockApp(page)
    await open(page, 'Chase Business Checking')
    await expect(page.getByTestId('remaining-difference-bar')).toContainText('Remaining difference before completion.')
    await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
    await confirm(page).getByRole('button', { name: /^Confirm/ }).click()
    await expect(difference(page)).toHaveText('$0.00')
    await expect(page.getByTestId('remaining-difference-bar')).toContainText('Other completeness checks must also pass')
    await expect(page.getByTestId('remaining-difference-bar')).not.toContainText(/reconciled|success/i)
  })

  test('unmatched statement items are counted, expandable and lead to a prefilled missing transaction', async ({ page }) => {
    await mockApp(page)
    await open(page, 'Chase Business Credit Card')
    await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
    await confirm(page).getByRole('button', { name: /^Confirm/ }).click()
    await expect(page.getByTestId('unmatched-count')).toHaveText('1')
    const line = page.getByTestId('unmatched-line')
    await expect(line).toHaveCount(1)
    await line.getByRole('button', { name: /Investigate statement item/ }).click()
    await expect(line).toContainText('Statement entry')
    await line.getByRole('button', { name: /Start entering/ }).click()
    await expect(page.getByRole('form', { name: 'New transaction' }).getByLabel('Payee')).toHaveValue('HOME DEPOT #4411')
    await expect(page.getByTestId('recon-row').filter({ hasText: 'HOME DEPOT #4411' })).toHaveCount(0)
  })

  const openWithCsv = async (page: Page) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await page.locator('nav.main-nav').getByRole('button', { name: /Reconcile/ }).click()
    await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
    await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()
    await page.getByLabel(/This is the first reconciliation here/).check()
    const csv = 'Date,Description,Amount\n08/02/2026,DEPOSIT - CUSTOMER PAYMENT,5000.00\n08/30/2026,MYSTERY FEE,-15.00\n'
    await page.getByLabel('Statement CSV file').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await page.getByRole('button', { name: /Use these 2 statement lines/ }).click()
    await page.getByRole('button', { name: /Continue to matching/ }).click()
    await expect(page.getByRole('heading', { name: 'Match transactions to the statement' })).toBeVisible()
  }

  test('Clear all shown only clears items with a statement match and says what stays unmatched', async ({ page }) => {
    await mockApp(page)
    await openWithCsv(page)
    await page.getByRole('button', { name: /Clear all shown/ }).click()
    await expect(confirm(page)).toContainText('Clear 1 transaction that has a matching, unclaimed statement item')
    await expect(confirm(page)).toContainText(/have no statement match and will stay uncleared/)
    await confirm(page).getByRole('button', { name: /^Confirm/ }).click()
    await expect(page.getByTestId('txn-state').filter({ hasText: 'Matched and cleared' })).toHaveCount(1)
    await expect(page.getByTestId('unmatched-count')).toHaveText('1')
  })

  test('a manual match with a different amount or direction is blocked with an explanation', async ({ page }) => {
    await mockApp(page)
    await openWithCsv(page)
    const row = page.getByTestId('recon-row').filter({ hasText: 'Not on statement' }).first()
    await row.getByRole('button', { name: /^Mark cleared/ }).click()
    const picker = page.getByTestId('recon-row').filter({ has: page.getByRole('combobox', { name: /to a statement line/ }) }).first()
    const select = picker.getByRole('combobox', { name: /to a statement line/ })
    await select.selectOption({ index: 1 })
    await expect(picker.getByTestId('match-problem')).toContainText(/disagree/)
    await expect(page.getByTestId('unmatched-count')).toHaveText('2')
  })
})