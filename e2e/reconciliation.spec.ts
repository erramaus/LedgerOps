import { expect, test, type Page } from '@playwright/test'
import { FakeQuickBooks, FakeReconciliations, mockApp } from './support'

const openReconcile = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await page.locator('nav.main-nav').getByRole('button', { name: /Reconcile/ }).click()
  await expect(page.getByTestId('storage-label')).toBeVisible()
}

const startDemo = async (page: Page, account: string) => {
  await page.getByRole('button', { name: `Start reconciliation for ${account}` }).click()
  await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
}

const toMatch = async (page: Page) => {
  await page.getByRole('button', { name: /Continue to matching/ }).click()
  await expect(page.getByRole('heading', { name: 'Match transactions to the statement' })).toBeVisible()
}

const difference = (page: Page) => page.getByTestId('remaining-difference')
const completeButton = (page: Page) => page.getByRole('button', { name: /Complete reconciliation/ })
const step = (page: Page, label: string) => page.getByRole('navigation', { name: 'Reconciliation steps' }).getByRole('button', { name: label })

/** Walks the Chase checking demo account to a balanced, completed reconciliation. */
const completeChecking = async (page: Page) => {
  await startDemo(page, 'Chase Business Checking')
  await page.getByLabel(/This is the first reconciliation here/).check()
  await toMatch(page)
  await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
  await expect(difference(page)).toHaveText('$0.00')
  await step(page, '4. Review & complete').click()
  await completeButton(page).click()
  await expect(page.getByTestId('completed-banner')).toBeVisible()
}

test.describe('Reconcile: demo data', () => {
  test('shows the remaining difference, clears matched items and completes only at exactly zero', async ({ page }) => {
    const { reconciliations, unexpected } = await mockApp(page)
    await openReconcile(page)
    await startDemo(page, 'Chase Business Checking')
    await page.getByLabel(/This is the first reconciliation here/).check()
    await toMatch(page)

    // Nothing cleared yet: the whole change in the period is still unexplained, and is computed, not typed in.
    await expect(difference(page)).toHaveText('$1,421.72')
    await expect(page.getByTestId('recon-row')).toHaveCount(13)
    await page.getByRole('button', { name: /Clear all suggested matches \(13\)/ }).click()
    await expect(difference(page)).toHaveText('$0.00')

    await step(page, '4. Review & complete').click()
    await expect(page.getByText('Everything checks out')).toBeVisible()
    await completeButton(page).click()
    await expect(page.getByTestId('completed-banner')).toContainText('QuickBooks was not changed')
    await expect(page.getByTestId('history')).toContainText('completed')
    expect(reconciliations.records.size).toBe(1)
    expect(reconciliations.badCsrf).toBe(0)
    expect(unexpected).toEqual([])
  })

  test('the credit card statement shows exactly $224.20 unexplained, explains it, and cannot be completed', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await startDemo(page, 'Chase Business Credit Card')
    await page.getByLabel(/This is the first reconciliation here/).check()
    await toMatch(page)
    await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
    await expect(difference(page)).toHaveText('$224.20')
    await expect(page.getByText(/On the statement but not matched \(1\)/)).toBeVisible()

    await step(page, '4. Review & complete').click()
    await expect(page.getByTestId('explanations')).toContainText('HOME DEPOT')
    await expect(page.getByTestId('explanations')).toContainText('$224.20')
    await expect(page.getByTestId('blocking-issues')).toBeVisible()
    await expect(completeButton(page)).toBeDisabled()
  })

  test('a first reconciliation cannot be completed until the opening balance is confirmed', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await startDemo(page, 'Chase Business Checking')
    await toMatch(page)
    await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
    await expect(difference(page)).toHaveText('$0.00')
    await step(page, '4. Review & complete').click()
    await expect(completeButton(page)).toBeDisabled()
    await expect(page.getByTestId('blocking-issues')).toContainText(/opening|beginning/i)
  })

  test('reopening needs a reason, is recorded, and changes are recalculated before it can be completed again', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await completeChecking(page)

    const reopen = page.getByRole('button', { name: 'Reopen', exact: true })
    await expect(reopen).toBeDisabled()
    await page.getByLabel('Reason for reopening').fill('ok')
    await expect(reopen).toBeDisabled()
    await page.getByLabel('Reason for reopening').fill('Bank corrected the Shell charge')
    await reopen.click()
    await expect(page.getByTestId('history')).toContainText('reopened')
    await expect(page.getByTestId('history')).toContainText('Bank corrected the Shell charge')

    // Un-clearing one item must change the difference by exactly that amount and block completion.
    await step(page, '3. Match').click()
    await page.getByRole('button', { name: /Mark uncleared: Home Depot/ }).click()
    await expect(difference(page)).toContainText('341.22')
    await step(page, '4. Review & complete').click()
    await expect(completeButton(page)).toBeDisabled()

    // Putting it back restores a zero difference and allows completion again.
    await step(page, '3. Match').click()
    await page.getByRole('button', { name: /Mark cleared: Home Depot/ }).click()
    await expect(difference(page)).toHaveText('$0.00')
    await step(page, '4. Review & complete').click()
    await completeButton(page).click()
    await expect(page.getByTestId('completed-banner')).toBeVisible()
    await expect(page.getByTestId('history').getByText('completed')).toHaveCount(2)
  })

  test('past reconciliations are listed and can be reviewed after a page reload', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await completeChecking(page)
    await page.reload()
    await page.locator('nav.main-nav').getByRole('button', { name: /Reconcile/ }).click()
    const saved = page.getByTestId('saved-reconciliation')
    await expect(saved).toHaveCount(1)
    await expect(saved).toContainText('Completed')
    await expect(saved).toContainText('$0.00')
    await saved.getByRole('button', { name: /View reconciliation/ }).click()
    await expect(page.getByTestId('completed-banner')).toBeVisible()
    await expect(difference(page)).toHaveText('$0.00')
  })

  test('the next period starts from the previous ending balance', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await completeChecking(page)
    await step(page, '1. Account').click()
    await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()
    await expect(page.getByLabel('Beginning balance')).toHaveValue('48421.72')
    await expect(page.getByLabel('Statement start date')).toHaveValue('2026-09-01')
  })

  test('downloads a summary that says nothing was written to QuickBooks', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await completeChecking(page)
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download summary/ }).click()])
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
    const { createReadStream } = await import('node:fs')
    const chunks: Buffer[] = []
    for await (const chunk of createReadStream((await download.path())!)) chunks.push(chunk as Buffer)
    const text = Buffer.concat(chunks).toString('utf8')
    expect(text).toContain('Chase Business Checking')
    expect(text).toContain('Nothing was written to QuickBooks')
    expect(text).toContain('Balanced')
  })
})

