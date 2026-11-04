import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const switcher = (page: Page) => page.locator('label.client-switcher select')
const cards = (page: Page) => page.getByTestId('request-card')

async function openRequests(page: Page) {
  await mockApp(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await nav(page, /Client Requests/).click()
}

async function createRequest(page: Page, client: string, transaction: string, text: string, send = true) {
  await switcher(page).selectOption({ label: 'All clients' })
  await page.getByRole('button', { name: /^(New Request|Resume Draft)$/ }).click()
  const composer = page.getByTestId('request-composer')
  await composer.getByLabel('Client').selectOption({ label: client })
  await composer.getByLabel('Request type').selectOption('Missing Receipt')
  await composer.getByLabel('Related transaction or document (optional)').fill(transaction)
  await composer.getByRole('textbox', { name: /Request message/ }).fill(text)
  await composer.getByRole('button', { name: send ? 'Send Request' : 'Save Draft' }).click()
  await page.getByRole('button', { name: '← All requests' }).click()
}

test.describe('Phase 10: Client Requests usability', () => {
  test('All clients shows every client with names; one client shows only its own', async ({ page }) => {
    await openRequests(page)
    await createRequest(page, 'ABC Plumbing', 'Lowes', 'Receipt for Lowes please.')
    await createRequest(page, 'Smith Construction', 'Northstar Electric', 'Receipt for Northstar please.')
    await switcher(page).selectOption({ label: 'All clients' })
    await expect(cards(page).filter({ hasText: 'Northstar please' }).getByTestId('request-client')).toHaveText('Smith Construction')
    await expect(cards(page).filter({ hasText: 'Lowes please' }).getByTestId('request-client')).toHaveText('ABC Plumbing')

    await switcher(page).selectOption({ label: 'Smith Construction' })
    await expect(cards(page).filter({ hasText: 'Northstar please' })).toHaveCount(1)
    await expect(cards(page).filter({ hasText: 'Lowes please' })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Home Depot')

    await nav(page, /Receivables/).click()
    await expect(switcher(page).locator('option:checked')).toHaveText('Smith Construction')
  })

  test('New Request keeps its draft, needs a client, suggests text, and warns before discarding', async ({ page }) => {
    await openRequests(page)
    await switcher(page).selectOption({ label: 'All clients' })
    await page.getByRole('button', { name: 'New Request' }).click()
    const composer = page.getByTestId('request-composer')
    await composer.getByLabel('Request type').selectOption('Statement Request')
    await expect(composer.getByRole('textbox', { name: /Request message/ })).toHaveValue(/bank statement/)
    await expect(page.getByTestId('draft-needs-client')).toBeVisible()
    await expect(composer.getByRole('button', { name: 'Send Request' })).toBeDisabled()
    await expect(composer.getByRole('button', { name: 'Save Draft' })).toBeDisabled()

    await composer.getByRole('textbox', { name: /Request message/ }).fill('My edited statement request.')
    await composer.getByLabel('Client').selectOption({ label: 'Green Leaf Landscaping' })
    await expect(composer.getByRole('button', { name: 'Send Request' })).toBeEnabled()

    await composer.getByRole('button', { name: /^Close/ }).click()
    await expect(page.getByTestId('draft-kept')).toBeVisible()
    await page.getByRole('button', { name: 'Resume Draft' }).click()
    await expect(composer.getByRole('textbox', { name: /Request message/ })).toHaveValue('My edited statement request.')

    await nav(page, /Receivables/).click()
    await nav(page, /Client Requests/).click()
    await expect(composer.getByRole('textbox', { name: /Request message/ })).toHaveValue('My edited statement request.')

    await composer.getByRole('button', { name: 'Discard draft' }).click()
    await expect(page.getByTestId('discard-confirm')).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(composer.getByRole('textbox', { name: /Request message/ })).toHaveValue('My edited statement request.')
    await composer.getByRole('button', { name: 'Discard draft' }).click()
    await page.getByRole('button', { name: 'Discard changes' }).click()
    await expect(page.getByRole('button', { name: 'New Request' })).toBeVisible()
  })

  test('search, status filters, counts and Reset Filters work together', async ({ page }) => {
    await openRequests(page)
    await createRequest(page, 'ABC Plumbing', 'Lowes', 'Receipt for Lowes please.')
    await createRequest(page, 'Smith Construction', 'Northstar Electric', 'Receipt for Northstar please.', false)
    await switcher(page).selectOption({ label: 'All clients' })
    const counts = page.getByTestId('request-counts')
    await expect(counts).toContainText(/\d+ active of \d+ total requests/)
    const total = Number((await counts.innerText()).match(/of (\d+)/)![1])

    await page.getByLabel('Search requests').fill('lowes')
    await expect(cards(page)).toHaveCount(1)
    await expect(page.getByTestId('requests-showing')).toHaveText(`Showing 1 of ${total}`)
    await page.getByRole('button', { name: 'Reset Filters' }).click()
    await expect(cards(page)).toHaveCount(total)
    await expect(page.getByTestId('requests-showing')).toHaveCount(0)

    await page.getByRole('button', { name: /^Draft/ }).click()
    await expect(cards(page)).toHaveCount(1)
    await expect(cards(page).first()).toContainText('Northstar')
    await page.getByLabel('Search requests').fill('lowes')
    await expect(cards(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Reset Filters' }).click()

    await page.getByRole('button', { name: /^Active/ }).click()
    await expect(cards(page).filter({ hasText: 'Completed' }).locator('.inbox-status', { hasText: 'Completed' })).toHaveCount(0)
  })

  test('due dates use the local date, and completed requests are never overdue', async ({ page }) => {
    await openRequests(page)
    await switcher(page).selectOption({ label: 'ABC Plumbing' })
    const waiting = cards(page).filter({ hasText: 'Home Depot' })
    await expect(waiting.getByTestId('request-due')).toContainText(/Overdue by \d+ days/)
    await expect(waiting).toContainText('Aug 22, 2026')
    const completed = cards(page).filter({ hasText: 'PlumbPro Supply' })
    await expect(completed.getByTestId('request-due')).toHaveCount(0)
    await expect(completed).toContainText('Completed')
  })

  test('actions follow the status and waiting requests cannot be finished from the card', async ({ page }) => {
    await openRequests(page)
    await switcher(page).selectOption({ label: 'ABC Plumbing' })
    const waiting = cards(page).filter({ hasText: 'Home Depot' })
    await expect(waiting.getByTestId('request-next')).toContainText('Waiting on the client')
    await expect(waiting.getByRole('button', { name: 'View Request' })).toBeVisible()
    await expect(waiting.getByRole('button', { name: /Complete Request/ })).toHaveCount(0)

    const responded = cards(page).filter({ hasText: 'Bank deposit' })
    await expect(responded.getByRole('button', { name: 'Review Response' })).toBeVisible()
    await responded.getByRole('button', { name: 'Review Response' }).click()
    await expect(page.getByRole('button', { name: 'Complete Request' })).toBeVisible()
    await page.getByRole('button', { name: '← All requests' }).click()

    await waiting.getByRole('button', { name: 'View Request' }).click()
    await page.getByLabel('Follow-up message').fill('Just checking in on the receipt.')
    await page.getByRole('button', { name: 'Send Follow-Up' }).click()
    await expect(page.locator('.message-thread')).toContainText('Just checking in')
  })

  test('a draft is sent from its card, and a finished request completes', async ({ page }) => {
    await openRequests(page)
    await createRequest(page, 'ABC Plumbing', 'Lowes', 'Receipt for Lowes please.', false)
    await switcher(page).selectOption({ label: 'ABC Plumbing' })
    const draft = cards(page).filter({ hasText: 'Lowes please' })
    await expect(draft.getByTestId('request-next')).toContainText('send it to the client')
    await draft.getByRole('button', { name: 'Send Request' }).click()
    await page.getByRole('button', { name: 'Send Request' }).click()
    await page.getByRole('button', { name: '← All requests' }).click()
    await expect(cards(page).filter({ hasText: 'Lowes please' }).locator('.inbox-status')).toHaveText('Waiting for Client')

    await cards(page).filter({ hasText: 'Bank deposit' }).getByRole('button', { name: 'Review Response' }).click()
    await page.getByRole('button', { name: 'Complete Request' }).click()
    await expect(page.locator('.resolved-note')).toContainText('resolved')
  })

  test('document records show demo metadata and open their related request', async ({ page }) => {
    await openRequests(page)
    await switcher(page).selectOption({ label: 'Green Leaf Landscaping' })
    await page.getByTestId('document-row').first().getByRole('button', { name: 'View Document' }).click()
    const detail = page.getByTestId('document-detail')
    await expect(detail).toContainText('Demo metadata only')
    await expect(detail).toContainText('no file was uploaded or stored')
    await expect(detail).toContainText('No related request is on file')

    await createRequest(page, 'ABC Plumbing', 'Lowes', 'Receipt for Lowes please.')
    await switcher(page).selectOption({ label: 'ABC Plumbing' })
    await page.getByRole('button', { name: /^Simulated Client View/ }).click()
    await cards(page).filter({ hasText: 'Lowes please' }).getByRole('button', { name: 'View Request' }).click()
    await page.getByRole('button', { name: 'Upload simulated document' }).click()
    await page.getByRole('button', { name: '← All requests' }).click()
    await page.getByRole('button', { name: /^Bookkeeper View/ }).click()
    await page.getByTestId('document-row').filter({ hasText: 'receipt' }).getByRole('button', { name: 'View Document' }).click()
    await page.getByTestId('document-detail').getByRole('button', { name: 'Open Related Request' }).click()
    await expect(page.locator('.request-question')).toContainText('Lowes please')
  })

  test('opening a request from All clients selects its client', async ({ page }) => {
    await openRequests(page)
    await createRequest(page, 'Smith Construction', 'Northstar Electric', 'Receipt for Northstar please.')
    await switcher(page).selectOption({ label: 'All clients' })
    await cards(page).filter({ hasText: 'Northstar please' }).getByRole('button', { name: 'View Request' }).first().click()
    await expect(switcher(page).locator('option:checked')).toHaveText('Smith Construction')
    await expect(page.locator('.request-question')).toContainText('Northstar please')
  })

  test('a new request creates one Inbox item, and QuickBooks Sandbox has no create form', async ({ page }) => {
    await openRequests(page)
    await createRequest(page, 'ABC Plumbing', 'Lowes', 'Receipt for Lowes please.')
    await nav(page, /Inbox/).click()
    await page.locator('.filter-row').getByRole('button', { name: /^Client Requests/ }).click()
    await expect(page.locator('.inbox-row').filter({ hasText: 'Receipt for Lowes please.' })).toHaveCount(1)

    await nav(page, /Client Requests/).click()
    await page.locator('.global-source-area').getByRole('button', { name: /QuickBooks Sandbox/ }).click()
    await expect(page.getByRole('button', { name: 'New Request' })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Lowes please')
  })
})
