import type { AccountKind, ReconTxn, StatementLine } from '../../shared/reconciliation'
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

const checking = [
  ['rec-checking-1', '2026-08-02', 'ABC Plumbing Customer', 5000, 'increase', 'DEPOSIT - CUSTOMER PAYMENT', '2026-08-02'],
  ['rec-checking-2', '2026-08-04', 'Home Depot', 341.22, 'decrease', 'HOME DEPOT #4411', '2026-08-04'],
  ['rec-checking-3', '2026-08-05', 'Shell', 82.41, 'decrease', 'SHELL OIL 5720', '2026-08-06'],
  ['rec-checking-4', '2026-08-07', 'Verizon', 126.44, 'decrease', 'VERIZON WIRELESS', '2026-08-07'],
  ['rec-checking-5', '2026-08-09', 'Grainger', 218.65, 'decrease', 'GRAINGER 8821', '2026-08-09'],
  ['rec-checking-6', '2026-08-11', 'City Water Department', 174.2, 'decrease', 'CITY WATER DEPT', '2026-08-12'],
  ['rec-checking-7', '2026-08-13', 'Ace Hardware', 96.37, 'decrease', 'ACE HARDWARE', '2026-08-13'],
  ['rec-checking-8', '2026-08-15', 'Quick Lane', 89.5, 'decrease', 'QUICK LANE TIRE', '2026-08-15'],
  ['rec-checking-9', '2026-08-17', "Lowe's", 412.06, 'decrease', "LOWE'S #1932", '2026-08-18'],
  ['rec-checking-10', '2026-08-20', 'State Farm', 286, 'decrease', 'STATE FARM INSURANCE', '2026-08-20'],
  ['rec-checking-11', '2026-08-22', 'UPS', 38.72, 'decrease', 'THE UPS STORE', '2026-08-22'],
  ['rec-checking-12', '2026-08-25', 'Office Depot', 73.45, 'decrease', 'OFFICE DEPOT 114', '2026-08-26'],
  ['rec-checking-13', '2026-08-29', 'Payroll', 1639.26, 'decrease', 'PAYROLL BATCH', '2026-08-29'],
] as const

// The card statement lists a Home Depot charge that is not in the books, so it does not balance.
const card = [
  ['rec-card-1', '2026-08-03', 'Amazon Business', 112.45, 'AMAZON BUSINESS', '2026-08-03', true],
  ['rec-card-2', '2026-08-08', 'Home Depot', 224.2, 'HOME DEPOT #4411', '2026-08-08', false],
  ['rec-card-3', '2026-08-12', 'Adobe', 59.99, 'ADOBE SYSTEMS', '2026-08-12', true],
  ['rec-card-4', '2026-08-18', 'BuildPro Training', 225, 'BUILDPRO TRAINING', '2026-08-19', true],
  ['rec-card-5', '2026-08-24', 'Fuel Rewards', 88.66, 'FUEL REWARDS NETWORK', '2026-08-24', true],
] as const

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
