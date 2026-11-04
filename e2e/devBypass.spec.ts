import { expect, test } from '@playwright/test'
import { mockApp } from './support'

test.describe('local development auth bypass (server-reported)', () => {
  test('opens straight to the Dashboard with all five demo companies, and QuickBooks 401s do not eject the session', async ({ page }) => {
    await mockApp(page, { devBypass: true })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0)
    for (const name of ['ABC Plumbing', 'Green Leaf Landscaping', 'Smith Construction', 'Johnson Dental', 'Acme Consulting']) {
      await expect(page.locator('.client-card').filter({ hasText: name })).toBeVisible()
    }
  })

  test('without the server-reported bypass the sign-in screen is still shown', async ({ page }) => {
    await mockApp(page, { authenticated: false })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in securely/i })).toBeVisible()
  })
})
