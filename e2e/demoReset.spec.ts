import { expect, test, type Page } from '@playwright/test'
import { createRecord } from '../shared/demoEntries'
import { DEMO_CLIENT_ID } from '../shared/demoBooks'
import { buildDemoMonthEndRecords } from '../shared/demoMonthEnd'
import { DEMO_RESET_CLIENTS } from '../shared/demoReset'
import { confirmReview, FakeMonthEnd, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const choosePeriod = async (page: Page, month: number) => {
  const group = page.getByRole('group', { name: 'Accounting period' }).first()
  await group.getByLabel('Month').selectOption(String(month))
  await group.getByLabel('Year').selectOption('2026')
}

async function start(page: Page, options: Parameters<typeof mockApp>[1] = {}) {
  const reconciliations = options.reconciliations ?? new FakeReconciliations()
  const monthEnd = options.monthEnd ?? new FakeMonthEnd(reconciliations)
  const harness = await mockApp(page, { ...options, reconciliations, monthEnd })
  reconciliations.seedDemo()
  await monthEnd.seedDemo()
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  return { ...harness, reconciliations, monthEnd }
}

async function recordPartialInvoicePayment(page: Page) {
  await nav(page, /Receivables/).click()
  await page.locator('.finance-list-row').filter({ hasText: 'INV-1004' }).click()
  const action = page.getByTestId('invoice-payment-actions')
  await action.getByLabel('Payment date').fill('2026-08-31')
  await action.getByLabel('Payment amount').fill('500.00')
  await action.getByLabel('Deposit to bank account').selectOption('chase-checking')
  await action.getByRole('button', { name: 'Record partial payment' }).click()
  await expect(page.getByTestId('invoice-remaining')).toHaveText('$1,480.00')
}

async function addMissingCharge(page: Page) {
  await nav(page, /Reconcile/).click()
  await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
  await page.getByRole('button', { name: 'Start reconciliation for Chase Business Credit Card' }).click()
  await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
  const firstTime = page.getByLabel(/This is the first reconciliation here/)
  if (await firstTime.count()) await firstTime.check()
  await page.getByRole('button', { name: /Continue to matching/ }).click()
  await page.getByRole('button', { name: /Start entering HOME DEPOT #4411 \$224.20/ }).click()
  const form = page.getByRole('form', { name: 'New transaction' })
  await expect(form.getByLabel('Date')).toHaveValue('2026-08-08')
  await expect(form.getByLabel('Payee')).toHaveValue('HOME DEPOT #4411')
  await expect(form.getByLabel('Amount')).toHaveValue('224.20')
  await form.getByLabel('Category').selectOption('materials')
  await form.getByRole('button', { name: 'Save transaction' }).click()
  await expect(page.getByTestId('entered-transactions')).toContainText('$224.20')
}

async function resolveClientRequest(page: Page) {
  await nav(page, /Inbox/).click()
  await page.locator('.filter-row').getByRole('button', { name: /^Client Requests/ }).click()
  await page.locator('.inbox-row').filter({ hasText: 'Waiting on client' }).first().click()
  await page.getByRole('button', { name: /^Materials/ }).click()
  await page.getByRole('button', { name: /Mark Resolved/ }).click()
  await expect(page.getByText('This request is resolved.')).toBeVisible()
}

async function closeJuly(page: Page) {
  await nav(page, /Month End/).click()
  await choosePeriod(page, 7)
  await expect(page.getByTestId('month-summary')).toBeVisible()
  for (const name of ['Mark receivables reviewed', 'Mark payables reviewed', 'Mark statements reviewed']) {
    await confirmReview(page, name)
  }
  await page.getByRole('button', { name: /Approve and close July 2026/ }).click()
  await expect(page.getByTestId('status-approval')).toHaveText('Complete')
}

async function resetDemoData(page: Page, label: string) {
  await nav(page, /Settings/).click()
  await page.locator('.demo-reset-card select').selectOption({ label })
  await page.getByRole('button', { name: 'Review reset' }).click()
  const confirmation = page.getByRole('group', { name: 'Confirm demo data reset' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByLabel(/I understand these demo changes will be deleted\./).check()
  await confirmation.getByRole('button', { name: 'Reset demo data' }).click()
}

test.describe('Reset Demo Data', () => {
  test('resets one selected demo company and refreshes the browser state in place', async ({ page }) => {
    const { demoEntries, demoPayments, monthEnd, unexpected } = await start(page)

    await recordPartialInvoicePayment(page)
    await addMissingCharge(page)
    await resolveClientRequest(page)
    await closeJuly(page)

    expect(await demoEntries.store.list(DEMO_CLIENT_ID)).toHaveLength(1)
    expect(await demoPayments.store.list(DEMO_CLIENT_ID)).toHaveLength(1)

    await resetDemoData(page, 'ABC Plumbing')
    await expect(page.getByRole('status')).toContainText('Demo data restored for ABC Plumbing.')

    expect(await demoEntries.store.list(DEMO_CLIENT_ID)).toEqual([])
    expect(await demoPayments.store.list(DEMO_CLIENT_ID)).toEqual([])
    expect(
      (await monthEnd.store.list({ source: 'demo', clientId: DEMO_CLIENT_ID })).map((record) => ({
        id: record.id,
        status: record.status,
        version: record.version,
      })),
    ).toEqual(
      buildDemoMonthEndRecords().map((record) => ({
        id: record.id,
        status: record.status,
        version: record.version,
      })),
    )

    await nav(page, /Transactions/).click()
    await expect(page.locator('body')).not.toContainText('HOME DEPOT #4411')

    await nav(page, /Receivables/).click()
    await page.locator('.finance-list-row').filter({ hasText: 'INV-1004' }).click()
    await expect(page.getByTestId('invoice-remaining')).toHaveText('$1,980.00')
    await expect(page.getByTestId('payment-history-row')).toHaveCount(0)

    await nav(page, /Client Requests/).click()
    const request = page.locator('.request-card').filter({ hasText: 'Home Depot' })
    await expect(request).toContainText('Waiting for Client')

    expect(unexpected).toEqual([])
  })

  test('lets the Settings UI review and reset all five demo companies', async ({ page }) => {
    const { demoReset, unexpected } = await start(page)

    await nav(page, /Settings/).click()
    await page.locator('.demo-reset-card select').selectOption({ label: 'All five demo companies' })
    await page.getByRole('button', { name: 'Review reset' }).click()
    const confirmation = page.getByRole('group', { name: 'Confirm demo data reset' })
    await expect(confirmation).toContainText('ABC Plumbing, Green Leaf Landscaping, Smith Construction, Johnson Dental, Acme Consulting')
    const button = confirmation.getByRole('button', { name: 'Reset demo data' })
    await expect(button).toBeDisabled()
    await confirmation.getByLabel(/I understand these demo changes will be deleted\./).check()
    await button.click()

    await expect(page.getByRole('status')).toContainText('Demo data restored for ABC Plumbing, Green Leaf Landscaping, Smith Construction, Johnson Dental, Acme Consulting.')
    expect(demoReset.calls[demoReset.calls.length - 1]).toEqual(DEMO_RESET_CLIENTS.map((client) => client.id))
    expect(unexpected).toEqual([])
  })

  test('shows reset failures and keeps existing changes when the API rolls back', async ({ page }) => {
    const { demoEntries, unexpected } = await start(page, {
      beforeDemoResetSeed: () => {
        throw new Error('Injected reset failure')
      },
    })

    await demoEntries.store.put(
      createRecord(
        'manual-rollback-fixture',
        DEMO_CLIENT_ID,
        { accountId: 'chase-card', type: 'charge', date: '2026-08-08', payee: 'Reset rollback fixture', amountCents: 22_420, categoryId: 'materials', memo: '' },
        'e2e@example.com',
        '2026-10-15T12:00:00.000Z',
      ),
      0,
    )

    await resetDemoData(page, 'ABC Plumbing')
    await expect(page.getByRole('alert')).toContainText('Demo data could not be reset. No changes were kept.')
    expect((await demoEntries.store.list(DEMO_CLIENT_ID)).map((record) => record.id)).toContain('manual-rollback-fixture')
    expect(unexpected).toEqual([])
  })
})