test.describe('Reconcile: statement CSV import', () => {
  const upload = (page: Page, csv: string) => page.getByLabel('Statement CSV file').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  test('previews valid rows, blocks import on a bad row, and does not send anything to QuickBooks', async ({ page }) => {
    const { quickBooks, unexpected } = await mockApp(page)
    await openReconcile(page)
    await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()

    await upload(page, 'Date,Description,Amount\n08/02/2026,DEPOSIT - CUSTOMER PAYMENT,5000.00\n08/04/2026,HOME DEPOT #4411,-341.22\n')
    await expect(page.getByTestId('csv-preview')).toContainText('Preview: 2 valid lines, 0 errors')
    await page.getByRole('button', { name: /Use these 2 statement lines/ }).click()
    await expect(page.getByText('2 statement lines will be matched against your books.')).toBeVisible()

    await page.getByRole('button', { name: 'Remove them' }).click()
    await upload(page, 'Date,Description,Amount\n08/02/2026,DEPOSIT,5000.00\nnot-a-date,BROKEN ROW,12.00\n')
    await expect(page.getByTestId('csv-preview')).toContainText(/1 error/)
    await expect(page.getByRole('button', { name: 'Fix the errors to import' })).toBeDisabled()

    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })

  test('imported statement lines drive the matching: a statement line missing from the books is reported', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()
    await page.getByLabel(/This is the first reconciliation here/).check()
    await upload(page, 'Date,Description,Amount\n08/02/2026,DEPOSIT - CUSTOMER PAYMENT,5000.00\n08/30/2026,MYSTERY FEE,-15.00\n')
    await page.getByRole('button', { name: /Use these 2 statement lines/ }).click()
    await toMatch(page)
    await expect(page.getByText(/On the statement but not matched \(2\)/)).toBeVisible()
    await page.getByRole('button', { name: /Clear all suggested matches \(1\)/ }).click()
    await expect(page.getByText(/On the statement but not matched \(1\)/)).toBeVisible()
    await expect(page.getByText(/LedgerOps does not add it for you/)).toBeVisible()
  })
})

