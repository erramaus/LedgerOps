// Demo-only books for the ABC Plumbing demo client (May to August 2026). This is fixture INPUT: every balance,
// total and report figure shown in the app is calculated from it by shared/accounting.ts, never typed in.
// It is only ever used when the data source is Demo Data; QuickBooks mode never reads it.
import type { AccountKind as ReconKind, Direction } from './reconciliation.js'
import type { JournalEntry, JournalLine, LedgerAccountDef, OpenItem } from './accounting.js'
import { periodEnd, periodStart, previousPeriod, type Period } from './period.js'

export const DEMO_CLIENT_ID = 'abc-plumbing'
export const DEMO_CLIENT_NAME = 'ABC Plumbing'
export const DEMO_PERIODS: Period[] = [
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
  { year: 2026, month: 8 },
]

// Statement rows used by the reconciliation demo. Kept here so the ledger and the reconciliation can never disagree.
// [id, book date, payee, dollars, direction, bank statement description, statement date]
export const demoCheckingRows = [
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
// [id, book date, payee, dollars, statement description, statement date, in the books?]
export const demoCardRows = [
  ['rec-card-1', '2026-08-03', 'Amazon Business', 112.45, 'AMAZON BUSINESS', '2026-08-03', true],
  ['rec-card-2', '2026-08-08', 'Home Depot', 224.2, 'HOME DEPOT #4411', '2026-08-08', false],
  ['rec-card-3', '2026-08-12', 'Adobe', 59.99, 'ADOBE SYSTEMS', '2026-08-12', true],
  ['rec-card-4', '2026-08-18', 'BuildPro Training', 225, 'BUILDPRO TRAINING', '2026-08-19', true],
  ['rec-card-5', '2026-08-24', 'Fuel Rewards', 88.66, 'FUEL REWARDS NETWORK', '2026-08-24', true],
] as const

export const demoChartOfAccounts: LedgerAccountDef[] = [
  { id: 'checking', name: 'Chase Business Checking', klass: 'asset', kind: 'bank', cashFlow: 'cash' },
  { id: 'undeposited', name: 'Undeposited Funds', klass: 'asset', cashFlow: 'operating' },
  { id: 'ar', name: 'Accounts Receivable', klass: 'asset', kind: 'ar', cashFlow: 'operating' },
  { id: 'equipment', name: 'Equipment', klass: 'asset', cashFlow: 'investing' },
  { id: 'ap', name: 'Accounts Payable', klass: 'liability', kind: 'ap', cashFlow: 'operating' },
  { id: 'card', name: 'Chase Business Credit Card', klass: 'liability', kind: 'credit_card', cashFlow: 'operating' },
  { id: 'equity', name: "Owner's Equity", klass: 'equity', cashFlow: 'financing' },
  { id: 'income', name: 'Service Income', klass: 'income' },
  { id: 'materials', name: 'Materials', klass: 'cogs' },
  { id: 'payroll', name: 'Payroll', klass: 'expense' },
  { id: 'fuel', name: 'Fuel', klass: 'expense' },
  { id: 'utilities', name: 'Utilities', klass: 'expense' },
  { id: 'insurance', name: 'Insurance', klass: 'expense' },
  { id: 'office', name: 'Office Supplies', klass: 'expense' },
  { id: 'software', name: 'Software', klass: 'expense' },
  { id: 'training', name: 'Training', klass: 'expense' },
  { id: 'vehicle', name: 'Vehicle Expense', klass: 'expense' },
  { id: 'shipping', name: 'Shipping', klass: 'expense' },
  { id: 'tools', name: 'Small Tools', klass: 'expense' },
  { id: 'uncategorized', name: 'Uncategorized Expense', klass: 'expense' },
]

/** Maps a ledger account to the reconciliation account id the Reconcile tab uses. */
export const DEMO_RECONCILIATION_ACCOUNTS = [
  { id: 'chase-checking', ledgerId: 'checking', name: 'Chase Business Checking', kind: 'bank' as ReconKind },
  { id: 'chase-card', ledgerId: 'card', name: 'Chase Business Credit Card', kind: 'credit_card' as ReconKind },
]

const cents = (dollars: number) => Math.round(dollars * 100)
const dr = (accountId: string, dollars: number): JournalLine => ({ accountId, debitCents: cents(dollars), creditCents: 0 })
const cr = (accountId: string, dollars: number): JournalLine => ({ accountId, debitCents: 0, creditCents: cents(dollars) })
const entry = (id: string, date: string, memo: string, ...lines: JournalLine[]): JournalEntry => ({ id, date, memo, lines })

type Document = { id: string; party: string; number: string; date: string; dueDate: string; amount: number; account: string; payments: { date: string; amount: number; depositTo: string }[] }

export const demoInvoiceDocuments: Document[] = [
  { id: 'invoice-0901', party: 'Westview Apartments', number: 'INV-0901', date: '2026-05-05', dueDate: '2026-06-04', amount: 9000, account: 'income', payments: [{ date: '2026-05-20', amount: 9000, depositTo: 'checking' }] },
  { id: 'invoice-0902', party: 'Oak Street Properties', number: 'INV-0902', date: '2026-06-03', dueDate: '2026-07-03', amount: 11000, account: 'income', payments: [{ date: '2026-06-24', amount: 11000, depositTo: 'checking' }] },
  { id: 'invoice-0903', party: 'Pinecrest HOA', number: 'INV-0903', date: '2026-07-02', dueDate: '2026-08-01', amount: 12000, account: 'income', payments: [{ date: '2026-07-30', amount: 12000, depositTo: 'checking' }] },
  { id: 'invoice-1003', party: 'Riverside Retail', number: 'INV-1003', date: '2026-07-28', dueDate: '2026-08-27', amount: 2840, account: 'income', payments: [] },
  { id: 'invoice-1001', party: 'Westview Apartments', number: 'INV-1001', date: '2026-08-01', dueDate: '2026-08-31', amount: 4200, account: 'income', payments: [{ date: '2026-08-12', amount: 4200, depositTo: 'undeposited' }] },
  { id: 'invoice-1002', party: 'Oak Street Properties', number: 'INV-1002', date: '2026-08-05', dueDate: '2026-09-04', amount: 3150, account: 'income', payments: [{ date: '2026-08-20', amount: 1200, depositTo: 'undeposited' }] },
  { id: 'invoice-1004', party: 'Pinecrest HOA', number: 'INV-1004', date: '2026-08-16', dueDate: '2026-09-15', amount: 1980, account: 'income', payments: [] },
  { id: 'invoice-1005', party: 'Harbor Office Park', number: 'INV-1005', date: '2026-08-22', dueDate: '2026-09-21', amount: 1650, account: 'income', payments: [] },
]

export const demoBillDocuments: Document[] = [
  { id: 'bill-2001', party: 'Home Depot', number: 'HD-88321', date: '2026-08-18', dueDate: '2026-09-17', amount: 1284, account: 'materials', payments: [] },
  { id: 'bill-2002', party: 'ABC Supply Co.', number: 'ABC-4418', date: '2026-08-12', dueDate: '2026-09-11', amount: 860, account: 'materials', payments: [] },
  { id: 'bill-2003', party: 'Verizon Business', number: 'VB-081026', date: '2026-08-10', dueDate: '2026-09-10', amount: 126.44, account: 'utilities', payments: [] },
  { id: 'bill-2004', party: 'State Farm', number: 'SF-0826', date: '2026-08-01', dueDate: '2026-08-15', amount: 286, account: 'insurance', payments: [] },
  // The owner paid this one personally, so it is settled against owner's equity rather than a bank account.
  { id: 'bill-2005', party: 'UPS', number: 'UPS-7734', date: '2026-08-04', dueDate: '2026-08-25', amount: 210, account: 'shipping', payments: [{ date: '2026-08-20', amount: 210, depositTo: 'equity' }] },
]

const toOpenItem = (document: Document): OpenItem => ({
  id: document.id, party: document.party, number: document.number, date: document.date, dueDate: document.dueDate, amountCents: cents(document.amount),
  payments: document.payments.map((payment) => ({ date: payment.date, amountCents: cents(payment.amount) })),
})
export const demoReceivableItems = (): OpenItem[] => demoInvoiceDocuments.map(toOpenItem)
export const demoPayableItems = (): OpenItem[] => demoBillDocuments.map(toOpenItem)

const checkingAccountFor: Record<string, string> = {
  'Home Depot': 'materials', Shell: 'fuel', Verizon: 'utilities', Grainger: 'tools', 'City Water Department': 'utilities', 'Ace Hardware': 'materials',
  'Quick Lane': 'vehicle', "Lowe's": 'materials', 'State Farm': 'insurance', UPS: 'shipping', 'Office Depot': 'office', Payroll: 'payroll',
}
const cardAccountFor: Record<string, string> = { 'Amazon Business': 'office', Adobe: 'software', 'BuildPro Training': 'training', 'Fuel Rewards': 'fuel' }

/** Spending by check or card in May to July: [id, date, memo, account, dollars]. */
const history: { checking: [string, string, string, string, number][]; card: [string, string, string, string, number][]; cardPayments: [string, string, number][] } = {
  checking: [
    ['m05-1', '2026-05-10', 'Supplier payment', 'materials', 2500], ['m05-2', '2026-05-15', 'Payroll', 'payroll', 1800], ['m05-3', '2026-05-28', 'Utilities', 'utilities', 300],
    ['m06-1', '2026-06-08', 'Supplier payment', 'materials', 3100], ['m06-2', '2026-06-15', 'Payroll', 'payroll', 1800], ['m06-3', '2026-06-20', 'Utilities', 'utilities', 310], ['m06-4', '2026-06-22', 'Insurance', 'insurance', 286],
    ['m07-1', '2026-07-07', 'Payroll', 'payroll', 1800], ['m07-2', '2026-07-10', 'Supplier payment', 'materials', 2198], ['m07-3', '2026-07-17', 'Utilities', 'utilities', 320], ['m07-4', '2026-07-22', 'Insurance', 'insurance', 286], ['m07-5', '2026-07-24', 'Vehicle repairs', 'vehicle', 300],
  ],
  card: [
    ['c05-1', '2026-05-12', 'Fuel', 'fuel', 400], ['c05-2', '2026-05-18', 'Software subscription', 'software', 60],
    // This June charge has no category yet: a deliberate "missing information" demo scenario.
    ['c06-1', '2026-06-10', 'Fuel', 'fuel', 380], ['c06-2', '2026-06-14', 'Software subscription', 'software', 60], ['c06-3', '2026-06-21', 'Charge with no category', 'uncategorized', 150],
    ['c07-1', '2026-07-05', 'Fuel', 'fuel', 412.4], ['c07-2', '2026-07-09', 'Software subscription', 'software', 59.99], ['c07-3', '2026-07-13', 'Bulk materials', 'materials', 3200], ['c07-4', '2026-07-19', 'Training course', 'training', 400], ['c07-5', '2026-07-23', 'Office supplies', 'office', 401.81],
  ],
  cardPayments: [['cp-05', '2026-05-25', 1000], ['cp-06', '2026-06-26', 1500], ['cp-07', '2026-07-27', 500]],
}

export function buildDemoEntries(): JournalEntry[] {
  const entries: JournalEntry[] = [entry('opening', '2026-04-30', 'Beginning balances', dr('checking', 33000), dr('equipment', 12000), cr('card', 3000), cr('equity', 42000))]
  for (const document of demoInvoiceDocuments) {
    entries.push(entry(`${document.id}-issued`, document.date, `Invoice ${document.number} to ${document.party}`, dr('ar', document.amount), cr(document.account, document.amount)))
    document.payments.forEach((payment, index) => entries.push(entry(`${document.id}-paid-${index}`, payment.date, `Payment on ${document.number}`, dr(payment.depositTo, payment.amount), cr('ar', payment.amount))))
  }
  for (const document of demoBillDocuments) {
    entries.push(entry(`${document.id}-entered`, document.date, `Bill ${document.number} from ${document.party}`, dr(document.account, document.amount), cr('ap', document.amount)))
    document.payments.forEach((payment, index) => entries.push(entry(`${document.id}-paid-${index}`, payment.date, `Payment of ${document.number}`, dr('ap', payment.amount), cr(payment.depositTo, payment.amount))))
  }
  for (const [id, date, memo, account, dollars] of history.checking) entries.push(entry(id, date, memo, dr(account, dollars), cr('checking', dollars)))
  for (const [id, date, memo, account, dollars] of history.card) entries.push(entry(id, date, memo, dr(account, dollars), cr('card', dollars)))
  for (const [id, date, dollars] of history.cardPayments) entries.push(entry(id, date, 'Credit card payment', dr('card', dollars), cr('checking', dollars)))
  for (const [id, date, payee, dollars, direction] of demoCheckingRows) {
    entries.push(direction === 'increase' ? entry(id, date, payee, dr('checking', dollars), cr('undeposited', dollars)) : entry(id, date, payee, dr(checkingAccountFor[payee], dollars), cr('checking', dollars)))
  }
  for (const [id, date, payee, dollars, , , inBooks] of demoCardRows) {
    if (inBooks) entries.push(entry(id, date, payee, dr(cardAccountFor[payee], dollars), cr('card', dollars)))
  }
  return entries.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

export const demoLedger = { accounts: demoChartOfAccounts, entries: buildDemoEntries() }

export type RegisterTxn = { id: string; date: string; payee: string; memo: string; amountCents: number; direction: Direction }

/** The bank or card register for one month, derived from the ledger. */
export function demoRegister(ledgerId: 'checking' | 'card', period: Period): RegisterTxn[] {
  const start = periodStart(period), end = periodEnd(period)
  const register: RegisterTxn[] = []
  for (const item of demoLedger.entries) {
    if (item.id === 'opening' || item.date < start || item.date > end) continue
    const line = item.lines.find((candidate) => candidate.accountId === ledgerId)
    if (!line) continue
    const amountCents = line.debitCents || line.creditCents
    // A bank balance rises with debits; a card balance (money owed) rises with credits.
    const direction: Direction = ledgerId === 'checking' ? (line.debitCents > 0 ? 'increase' : 'decrease') : line.creditCents > 0 ? 'increase' : 'decrease'
    register.push({ id: item.id, date: item.date, payee: item.memo, memo: '', amountCents, direction })
  }
  return register
}

export const previousDemoPeriod = previousPeriod

/** The May to July register, so earlier reconciliations can still be checked against the books, as with a real account. */
export const demoEarlierRegister = (ledgerId: 'checking' | 'card'): RegisterTxn[] =>
  DEMO_PERIODS.filter((period) => !(period.year === 2026 && period.month === 8)).flatMap((period) => demoRegister(ledgerId, period))

/** Findings that a person (not the ledger) records during review: demo scenario inputs, not calculated figures. */
export type DemoPeriodReview = { possibleDuplicates: number; missingReceipts: number; missingPayees: number; openClientRequests: number; note: string }
export const demoPeriodReviews: Record<string, DemoPeriodReview> = {
  '2026-05': { possibleDuplicates: 0, missingReceipts: 0, missingPayees: 0, openClientRequests: 0, note: 'Demo scenario: a month that was closed and then reopened.' },
  '2026-06': { possibleDuplicates: 1, missingReceipts: 3, missingPayees: 1, openClientRequests: 1, note: 'Demo scenario: a month with missing transaction information.' },
  '2026-07': { possibleDuplicates: 0, missingReceipts: 0, missingPayees: 0, openClientRequests: 0, note: 'Demo scenario: a month that is ready to close.' },
}
