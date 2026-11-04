import { expect, test, type Page } from '@playwright/test'
import { demoReport } from '../shared/demoMonthEnd'
import { completedQuickBooksReconciliation, confirmReview, FakeMonthEnd, FakeQuickBooks, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const group = (page: Page) => page.getByRole('group', { name: 'Accounting period' }).first()
const choosePeriod = async (page: Page, month: number, year = 2026) => {
  await group(page).getByLabel('Month').selectOption(String(month))
  await group(page).getByLabel('Year').selectOption(String(year))
}
const status = (page: Page, id: string) => page.getByTestId(`status-${id}`)
const step = (page: Page, id: string) => page.getByTestId(`step-${id}`)
const summary = (page: Page) => page.getByTestId('month-summary')

async function start(page: Page, options: { quickBooks?: FakeQuickBooks; reconciliations?: FakeReconciliations; monthEnd?: FakeMonthEnd; seed?: boolean } = {}) {
  const reconciliations = options.reconciliations ?? new FakeReconciliations()
  const monthEnd = options.monthEnd ?? new FakeMonthEnd(reconciliations)
  const harness = await mockApp(page, { quickBooks: options.quickBooks, reconciliations, monthEnd })
  if (options.seed !== false) {
    reconciliations.seedDemo()
    await monthEnd.seedDemo()
  }
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  return harness
}

const openMonthEnd = async (page: Page, month?: number) => {
  await nav(page, /Month End/).click()
  await expect(summary(page)).toBeVisible()
  if (month) {
    await choosePeriod(page, month)
    await expect(summary(page)).toBeVisible()
  }
}

const signAll = async (page: Page) => {
  for (const name of ['Mark receivables reviewed', 'Mark payables reviewed', 'Mark statements reviewed']) {
    await confirmReview(page, name)
  }
}

const closeJuly = async (page: Page) => {
  await openMonthEnd(page, 7)
  await signAll(page)
  await expect(summary(page)).toContainText('Ready for your approval')
  await page.getByRole('button', { name: /Approve and close July 2026/ }).click()
  await expect(status(page, 'approval')).toHaveText('Complete')
}

test.describe('Month End: the checklist', () => {
  test('shows every step with a status, what needs attention and where to go, and starts nothing as complete by itself', async ({ page }) => {
    const { unexpected } = await start(page)
    await openMonthEnd(page)
    await expect(page.locator('li.me-step')).toHaveCount(9)
    await expect(page.getByText('Month End', { exact: true }).first()).toBeVisible()
    for (const id of ['uncategorized', 'duplicates', 'missing-info', 'reconcile-bank', 'reconcile-card', 'receivables', 'payables', 'unusual-balances', 'statements', 'approval']) {
      await expect(status(page, id)).toHaveText(/^(Not Started|In Progress|Blocked|Complete)$/)
    }
    // August: bank and card are unreconciled and the three reviews have not been done, so none of them is complete.
    for (const id of ['reconcile-bank', 'reconcile-card', 'receivables', 'payables', 'statements']) await expect(status(page, id)).not.toHaveText('Complete')
    await expect(status(page, 'uncategorized')).toHaveText(/Not Started|In Progress/)
    await expect(step(page, 'uncategorized')).toContainText('still need')
    await expect(step(page, 'reconcile-bank').getByRole('button', { name: /Open Reconcile/ })).toBeVisible()
    await expect(step(page, 'receivables').getByRole('button', { name: /Open Receivables/ })).toBeVisible()
    await expect(status(page, 'approval')).toHaveText('Blocked')
    await expect(page.getByRole('button', { name: /Approve and close August 2026/ })).toBeDisabled()
    expect(unexpected).toEqual([])
  })

  test('each step opens the workflow it belongs to', async ({ page }) => {
    await start(page)
    await openMonthEnd(page)
    await step(page, 'uncategorized').getByRole('button', { name: /Categorize transactions/ }).click()
    await expect(page.locator('.page-content').getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible()
    await nav(page, /Month End/).click()
    await step(page, 'receivables').getByRole('button', { name: /Open Receivables/ }).click()
    await expect(page.locator('.page-content').getByRole('heading', { name: /Receivable/ }).first()).toBeVisible()
    await nav(page, /Month End/).click()
    await step(page, 'statements').getByRole('button', { name: /Open Reports/ }).click()
    await expect(page.locator('.page-content').getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()
  })

  test('approval stays blocked and names the steps still open', async ({ page }) => {
    await start(page)
    await openMonthEnd(page)
    await expect(step(page, 'approval')).toContainText('4. Reconcile all bank accounts')
    await expect(step(page, 'approval')).toContainText('6. Review accounts receivable')
  })
})

test.describe('Month End: the four demo scenarios', () => {
  test('a month ready to close (July): confirm the reviews, approve, and the closing is recorded with its evidence', async ({ page }) => {
    const { monthEnd, quickBooks, unexpected } = await start(page)
    await openMonthEnd(page, 7)
    for (const id of ['uncategorized', 'duplicates', 'missing-info', 'reconcile-bank', 'reconcile-card', 'unusual-balances']) await expect(status(page, id)).toHaveText('Complete')
    await expect(page.getByTestId('evidence-reconcile-bank')).toContainText('reconciled through 2026-07-31')
    await expect(page.getByTestId('evidence-reconcile-card')).toContainText('Chase Business Credit Card')
    for (const id of ['receivables', 'payables', 'statements']) await expect(status(page, id)).toHaveText('Not Started')
    await expect(summary(page)).toContainText('3 of 9 checks still need work')
    await signAll(page)
    await expect(summary(page)).toContainText('Everything checks out. Ready for your approval.')
    await expect(page.getByTestId('evidence-statements')).toContainText('Reviewed by e2e@example.com')
    await expect(page.getByTestId('exceptions')).toHaveText('None.')
    await page.getByRole('button', { name: /Approve and close July 2026/ }).click()
    await expect(status(page, 'approval')).toHaveText('Complete')
    await expect(summary(page)).toContainText('July 2026 is closed')
    await expect(page.getByTestId('closing-info')).toContainText('by e2e@example.com')
    await expect(page.getByTestId('month-history')).toContainText('Month closed')
    await expect(page.getByTestId('month-end-storage')).toContainText('Temporary local development records')

    const saved = await monthEnd.store.get('demo:abc-plumbing:2026-07')
    expect(saved).toMatchObject({ status: 'closed', period: '2026-07' })
    expect(saved!.closing!.reconciliations.map((item) => item.accountId).sort()).toEqual(['chase-card', 'chase-checking'])
    expect(saved!.closing!.checklist).toHaveLength(9)
    expect(monthEnd.badCsrf).toBe(0)
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })

  test('a month with unreconciled accounts (August) cannot close; completing a reconciliation updates the checklist and reopening it takes the credit back', async ({ page }) => {
    test.setTimeout(90_000)
    await start(page)
    await openMonthEnd(page)
    await expect(status(page, 'reconcile-bank')).toHaveText('Not Started')
    await step(page, 'reconcile-bank').getByRole('button', { name: /Open Reconcile/ }).click()
    await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
    await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()
    await expect(page.getByLabel('Beginning balance', { exact: true })).toHaveValue('$47,000.00')
    await expect(page.getByLabel('Statement end date')).toHaveValue('2026-08-31')
    await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
    await page.getByRole('button', { name: /Continue to matching/ }).click()
    await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
    await page.getByTestId('bulk-confirm').getByRole('button', { name: /^Confirm/ }).click()
    await expect(page.getByTestId('remaining-difference')).toHaveText('$0.00')
    await page.getByRole('navigation', { name: 'Reconciliation steps' }).getByRole('button', { name: '4. Review & complete' }).click()
    await page.getByRole('button', { name: /Complete reconciliation/ }).click()
    await expect(page.getByTestId('completed-banner')).toBeVisible()

    await nav(page, /Month End/).click()
    await expect(status(page, 'reconcile-bank')).toHaveText('Complete')
    await expect(page.getByTestId('evidence-reconcile-bank')).toContainText('reconciled through 2026-08-31')
    await expect(status(page, 'reconcile-card')).toHaveText('Not Started')
    await expect(status(page, 'approval')).toHaveText('Blocked')

    await nav(page, /Reconcile/).click()
    await page.getByTestId('saved-reconciliation').filter({ hasText: 'Chase Business Checking' }).filter({ hasText: 'August 31, 2026' }).getByRole('button', { name: /View reconciliation/ }).click()
    await page.getByLabel('Reason for reopening').fill('Bank corrected the Shell charge')
    await page.getByRole('button', { name: 'Reopen', exact: true }).click()
    await expect(page.getByTestId('history')).toContainText('reopened')
    await nav(page, /Month End/).click()
    await expect(status(page, 'reconcile-bank')).toHaveText('In Progress')
    await expect(step(page, 'reconcile-bank')).toContainText('reopened on')
    await expect(step(page, 'reconcile-bank')).toContainText('Bank corrected the Shell charge')
  })

  test('a month with missing transaction information (June) shows exactly what is missing and cannot close', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 6)
    await expect(status(page, 'uncategorized')).toHaveText('In Progress')
    await expect(step(page, 'uncategorized')).toContainText('1 transaction still needs a category.')
    await expect(status(page, 'duplicates')).toHaveText('Not Started')
    await expect(status(page, 'missing-info')).toHaveText('In Progress')
    await expect(step(page, 'missing-info')).toContainText('1 transaction has no payee')
    await expect(step(page, 'missing-info')).toContainText('1 client question is still open')
    await expect(step(page, 'missing-info').getByRole('button', { name: /Open Client Requests/ })).toBeVisible()
    await expect(step(page, 'missing-info')).toContainText('This cannot be accepted as an exception')
    await expect(step(page, 'unusual-balances')).toContainText('Uncategorized Expense')
    await expect(page.getByRole('button', { name: /Approve and close June 2026/ })).toBeDisabled()
    await expect(status(page, 'approval')).toHaveText('Blocked')
  })

  test('a reopened month (May) keeps its history and reason, and can be approved again', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 5)
    await expect(page.getByTestId('month-history')).toContainText('Month reopened')
    await expect(page.getByTestId('month-history')).toContainText('corrected May bank statement')
    await expect(summary(page)).toContainText('Ready for your approval')
    await page.getByRole('button', { name: /Approve and close May 2026/ }).click()
    await expect(status(page, 'approval')).toHaveText('Complete')
    await expect(page.getByTestId('month-history').getByText('Month closed')).toHaveCount(2)
    await expect(page.getByTestId('month-history').getByText('Month reopened')).toHaveCount(1)
  })
})

