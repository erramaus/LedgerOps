import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { createAuthorizationUrl, exchangeCode, getAccounts, getBills, getCompanyInfo, getConnectionStatus, getCustomers, getFinancialReport, getInvoices, getTransactions, getVendors, updateTransactionAccount } from './quickbooks.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const allowedOrigins = new Set(['http://localhost:5173', 'https://Erramaus.github.io', frontendUrl, (() => { try { return new URL(frontendUrl).origin } catch { return frontendUrl } })()])
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }))
app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'LedgerOps API' })
})

app.get('/api/quickbooks/connect', (_request, response) => {
  try {
    response.redirect(createAuthorizationUrl())
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to start QuickBooks connection.' })
  }
})

app.get('/api/quickbooks/callback', async (request, response) => {
  const { code, state, realmId, error } = request.query
  if (error) return response.status(400).send(`QuickBooks authorization failed: ${String(error)}`)
  if (typeof code !== 'string' || typeof state !== 'string' || typeof realmId !== 'string') return response.status(400).send('QuickBooks callback is missing required values.')

  try {
    await exchangeCode(code, state, realmId)
    response.redirect(`${frontendUrl.replace(/\/$/, '')}/?quickbooks=connected`)
  } catch (callbackError) {
    response.status(500).send(callbackError instanceof Error ? callbackError.message : 'Unable to finish QuickBooks connection.')
  }
})

app.get('/api/quickbooks/status', (_request, response) => {
  response.json(getConnectionStatus())
})

app.get('/api/quickbooks/company', async (_request, response) => {
  try {
    response.json(await getCompanyInfo())
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load company information.' })
  }
})

app.get('/api/quickbooks/transactions', async (_request, response) => {
  try {
    response.json({ transactions: await getTransactions() })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load QuickBooks transactions.' })
  }
})

app.post('/api/quickbooks/transactions/:transactionType/:transactionId/account', async (request, response) => {
  const { transactionType, transactionId } = request.params
  const accountName = request.body?.accountName
  if (typeof accountName !== 'string' || !accountName.trim()) return response.status(400).json({ error: 'An account name is required.' })
  try {
    response.json(await updateTransactionAccount(transactionType, transactionId, accountName))
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update QuickBooks transaction.' })
  }
})

app.get('/api/quickbooks/accounts', async (_request, response) => {
  try {
    response.json({ accounts: await getAccounts() })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load QuickBooks accounts.' })
  }
})

app.get('/api/quickbooks/customers', async (_request, response) => {
  try { response.json({ customers: await getCustomers() }) } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load QuickBooks customers.' }) }
})

app.get('/api/quickbooks/vendors', async (_request, response) => {
  try { response.json({ vendors: await getVendors() }) } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load QuickBooks vendors.' }) }
})

app.get('/api/quickbooks/invoices', async (_request, response) => {
  try { response.json({ invoices: await getInvoices() }) } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load QuickBooks invoices.' }) }
})

app.get('/api/quickbooks/bills', async (_request, response) => {
  try { response.json({ bills: await getBills() }) } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load QuickBooks bills.' }) }
})

app.get('/api/quickbooks/reports/:report', async (request, response) => {
  const report = request.params.report
  if (report !== 'profit-loss' && report !== 'balance-sheet' && report !== 'cash-flow') return response.status(404).json({ error: 'Unsupported QuickBooks report.' })
  const period = typeof request.query.period === 'string' ? request.query.period : 'This Month'
  try { response.json(await getFinancialReport(report, period)) } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load QuickBooks report.' }) }
})

app.listen(port, () => {
  console.log(`LedgerOps backend listening on port ${port}`)
})
