import type { AccountKind, ReconTxn, StatementLine } from '../../shared/reconciliation'
import { demoCardRows, demoCheckingRows } from '../../shared/demoBooks'
import type { ReconciliationAccount } from './demoData'

// Demo input data only. Every balance, total and difference shown in the app is calculated from it.
export type DemoReconSource = {
  id: string
  name: string
  kind: AccountKind
  periodStart: string
  periodEnd: string
  statementDate: string
  beginningCents: number
  endingCents: number
  lastReconciled: string
  /** What the books (QuickBooks-style register) contain. */
  transactions: ReconTxn[]
  /** What the demo bank statement lists. */
  statementLines: StatementLine[]
}

const t = (id: string, date: string, payee: string, dollars: number, direction: ReconTxn['direction']): ReconTxn => ({ id, date, payee, memo: '', amountCents: Math.round(dollars * 100), direction })
const l = (id: string, date: string, description: string, dollars: number, direction: StatementLine['direction']): StatementLine => ({ id, date, description, amountCents: Math.round(dollars * 100), direction })

const checking = demoCheckingRows

const card = demoCardRows

export const demoReconSources: DemoReconSource[] = [
  {
    id: 'chase-checking', name: 'Chase Business Checking', kind: 'bank', periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31',
    beginningCents: 4_700_000, endingCents: 4_842_172, lastReconciled: 'July 31, 2026',
    transactions: checking.map(([id, date, payee, amount, direction]) => t(id, date, payee, amount, direction)),
    statementLines: checking.map(([id, , , amount, direction, description, statementDate], index) => l(`line-${index + 1}`, statementDate, description, amount, direction)),
  },
  {
    id: 'chase-card', name: 'Chase Business Credit Card', kind: 'credit_card', periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31',
    beginningCents: 552_420, endingCents: 623_450, lastReconciled: 'July 31, 2026',
    transactions: card.filter((row) => row[6]).map(([id, date, payee, amount]) => t(id, date, payee, amount, 'increase')),
    statementLines: card.map(([, , , amount, description, statementDate], index) => l(`line-${index + 1}`, statementDate, description, amount, 'increase')),
  },
]

const displayDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** The shape the work queue expects, derived from the same inputs rather than typed in. */
export const reconciliationAccounts: ReconciliationAccount[] = demoReconSources.map((source) => {
  const bookCents = source.beginningCents + source.transactions.reduce((total, item) => total + (item.direction === 'increase' ? item.amountCents : -item.amountCents), 0)
  return {
    id: source.id,
    name: source.name,
    lastReconciled: source.lastReconciled,
    statementEnding: longDate(source.periodEnd),
    quickBooksBalance: bookCents / 100,
    statementBalance: source.endingCents / 100,
    status: bookCents === source.endingCents ? 'Ready to complete' : 'Difference to resolve',
    transactions: source.transactions.map((item) => ({
      id: item.id, date: displayDate(item.date), payee: item.payee, amount: item.amountCents / 100,
      type: item.direction === 'increase' && source.kind === 'bank' ? 'Deposit' : 'Withdrawal', cleared: true,
    })),
  }
})