test.describe('Month End: reopening and keeping the books verified', () => {
  test('reopening needs a reason and is recorded; the review is kept for figures that have not changed', async ({ page }) => {
    await start(page)
    await closeJuly(page)
    const reopen = page.getByRole('button', { name: /Reopen July 2026/ })
    await expect(reopen).toBeDisabled()
    await page.getByLabel('Reason for reopening this month').fill('ok')
    await expect(reopen).toBeDisabled()
    await page.getByLabel('Reason for reopening this month').fill('Client sent an updated invoice')
    await reopen.click()
    await expect(page.getByTestId('month-history')).toContainText('Client sent an updated invoice')
    await expect(page.getByTestId('month-history').getByText('Month reopened')).toBeVisible()
    await expect(status(page, 'approval')).toHaveText('Not Started')
    await expect(status(page, 'receivables')).toHaveText('Complete')
  })

  test('a closed month stops being verified when one of its reconciliations is reopened, and the record survives a reload', async ({ page }) => {
    const { reconciliations } = await start(page)
    await closeJuly(page)
    const checking = reconciliations.records.get('demo:abc-plumbing:chase-checking:2026-07-31')
    reconciliations.records.set(checking.id, { ...checking, status: 'draft', completedAt: undefined, result: undefined, version: checking.version + 1, history: [...checking.history, { at: '2026-10-15T12:00:00.000Z', by: 'pat', action: 'reopened', reason: 'Bank fix' }] })
    await page.reload()
    await openMonthEnd(page, 7)
    await expect(page.getByTestId('changed-since-closing')).toContainText('4. Reconcile all bank accounts')
    await expect(status(page, 'approval')).toHaveText('In Progress')
    await expect(status(page, 'reconcile-bank')).toHaveText('In Progress')
    await expect(page.getByTestId('month-history')).toContainText('Month closed')
  })

  test('the chosen month is remembered across Month End, Reports and Reconcile', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 7)
    for (const name of [/Reports/, /Reconcile/, /Month End/]) {
      await nav(page, name).click()
      await expect(group(page).getByLabel('Month')).toHaveValue('7')
      await expect(group(page).getByLabel('Year')).toHaveValue('2026')
    }
  })

  test('other months of the client are listed separately and keep their own records', async ({ page }) => {
    await start(page)
    await closeJuly(page)
    await choosePeriod(page, 8)
    await expect(summary(page)).toContainText('checks still need work')
    await expect(page.getByTestId('other-months')).toContainText('July 2026')
    await expect(page.getByTestId('other-months')).toContainText('Closed')
    await expect(page.getByTestId('other-months')).toContainText('May 2026')
    await expect(page.getByTestId('other-months')).toContainText('Reopened')
  })

  test('a generated demo client receives its own Month End checklist and figures', async ({ page }) => {
    await start(page)
    await page.getByLabel('Client').selectOption({ label: 'Green Leaf Landscaping' })
    await nav(page, /Month End/).click()
    await expect(page.locator('.month-end-hero')).toContainText('GREEN LEAF LANDSCAPING')
    await expect(page.locator('li.me-step')).toHaveCount(9)
    await expect(page.getByTestId('step-receivables')).toContainText('totalling')
    await expect(page.getByTestId('step-payables')).toContainText('totalling')
  })
})

