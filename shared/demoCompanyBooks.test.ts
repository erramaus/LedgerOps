import { describe, expect, it } from 'vitest'
import { balanceAt, validateLedger } from './accounting'
import { demoReport } from './demoMonthEnd'
import { ADDITIONAL_DEMO_CLIENT_IDS, OTHER_DEMO_COMPANIES, validateAdditionalDemoCompanies } from './demoCompanyBooks'
import { buildAdditionalDemoMonthEndRecords, buildAdditionalDemoReconciliations } from './demoMonthEnd'

const AUGUST = { start: '2026-08-01', end: '2026-08-31', label: 'August 2026' }

function signedStatementCents(lines: { direction: 'increase' | 'decrease'; amountCents: number }[]) {
  return lines.reduce((sum, line) => sum + (line.direction === 'increase' ? line.amountCents : -line.amountCents), 0)
}

describe('additional company fixture accounting', () => {
  it('Green Leaf has a seeded reconciliation history and a separate Month End record for each of its six periods', () => {
    const reconciliations = buildAdditionalDemoReconciliations().filter((record) => record.clientId === 'green-leaf-landscaping')
    const months = buildAdditionalDemoMonthEndRecords().filter((record) => record.clientId === 'green-leaf-landscaping')
    expect(reconciliations).toHaveLength(10)
    expect(reconciliations.every((record) => record.status === 'completed' && record.result?.differenceCents === 0)).toBe(true)
    expect(new Set(reconciliations.map((record) => record.periodEnd.slice(0, 7)))).toEqual(new Set(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']))
    expect(reconciliations.filter((record) => record.accountId === 'green-leaf-landscaping-card').map((record) => record.periodEnd.slice(0, 7))).not.toContain('2026-08')
    expect(reconciliations.some((record) => record.accountId === 'green-leaf-landscaping-checking' && record.periodEnd === '2026-08-31')).toBe(false)
    expect(months.map((record) => record.period).sort()).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
    expect(months.every((record) => record.status === 'open' && record.clientName === 'Green Leaf Landscaping')).toBe(true)
  })

  it('Smith Construction keeps principal separate from interest and leaves its real July/August reconciliation exceptions open', () => {
    const smith = OTHER_DEMO_COMPANIES.find((company) => company.clientId === 'smith-construction')!
    const reconciliations = buildAdditionalDemoReconciliations().filter((record) => record.clientId === smith.clientId)
    const loanPayment = smith.ledger.entries.find((entry) => entry.id === 'smith-construction-loan-payment-202606')!
    expect(loanPayment.lines).toEqual([
      { accountId: 'loan', debitCents: 74_000, creditCents: 0 },
      { accountId: 'interest', debitCents: 35_000, creditCents: 0 },
      { accountId: 'checking', debitCents: 0, creditCents: 109_000 },
    ])
    expect(reconciliations).toHaveLength(10)
    expect(reconciliations.find((record) => record.accountId === 'smith-construction-checking' && record.periodEnd === '2026-07-31')?.result?.outstandingDecreaseCents).toBeGreaterThan(0)
    expect(reconciliations.some((record) => record.accountId === 'smith-construction-card' && record.periodEnd === '2026-08-31')).toBe(false)
    expect(reconciliations.every((record) => record.result?.differenceCents === 0)).toBe(true)
  })

  it('Johnson Dental has a June missing-receipt task and an unreconciled August bank fee in its statement', () => {
    const johnson = OTHER_DEMO_COMPANIES.find((company) => company.clientId === 'johnson-dental')!
    expect(johnson.reviewScenarios['2026-06'].missingReceipts).toBe(1)
    const augustChecking = johnson.statements.find((statement) => statement.accountId === 'johnson-dental-checking' && statement.period.month === 8)!
    expect(augustChecking.statementLines.some((line) => line.description === 'BANK SERVICE FEE' && line.amountCents === 1_850 && line.direction === 'decrease')).toBe(true)
    expect(buildAdditionalDemoReconciliations().some((record) => record.clientId === johnson.clientId && record.accountId === 'johnson-dental-checking' && record.periodEnd === '2026-08-31')).toBe(false)
    expect(johnson.invoices[5].party).toBe('Cedar Dental Plan')
    expect(johnson.bills[5].party).toBe('Northstar Office Supply')
  })

  it('Acme Consulting has a June bank-fee discrepancy and July duplicate-looking fuel entries', () => {
    const acme = OTHER_DEMO_COMPANIES.find((company) => company.clientId === 'acme-consulting')!
    expect(acme.reviewScenarios['2026-07'].possibleDuplicates).toBe(1)
    const julyFuel = acme.transactions.filter((transaction) => transaction.date.startsWith('2026-07') && transaction.description === 'Management Consulting vehicle fuel')
    expect(julyFuel).toHaveLength(3)
    expect(julyFuel[1].amountCents).toBe(julyFuel[2].amountCents)
    const juneChecking = acme.statements.find((statement) => statement.accountId === 'acme-consulting-checking' && statement.period.month === 6)!
    expect(juneChecking.statementLines.some((line) => line.description === 'BANK SERVICE FEE' && line.amountCents === 1_850)).toBe(true)
    expect(buildAdditionalDemoReconciliations().some((record) => record.clientId === acme.clientId && record.accountId === 'acme-consulting-checking' && record.periodEnd === '2026-06-30')).toBe(false)
  })

  it('contains four distinct companies with six consecutive March-to-August periods', () => {
    expect(ADDITIONAL_DEMO_CLIENT_IDS).toEqual(['green-leaf-landscaping', 'smith-construction', 'johnson-dental', 'acme-consulting'])
    for (const company of OTHER_DEMO_COMPANIES) {
      expect(company.periods.map((period) => `${period.year}-${String(period.month).padStart(2, '0')}`)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
      expect(new Set(company.ledger.accounts.map((account) => account.name)).size).toBe(company.ledger.accounts.length)
      expect(company.reconciliationAccounts).toHaveLength(2)
      expect(company.invoices).toHaveLength(6)
      expect(company.bills).toHaveLength(6)
      expect(company.transactions.length).toBeGreaterThan(40)
    }
  })

  it('balances every journal and satisfies the Balance Sheet, AR and AP control checks', () => {
    for (const result of validateAdditionalDemoCompanies()) {
      const company = OTHER_DEMO_COMPANIES.find((item) => item.clientId === result.clientId)!
      expect(result.ledgerIssues, result.clientId).toEqual([])
      expect(result.balanceSheet.checks.find((check) => check.id === 'bs-balanced')?.status, result.clientId).toBe('pass')
      expect(result.arLedgerCents, result.clientId).toBe(result.arAgingCents)
      expect(result.apLedgerCents, result.clientId).toBe(result.apAgingCents)
      expect(validateLedger(company.ledger.accounts, company.ledger.entries), result.clientId).toEqual([])
    }
  })

  it('recalculates all August statements from each company ledger', () => {
    for (const company of OTHER_DEMO_COMPANIES) {
      for (const reportId of ['profit-loss', 'balance-sheet', 'cash-flow', 'trial-balance', 'general-ledger', 'ar-aging', 'ap-aging'] as const) {
        const report = demoReport(reportId, AUGUST, company.ledger)
        expect(report.checks.every((check) => check.status === 'pass'), `${company.clientName} ${reportId}: ${report.checks.filter((check) => check.status !== 'pass').map((check) => check.detail).join(' ')}`).toBe(true)
      }
    }
  })

  it('derives each monthly statement ending from its statement lines and opening balance', () => {
    for (const company of OTHER_DEMO_COMPANIES) {
      for (const statement of company.statements) {
        expect(statement.beginningCents + signedStatementCents(statement.statementLines), `${company.clientName} ${statement.id}`).toBe(statement.endingCents)
        expect(statement.transactions.every((transaction) => transaction.amountCents > 0)).toBe(true)
      }
    }
  })

  it('posts customer receipts against AR and vendor payments against AP, never as income or expense', () => {
    for (const company of OTHER_DEMO_COMPANIES) {
      const invoicePayment = company.ledger.entries.find((entry) => entry.id.includes('-receipt-'))!
      const billPayment = company.ledger.entries.find((entry) => entry.id.includes('-billpay-'))!
      expect(invoicePayment.lines.map((line) => line.accountId).sort()).toEqual(['ar', 'checking'])
      expect(billPayment.lines.map((line) => line.accountId).sort()).toEqual(['ap', 'checking'])
      expect(invoicePayment.lines.some((line) => line.accountId === 'income')).toBe(false)
      expect(billPayment.lines.some((line) => line.accountId === 'cogs')).toBe(false)
    }
  })

  it('uses distinct account names and payment parties for each industry', () => {
    const names = OTHER_DEMO_COMPANIES.map((company) => company.ledger.accounts.find((account) => account.id === 'checking')!.name)
    expect(new Set(names).size).toBe(4)
    for (const company of OTHER_DEMO_COMPANIES) {
      expect(company.invoices.every((invoice) => invoice.party.length > 0)).toBe(true)
      expect(company.bills.every((bill) => bill.party.length > 0)).toBe(true)
      expect(balanceAt(company.ledger.accounts, company.ledger.entries, 'checking', '2026-08-31')).toBeGreaterThan(0)
    }
  })
})
