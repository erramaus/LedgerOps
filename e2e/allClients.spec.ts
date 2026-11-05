import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from '../shared/demoCompanyBooks'

const ADDITIONAL_COMPANY_NAMES = ADDITIONAL_DEMO_CLIENT_IDS.map((id) => getAdditionalDemoCompany(id)!.clientName)

/** Phase 11: All clients shows individual tasks from all five demo companies, matching the source tabs. */
const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const metric = (page: Page, label: string) => page.locator('.metric-card').filter({ has: page.locator('.metric-label', { hasText: new RegExp(`^${label}$`) }) }).locator('strong')
const COMPANIES = ['ABC Plumbing', 'Green Leaf Landscaping', 'Smith Construction', 'Johnson Dental', 'Acme Consulting']

async function openWorkspace(page: Page) {
  await mockApp(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}

const overdueRows = (page: Page) => page.locator('.finance-list-row').filter({ hasText: /Overdue by/ }).filter({ hasNotText: /Paid in full/ })

test.describe('All clients work queue', () => {
  test.use({ actionTimeout: 10_000 })

  test('Dashboard overdue counts agree with the Receivables and Payables lists for all five companies', async ({ page }) => {
    await openWorkspace(page)
    const invoices = Number(await metric(page, 'Overdue invoices').innerText())
    const bills = Number(await metric(page, 'Overdue bills').innerText())
    expect(invoices).toBeGreaterThan(4)

    await nav(page, /Receivables/).click()
    await expect(page.locator('.finance-list-row').first()).toBeVisible()
    expect(await overdueRows(page).count()).toBe(invoices)

    await nav(page, /Payables/).click()
    await expect(page.locator('.finance-list-row').first()).toBeVisible()
    expect(await overdueRows(page).count()).toBe(bills)
  })

  test('the Inbox lists tasks from every company and each row names its owner', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Inbox/).click()
    const rows = page.locator('.inbox-row')
    await expect(rows.first()).toBeVisible()
    const texts = await rows.allInnerTexts()
    for (const company of COMPANIES) expect(texts.some((text) => text.includes(company)), company).toBe(true)
    expect(texts.some((text) => /items flagged|Summary only/i.test(text))).toBe(false)
  })

  test('opening a task from another company selects that company and opens the exact invoice', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Inbox/).click()
    const row = page.locator('.inbox-row').filter({ hasText: 'Johnson Dental' }).filter({ hasText: /overdue/i }).filter({ hasText: /invoice/i }).first()
    await expect(row).toBeVisible()
    const number = ((await row.innerText()).match(/JD-I\d+/) ?? [''])[0]
    expect(number).toBeTruthy()
    await row.click()
    await expect(page.locator('label.client-switcher select')).toHaveValue(/johnson/i)
    await expect(page.locator('.review-header')).toContainText(number)

    // The selected company's Inbox never contains another company's tasks.
    await nav(page, /Inbox/).click()
    for (const text of await page.locator('.inbox-row').allInnerTexts()) expect(text).toContain('Johnson Dental')
  })

  test('opening a bill task from another company opens that bill', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Inbox/).click()
    const row = page.locator('.inbox-row').filter({ hasText: 'Acme Consulting' }).filter({ hasText: /AC-B\d+ is overdue/ }).first()
    await expect(row).toBeVisible()
    const number = ((await row.innerText()).match(/AC-B\d+/) ?? [''])[0]
    expect(number).toBeTruthy()
    await row.click()
    await expect(page.locator('.review-header')).toContainText(number)
  })

  test('stored reconciliations for an unselected company update its month-end task, and reopening restores it', async ({ page }) => {
    const { reconciliations } = await mockApp(page)
    reconciliations.seedDemo()
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    const julyOf = (id: string) => [...reconciliations.records.values()].filter((record) => record.clientId === id && record.periodEnd === '2026-07-31')
    const companyId = ADDITIONAL_DEMO_CLIENT_IDS.slice().reverse().find((id) => julyOf(id).length === getAdditionalDemoCompany(id)!.ledger.reconAccounts!.length)!
    const company = getAdditionalDemoCompany(companyId)!
    const monthEndRow = () => page.locator('.inbox-row').filter({ hasText: company.clientName }).filter({ hasText: /month-end checks still need work/ })
    const checksLeft = async () => Number(((await monthEndRow().innerText()).match(/(\d+) of \d+ month-end checks/) ?? [])[1])
    const showInbox = async () => {
      await nav(page, /Receivables/).click()
      await nav(page, /Inbox/).click()
      await expect(monthEndRow()).toBeVisible()
    }
    await showInbox()
    const before = await checksLeft()

    const july = julyOf(companyId)
    expect(july.length).toBeGreaterThan(0)
    const august = july.map((record) => ({ ...record, id: record.id.replace('2026-07-31', '2026-08-31'), periodEnd: '2026-08-31', statementDate: '2026-08-31', status: 'completed' }))
    for (const record of august) reconciliations.records.set(record.id, record)
    await showInbox()
    expect(await checksLeft()).toBe(before - 2)

    for (const record of august) reconciliations.records.set(record.id, { ...record, status: 'draft', completedAt: undefined, completedBy: undefined, history: [{ at: '2026-10-14T10:00:00.000Z', action: 'reopened', reason: 'Statement was corrected' }] })
    await showInbox()
    expect(await checksLeft()).toBe(before)

    // Other companies are untouched, and the selected company's own Month End tab agrees once opened.
    await expect(page.locator('.inbox-row').filter({ hasText: ADDITIONAL_COMPANY_NAMES[0] }).filter({ hasText: /month-end checks still need work/ })).toBeVisible()
  })
})