test.describe('Reports: demo data', () => {
  const openReport = async (page: Page, id: string) => {
    await nav(page, /Reports/).click()
    const gate = page.getByRole('button', { name: 'Open reports for ABC Plumbing' })
    if (await gate.isVisible()) await gate.click()
    const back = page.getByRole('button', { name: '← All reports' })
    if (await back.isVisible()) await back.click()
    await page.getByTestId(`open-${id}`).click()
    await expect(page.getByTestId('report-facts')).toBeVisible()
  }

  test('Profit and Loss shows its period and source, figures calculated from the ledger, and the checks that were run', async ({ page }) => {
    await start(page)
    await openReport(page, 'profit-loss')
    await expect(page.getByTestId('report-facts')).toContainText('August 2026 (2026-08-01 to 2026-08-31)')
    await expect(page.getByTestId('report-facts')).toContainText('Demo data')
    await expect(page.getByTestId('row-net-income')).toContainText('$4,149.18')
    await expect(page.getByTestId('row-total-income')).toContainText('$10,980.00')
    await expect(page.getByTestId('report-checks')).toContainText('Arithmetic verified')
    await expect(page.getByTestId('report-checks')).toContainText('do not prove that the books are right')
    await expect(page.getByTestId('report-warnings')).toContainText('Unreconciled accounts at 2026-08-31')
  })

  test('a previous-period column shows the exact change, and months with nothing to compare say so', async ({ page }) => {
    await start(page)
    await openReport(page, 'profit-loss')
    await page.getByLabel(/Compare with the previous period/).check()
    const july = demoReport('profit-loss', { start: '2026-07-01', end: '2026-07-31', label: 'July 2026' }).rows.find((row) => row.key === 'net-income')!.cells[0]!
    const row = page.getByTestId('row-net-income')
    await expect(row).toContainText('$4,149.18')
    await expect(row).toContainText(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(july / 100))
    await expect(page.getByRole('table', { name: 'Profit and Loss' })).toContainText('Change')
    await choosePeriod(page, 5)
    await expect(page.getByTestId('comparison-unavailable')).toContainText('no reliable previous period')
    await expect(page.getByTestId('row-net-income')).toBeVisible()
  })

  test('periods the demo books do not cover are unavailable, never zero', async ({ page }) => {
    await start(page)
    await openReport(page, 'profit-loss')
    await choosePeriod(page, 9)
    await expect(page.getByTestId('report-unavailable')).toContainText('only cover May to August 2026')
    await expect(page.getByTestId('row-net-income')).toHaveCount(0)
    await choosePeriod(page, 8)
    await page.getByRole('button', { name: 'Year to date' }).click()
    await expect(page.getByTestId('report-unavailable')).toContainText('start in May 2026')
    await expect(page.getByTestId('row-net-income')).toHaveCount(0)
  })

  test('every supported report opens and reconciles to the same books', async ({ page }) => {
    await start(page)
    await openReport(page, 'balance-sheet')
    await expect(page.getByTestId('report-checks')).toContainText('Assets equal liabilities plus equity')
    await expect(page.getByTestId('row-total-assets')).toContainText('$69,241.72')
    await openReport(page, 'cash-flow')
    await expect(page.getByTestId('row-ending-cash')).toContainText('$48,421.72')
    await expect(page.getByTestId('report-checks')).toContainText('Net change agrees with the cash accounts')
    await openReport(page, 'trial-balance')
    await expect(page.getByTestId('report-checks')).toContainText('Total debits equal total credits')
    await openReport(page, 'general-ledger')
    await expect(page.getByTestId('row-t-checking')).toContainText('$48,421.72')
    await openReport(page, 'ar-aging')
    await expect(page.getByTestId('row-total')).toContainText('$8,420.00')
    await expect(page.getByTestId('report-checks')).toContainText('Agrees with Accounts Receivable in the ledger')
    await openReport(page, 'ap-aging')
    await expect(page.getByTestId('row-total')).toContainText('$2,556.44')
  })

  test('a reconciled month shows no unreconciled warning', async ({ page }) => {
    await start(page)
    await openReport(page, 'profit-loss')
    await choosePeriod(page, 7)
    await expect(page.getByTestId('row-net-income')).toBeVisible()
    await expect(page.getByTestId('report-warnings')).toHaveCount(0)
  })
})