test.describe('Reconcile: QuickBooks Sandbox (read only)', () => {
  const register = (complete: boolean) => ({
    transactions: [{ id: 'qb-1', date: '2026-09-10', payee: 'Sandbox Customer', memo: '', amountCents: 10_000, direction: 'increase' as const }],
    completeness: complete ? { complete: true, reasons: [] } : { complete: false, reasons: ['Only part of the register could be read.'] },
  })

  const startQuickBooks = async (page: Page) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await page.locator('nav.main-nav').getByRole('button', { name: /Reconcile/ }).click()
    await page.getByRole('button', { name: 'Start reconciliation for Checking' }).click()
    await page.getByLabel('Beginning balance', { exact: true }).fill('0')
    await page.getByLabel('Ending balance', { exact: true }).fill('100.00')
    await page.getByLabel(/This is the first reconciliation here/).check()
    await toMatch(page)
  }

  test('incomplete QuickBooks data blocks completion until a complete reload, and never writes to QuickBooks', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    quickBooks.register = register(false)
    const { reconciliations, unexpected } = await mockApp(page, { quickBooks })
    await startQuickBooks(page)

    await expect(page.getByRole('alert').filter({ hasText: 'may be incomplete' })).toContainText('Only part of the register')
    await page.getByRole('button', { name: /Mark cleared: Sandbox Customer/ }).click()
    await expect(difference(page)).toHaveText('$0.00')
    await step(page, '4. Review & complete').click()
    await expect(completeButton(page)).toBeDisabled()
    await expect(page.getByTestId('blocking-issues')).toContainText(/incomplete|complete/i)

    // QuickBooks now reports a full read; reloading brings that in and only then allows completion.
    quickBooks.register = register(true)
    await step(page, '3. Match').click()
    await page.getByRole('button', { name: 'Reload transactions' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'may be incomplete' })).toHaveCount(0)
    await step(page, '4. Review & complete').click()
    await completeButton(page).click()
    await expect(page.getByTestId('completed-banner')).toContainText('QuickBooks was not changed')

    expect(quickBooks.writes).toEqual([])
    expect(quickBooks.registerReads.length).toBeGreaterThan(1)
    expect(reconciliations.records.size).toBe(1)
    expect(unexpected).toEqual([])
  })

  test('the server-side re-read cannot be bypassed: completion fails if QuickBooks became incomplete after loading', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    quickBooks.register = register(true)
    await mockApp(page, { quickBooks })
    await startQuickBooks(page)
    await page.getByRole('button', { name: /Mark cleared: Sandbox Customer/ }).click()
    await step(page, '4. Review & complete').click()
    await expect(completeButton(page)).toBeEnabled()

    quickBooks.register = register(false)
    await completeButton(page).click()
    await expect(page.getByRole('alert')).toContainText(/cannot be completed|incomplete/i)
    await expect(page.getByTestId('completed-banner')).toHaveCount(0)
  })
})

test.describe('Reconcile: storage honesty', () => {
  test('local development storage is labelled temporary, and durable storage says so', async ({ page }) => {
    await mockApp(page)
    await openReconcile(page)
    await expect(page.getByTestId('storage-label')).toContainText('Temporary local development records')
    await expect(page.getByTestId('storage-label')).toContainText('lost when the server restarts')
  })

  test('durable storage is described as the LedgerOps database', async ({ page }) => {
    const reconciliations = new FakeReconciliations()
    reconciliations.durable = true
    await mockApp(page, { reconciliations })
    await openReconcile(page)
    await expect(page.getByTestId('storage-label')).toContainText('saved in the LedgerOps database')
    await expect(page.getByTestId('storage-label')).not.toContainText('Temporary')
  })
})