test.describe('QuickBooks Sandbox mode', () => {
  const switchToQuickBooks = async (page: Page) => {
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await expect(page.locator('.global-source-area .source-badge')).toContainText('QuickBooks Sandbox')
  }

  test('reports show only QuickBooks figures, name the source, verify the arithmetic and request the exact dates', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const { unexpected } = await start(page, { quickBooks })
    await switchToQuickBooks(page)
    await nav(page, /Reports/).click()
    await expect(group(page).getByLabel('Month')).toHaveValue('9')
    await page.getByTestId('open-profit-loss').click()
    await expect(page.getByRole('row', { name: /Net Income/ })).toContainText('$4,499.50')
    await expect(page.getByTestId('report-facts')).toContainText('QuickBooks Sandbox (read only)')
    await expect(page.getByTestId('report-facts')).toContainText('Accrual')
    await expect(page.getByTestId('report-facts')).toContainText('September 2026 (2026-09-01 to 2026-09-30)')
    await expect(page.getByTestId('report-checks')).toContainText('Arithmetic verified')
    await expect(page.locator('body')).not.toContainText('$10,980.00')
    await expect(page.locator('body')).not.toContainText('$4,149.18')
    expect(quickBooks.reportReads).toContainEqual({ report: 'profit-loss', start: '2026-09-01', end: '2026-09-30' })
    expect(unexpected.filter((entry) => !entry.includes('/api/'))).toEqual([])
  })

  test('a report that does not add up is flagged, and it blocks the statements step', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const broken = structuredClone(quickBooks.reports['balance-sheet'])
    broken.Rows!.Row![1].Summary!.ColData = [{ value: 'Total Liabilities and Equity' }, { value: '24,820.10' }]
    quickBooks.reports['balance-sheet'] = broken
    await start(page, { quickBooks })
    await switchToQuickBooks(page)
    await nav(page, /Reports/).click()
    await page.getByTestId('open-balance-sheet').click()
    await expect(page.getByTestId('report-checks')).toContainText('Not verified')
    await expect(page.getByTestId('report-checks')).toContainText('differ')
    await openMonthEnd(page)
    await expect(status(page, 'statements')).toHaveText('Blocked')
    await expect(step(page, 'statements')).toContainText('does not agree with its own figures')
    await expect(step(page, 'statements').getByRole('button', { name: 'Mark statements reviewed' })).toHaveCount(0)
  })

  test('a report QuickBooks cannot provide is unavailable, with no figures shown', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    delete quickBooks.reports['general-ledger']
    await start(page, { quickBooks })
    await switchToQuickBooks(page)
    await nav(page, /Reports/).click()
    await page.getByTestId('open-general-ledger').click()
    await expect(page.getByTestId('report-unavailable')).toContainText('general-ledger report failed')
    await expect(page.getByRole('table')).toHaveCount(0)
  })

  test('incomplete QuickBooks lists block the transaction steps instead of reading as zero', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    quickBooks.listCompleteness.transactions = { complete: false, reasons: ['QuickBooks has 101 Purchase records but only the first 100 are loaded.'] }
    await start(page, { quickBooks })
    await switchToQuickBooks(page)
    await openMonthEnd(page)
    for (const id of ['uncategorized', 'duplicates', 'missing-info']) {
      await expect(status(page, id)).toHaveText('Blocked')
      await expect(step(page, id)).toContainText('only the first 100 are loaded')
    }
  })

  test('closes only with the bank account reconciled, records it in LedgerOps and never writes to QuickBooks', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const reconciliations = new FakeReconciliations()
    const monthEnd = new FakeMonthEnd(reconciliations)
    const { unexpected } = await start(page, { quickBooks, reconciliations, monthEnd, seed: false })
    await switchToQuickBooks(page)
    await openMonthEnd(page)
    await expect(page.getByText(/One QuickBooks Sandbox company is connected/)).toBeVisible()
    await expect(status(page, 'reconcile-bank')).toHaveText('Not Started')
    await expect(status(page, 'reconcile-card')).toHaveText('Complete')
    await expect(page.getByTestId('evidence-reconcile-card')).toContainText('no active credit card accounts')
    await expect(page.getByRole('button', { name: /Approve and close September 2026/ })).toBeDisabled()

    const record = completedQuickBooksReconciliation('60', 'Checking', '2026-09-30')
    reconciliations.records.set(record.id, record)
    await nav(page, /Reports/).click()
    await openMonthEnd(page)
    await expect(status(page, 'reconcile-bank')).toHaveText('Complete')
    for (const id of ['uncategorized', 'duplicates', 'missing-info', 'unusual-balances']) await expect(status(page, id)).toHaveText('Complete')
    await signAll(page)
    await expect(page.getByTestId('exceptions')).toContainText('overdue customer balance')
    await page.getByRole('button', { name: /Approve and close September 2026/ }).click()
    await expect(status(page, 'approval')).toHaveText('Complete')

    const saved = await monthEnd.store.get('quickbooks:quickbooks-sandbox:2026-09')
    expect(saved).toMatchObject({ status: 'closed', source: 'quickbooks' })
    expect(saved!.closing!.reconciliations.map((item) => item.accountId)).toEqual(['60'])
    expect(quickBooks.writes).toEqual([])
    expect(monthEnd.badCsrf).toBe(0)
    expect(unexpected).toEqual([])
  })

  test('demo and QuickBooks month-end records are kept apart', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const { monthEnd } = await start(page, { quickBooks })
    await closeJuly(page)
    await switchToQuickBooks(page)
    await openMonthEnd(page)
    await expect(page.getByTestId('other-months')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Chase Business Checking')
    const demoRecords = await monthEnd.store.list({ source: 'demo', clientId: 'abc-plumbing' })
    const qbRecords = await monthEnd.store.list({ source: 'quickbooks', clientId: 'quickbooks-sandbox' })
    expect(demoRecords.some((record) => record.period === '2026-07' && record.status === 'closed')).toBe(true)
    expect(qbRecords).toEqual([])
  })
})
