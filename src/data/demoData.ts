import { demoClientFigures } from '../../shared/demoMonthEnd'
import { DEMO_CLIENT_ID } from '../../shared/demoBooks'
import { formatCents } from '../../shared/reconciliation'

export type Client = {
  id: string
  name: string
  initials: string
  status: string
  month: string
  attention: number
  reconciliation: string
  monthEnd: number
  income: string
  expenses: string
  profit: string
  bankBalance: string
  accountsReceivable: string
  accountsPayable: string
}

export type WorkItem = {
  title: string
  client: string
  detail: string
  tone: 'red' | 'amber' | 'blue'
}

export type TransactionStatus = 'Needs Review' | 'Categorized' | 'Matched' | 'Needs Receipt'

/** One expense line of a transaction. Split transactions have several, each with its own category. */
export type TransactionLine = {
  id: string
  description: string
  amount: number
  category: string
  categoryId?: string
}

export type Transaction = {
  id: string
  date: string
  payee: string
  description: string
  amount: string
  category: string
  status: TransactionStatus
  suggestedCategory?: string
  confidence?: number
  /** The bank or card the money moved through, not the category. */
  account?: string
  /** When absent the transaction is treated as a single line using `category`. */
  lines?: TransactionLine[]
  clientId?: string
}

export type ReconciliationTransaction = {
  id: string
  date: string
  payee: string
  amount: number
  type: 'Deposit' | 'Withdrawal'
  cleared: boolean
}

export type ReconciliationAccount = {
  id: string
  name: string
  lastReconciled: string
  statementEnding: string
  quickBooksBalance: number
  statementBalance: number
  status: string
  transactions: ReconciliationTransaction[]
  possibleProblems?: string[]
}

export type MonthEndStatus = 'Complete' | 'Needs Attention' | 'Not Started' | 'Not Available'

export type MonthEndItem = {
  id: string
  label: string
  status: MonthEndStatus
  explanation?: string
  relatedView?: 'Transactions' | 'Reconcile' | 'Receivables' | 'Payables' | 'Reports' | 'Client Requests'
  relatedLabel?: string
}

export type InboxType = 'Transaction' | 'Missing Receipt' | 'Client Question' | 'Reconciliation' | 'Bill' | 'Invoice' | 'Month End'

export type InboxItem = {
  id: string
  client: string
  type: InboxType
  description: string
  priority: 'High' | 'Medium' | 'Low'
  date: string
  status: 'Open' | 'Answered' | 'Resolved'
  destination: 'Transactions' | 'Reconcile' | 'Receivables' | 'Payables' | 'Month End' | 'Client Requests'
  requestId?: string
}

export type ClientRequestStatus = 'Draft' | 'Sent' | 'Waiting for Client' | 'Client Responded' | 'Completed' | 'Needs Follow-Up'
export type ClientRequestType = 'Missing Receipt' | 'Transaction Question' | 'Statement Request' | 'Invoice Request' | 'Custom Question'
export type ClientRequestPriority = 'High' | 'Medium' | 'Low'
export type RequestSender = 'Bookkeeper' | 'Client'
export type ClientDocumentType = 'Receipt' | 'Bank Statement' | 'Credit Card Statement' | 'Vendor Invoice' | 'Customer Invoice' | 'Tax Document' | 'Other Supporting Document'
export type ClientDocumentReviewStatus = 'Pending Review' | 'Approved' | 'Rejected'
export type ReceiptMatchStatus = 'Unmatched' | 'Suggested' | 'Matched'

export type ClientRequestMessage = {
  id: string
  sender: RequestSender
  senderLabel: string
  sentAt: string
  message: string
  documentIds?: string[]
}

export type ClientDocument = {
  id: string
  client: string
  clientId: string
  name: string
  type: ClientDocumentType
  date: string
  uploadedAt: string
  uploadedBy: RequestSender
  fixtureId: string
  relatedTransactionId?: string
  relatedTransaction?: string
  relatedAmount?: string
  vendor?: string
  amount?: string
  reviewStatus: ClientDocumentReviewStatus
  matchStatus?: ReceiptMatchStatus
  matchedTransactionId?: string
  requestId?: string
  notes?: string
}

export type ClientRequest = {
  id: string
  client: string
  clientId?: string
  requestType: ClientRequestType
  dateCreated: string
  dueDate?: string
  priority?: ClientRequestPriority
  relatedTransactionId?: string
  relatedTransaction?: string
  relatedAmount?: string
  question: string
  status: ClientRequestStatus
  answer?: string
  quickBooksId?: string
  transactionType?: string
  payee?: string
  transactionDate?: string
  amount?: string
  currentCategory?: string
  responseCategory?: string
  requestedDocumentType?: ClientDocumentType
  documentIds?: string[]
  messages?: ClientRequestMessage[]
  reviewNotes?: string
}

export type InvoiceStatus = 'Open' | 'Overdue' | 'Partially Paid' | 'Paid'

export type Invoice = {
  id: string
  customer: string
  number: string
  invoiceDate: string
  dueDate: string
  amount: number
  amountPaid: number
  status: InvoiceStatus
}

export type BillStatus = 'Open' | 'Due Soon' | 'Overdue' | 'Partially Paid' | 'Paid' | 'Needs Review'

export type Bill = {
  id: string
  vendor: string
  number: string
  billDate: string
  dueDate: string
  amount: number
  amountPaid: number
  category: string
  status: BillStatus
}

// Calculated from the demo ledger so the dashboard can never disagree with the reports.
const demoAugust = demoClientFigures({ year: 2026, month: 8 })

export const demoClient: Client = {
  id: 'abc-plumbing',
  name: 'ABC Plumbing',
  initials: 'AB',
  status: 'Needs attention',
  month: 'August 2026',
  attention: 6,
  reconciliation: 'Ready to complete',
  monthEnd: 90,
  income: formatCents(demoAugust.incomeCents),
  expenses: formatCents(demoAugust.expensesCents),
  profit: formatCents(demoAugust.profitCents),
  bankBalance: formatCents(demoAugust.bankBalanceCents),
  accountsReceivable: formatCents(demoAugust.receivableCents),
  accountsPayable: formatCents(demoAugust.payableCents),
}

export const clients: Client[] = [
  demoClient,
  {
    id: 'green-leaf-landscaping',
    name: 'Green Leaf Landscaping',
    initials: 'GL',
    status: 'On track',
    month: 'August 2026',
    attention: 2,
    reconciliation: 'Complete',
    monthEnd: 100,
    income: '$61,400',
    expenses: '$38,920',
    profit: '$22,480',
    bankBalance: '$35,810.44',
    accountsReceivable: '$8,420',
    accountsPayable: '$3,180',
  },
  {
    id: 'smith-construction',
    name: 'Smith Construction',
    initials: 'SC',
    status: 'Needs attention',
    month: 'August 2026',
    attention: 9,
    reconciliation: 'Needs review',
    monthEnd: 72,
    income: '$126,780',
    expenses: '$94,610',
    profit: '$32,170',
    bankBalance: '$67,244.18',
    accountsReceivable: '$24,600',
    accountsPayable: '$18,450',
  },
  {
    id: 'johnson-dental',
    name: 'Johnson Dental',
    initials: 'JD',
    status: 'On track',
    month: 'August 2026',
    attention: 1,
    reconciliation: 'Complete',
    monthEnd: 96,
    income: '$92,350',
    expenses: '$58,240',
    profit: '$34,110',
    bankBalance: '$52,987.03',
    accountsReceivable: '$6,780',
    accountsPayable: '$4,210',
  },
  {
    id: 'acme-consulting',
    name: 'Acme Consulting',
    initials: 'AC',
    status: 'Waiting on client',
    month: 'August 2026',
    attention: 4,
    reconciliation: 'Waiting on statement',
    monthEnd: 84,
    income: '$73,900',
    expenses: '$29,480',
    profit: '$44,420',
    bankBalance: '$41,205.67',
    accountsReceivable: '$15,200',
    accountsPayable: '$2,940',
  },
]

const baseTransactions: Transaction[] = [
  { id: 'txn-001', date: 'Aug 29, 2026', payee: 'Amazon', description: 'Office supplies and shipping materials', amount: '$47.82', category: 'Uncategorized', status: 'Needs Review', suggestedCategory: 'Office Supplies', confidence: 94 },
  { id: 'txn-002', date: 'Aug 28, 2026', payee: 'Home Depot', description: 'PVC pipe and plumbing fittings', amount: '$341.22', category: 'Uncategorized', status: 'Needs Review', suggestedCategory: 'Materials', confidence: 97 },
  { id: 'txn-003', date: 'Aug 27, 2026', payee: 'Shell', description: 'Truck fuel', amount: '$82.41', category: 'Fuel', status: 'Categorized' },
  { id: 'txn-004', date: 'Aug 26, 2026', payee: 'Adobe', description: 'Creative Cloud monthly subscription', amount: '$59.99', category: 'Software', status: 'Matched' },
  { id: 'txn-005', date: 'Aug 25, 2026', payee: 'Verizon', description: 'Business mobile phone service', amount: '$126.44', category: 'Utilities', status: 'Categorized' },
  { id: 'txn-006', date: 'Aug 24, 2026', payee: 'Grainger', description: 'Safety gloves and jobsite tools', amount: '$218.65', category: 'Uncategorized', status: 'Needs Receipt', suggestedCategory: 'Equipment', confidence: 89 },
  { id: 'txn-007', date: 'Aug 23, 2026', payee: 'City Water Department', description: 'Commercial water and sewer bill', amount: '$174.20', category: 'Utilities', status: 'Matched' },
  { id: 'txn-008', date: 'Aug 22, 2026', payee: 'Ace Hardware', description: 'Replacement valves and connectors', amount: '$96.37', category: 'Materials', status: 'Categorized' },
  { id: 'txn-009', date: 'Aug 20, 2026', payee: 'Quick Lane', description: 'Oil change for service van', amount: '$89.50', category: 'Vehicle Expense', status: 'Matched' },
  { id: 'txn-010', date: 'Aug 19, 2026', payee: 'The Corner Cafe', description: 'Lunch with commercial property client', amount: '$64.18', category: 'Uncategorized', status: 'Needs Review', suggestedCategory: 'Meals', confidence: 86 },
  { id: 'txn-011', date: 'Aug 17, 2026', payee: 'Lowe\'s', description: 'Copper tubing and solder', amount: '$412.06', category: 'Materials', status: 'Matched' },
  { id: 'txn-012', date: 'Aug 15, 2026', payee: 'State Farm', description: 'Commercial vehicle insurance', amount: '$286.00', category: 'Insurance', status: 'Categorized' },
  { id: 'txn-013', date: 'Aug 13, 2026', payee: 'UPS', description: 'Parts delivery to jobsite', amount: '$38.72', category: 'Shipping', status: 'Needs Receipt' },
  { id: 'txn-014', date: 'Aug 10, 2026', payee: 'Office Depot', description: 'Printer paper and ink cartridges', amount: '$73.45', category: 'Office Supplies', status: 'Categorized' },
  { id: 'txn-015', date: 'Aug 05, 2026', payee: 'BuildPro Training', description: 'Backflow certification course', amount: '$225.00', category: 'Training', status: 'Matched' },
  { id: 'txn-016', date: 'Aug 21, 2026', payee: 'Costco Wholesale', description: 'Shop supplies and breakroom restock', amount: '$286.40', category: 'Split', status: 'Needs Review', account: 'Chase Business Credit Card', lines: [
    { id: 'txn-016-1', description: 'Printer paper and toner', amount: 120.4, category: 'Office Supplies' },
    { id: 'txn-016-2', description: 'Coffee and snacks', amount: 64, category: 'Uncategorized' },
    { id: 'txn-016-3', description: 'Cleaning supplies', amount: 102, category: 'Uncategorized' },
  ] },
  { id: 'txn-017', date: 'Aug 12, 2026', payee: 'Home Depot', description: 'Job materials and a new ladder rack', amount: '$763.84', category: 'Split', status: 'Needs Review', account: 'Chase Business Checking', lines: [
    { id: 'txn-017-1', description: 'PVC pipe and fittings', amount: 341.22, category: 'Materials' },
    { id: 'txn-017-2', description: 'Truck ladder rack', amount: 422.62, category: 'Uncategorized' },
  ] },
  { id: 'txn-018', date: 'Jul 30, 2026', payee: 'Home Depot', description: 'Copper fittings and flux', amount: '$198.40', category: 'Materials', status: 'Matched' },
  { id: 'txn-019', date: 'Jul 18, 2026', payee: 'Home Depot', description: 'Pipe wrap and hangers', amount: '$74.10', category: 'Materials', status: 'Matched' },
]

export const demoTransactions: Transaction[] = baseTransactions.map((transaction) => ({ account: 'Chase Business Checking', clientId: 'abc-plumbing', ...transaction }))

// Derived from the raw statement and register inputs in demoReconciliation.ts, never typed in.
export { reconciliationAccounts } from './demoReconciliation'

export const monthEndItems: MonthEndItem[] = [
  { id: 'month-bank', label: 'Bank reconciliations', status: 'Complete' },
  { id: 'month-card', label: 'Credit card reconciliations', status: 'Complete' },
  { id: 'month-uncategorized', label: 'Uncategorized transactions reviewed', status: 'Complete' },
  { id: 'month-receipts', label: 'Missing receipts resolved', status: 'Needs Attention', explanation: '2 receipts are still missing', relatedView: 'Transactions', relatedLabel: 'Go to Transactions' },
  { id: 'month-receivables', label: 'Accounts receivable reviewed', status: 'Complete' },
  { id: 'month-payables', label: 'Accounts payable reviewed', status: 'Complete' },
  { id: 'month-duplicates', label: 'Duplicate transactions checked', status: 'Complete' },
  { id: 'month-questions', label: 'Client questions resolved', status: 'Complete' },
  { id: 'month-reports', label: 'Financial reports reviewed', status: 'Complete' },
  { id: 'month-final', label: 'Final month-end review', status: 'Complete' },
]

export const inboxItems: InboxItem[] = [
  { id: 'inbox-transaction', client: 'ABC Plumbing', type: 'Transaction', description: '14 transactions need review', priority: 'High', date: 'Today', status: 'Open', destination: 'Transactions' },
  { id: 'inbox-receipts', client: 'ABC Plumbing', type: 'Missing Receipt', description: '2 receipts are still missing', priority: 'High', date: 'Aug 29, 2026', status: 'Open', destination: 'Transactions' },
  { id: 'inbox-question', client: 'ABC Plumbing', type: 'Client Question', description: 'Home Depot purchase needs an answer', priority: 'High', date: 'Aug 18, 2026', status: 'Open', destination: 'Client Requests', requestId: 'request-home-depot' },
  { id: 'inbox-reconcile', client: 'ABC Plumbing', type: 'Reconciliation', description: 'Credit card difference needs review', priority: 'Medium', date: 'Aug 31, 2026', status: 'Open', destination: 'Reconcile' },
  { id: 'inbox-bills', client: 'ABC Plumbing', type: 'Bill', description: '2 bills need review', priority: 'Medium', date: 'Aug 27, 2026', status: 'Open', destination: 'Payables' },
  { id: 'inbox-invoice', client: 'ABC Plumbing', type: 'Invoice', description: 'Riverside Retail invoice is overdue', priority: 'Medium', date: 'Aug 27, 2026', status: 'Open', destination: 'Receivables' },
  { id: 'inbox-month-end', client: 'ABC Plumbing', type: 'Month End', description: 'Missing receipts are holding up month end', priority: 'Medium', date: 'Aug 31, 2026', status: 'Open', destination: 'Month End' },
]

export const clientRequests: ClientRequest[] = [
  {
    id: 'request-home-depot',
    client: 'ABC Plumbing',
    clientId: DEMO_CLIENT_ID,
    requestType: 'Missing Receipt',
    dateCreated: 'August 18, 2026',
    dueDate: '2026-08-22',
    priority: 'High',
    relatedTransaction: 'Home Depot',
    relatedAmount: '$1,284.00',
    question: 'Please send the receipt for this Home Depot purchase.',
    status: 'Waiting for Client',
    requestedDocumentType: 'Receipt',
    messages: [
      { id: 'request-home-depot-msg-1', sender: 'Bookkeeper', senderLabel: 'LedgerOps Bookkeeper', sentAt: '2026-08-18T09:00:00.000Z', message: 'Please send the receipt for this Home Depot purchase so I can finish the review.' },
    ],
  },
  {
    id: 'request-deposit',
    client: 'ABC Plumbing',
    clientId: DEMO_CLIENT_ID,
    requestType: 'Transaction Question',
    dateCreated: 'August 16, 2026',
    dueDate: '2026-08-19',
    priority: 'Medium',
    relatedTransaction: 'Bank deposit',
    relatedAmount: '$2,450.00',
    question: 'Who sent this deposit?',
    status: 'Client Responded',
    answer: 'Payment from Westview Apartments for the July service call.',
    messages: [
      { id: 'request-deposit-msg-1', sender: 'Bookkeeper', senderLabel: 'LedgerOps Bookkeeper', sentAt: '2026-08-16T10:30:00.000Z', message: 'Who sent this deposit?' },
      { id: 'request-deposit-msg-2', sender: 'Client', senderLabel: 'ABC Plumbing', sentAt: '2026-08-16T13:45:00.000Z', message: 'Payment from Westview Apartments for the July service call.' },
    ],
  },
  {
    id: 'request-vendor',
    client: 'ABC Plumbing',
    clientId: DEMO_CLIENT_ID,
    requestType: 'Transaction Question',
    dateCreated: 'August 12, 2026',
    dueDate: '2026-08-15',
    priority: 'Medium',
    relatedTransaction: 'PlumbPro Supply',
    relatedAmount: '$680.00',
    question: 'Is this a business purchase or a personal expense?',
    status: 'Completed',
    answer: 'Business purchase for the Oak Street job.',
    messages: [
      { id: 'request-vendor-msg-1', sender: 'Bookkeeper', senderLabel: 'LedgerOps Bookkeeper', sentAt: '2026-08-12T08:15:00.000Z', message: 'Is this a business purchase or a personal expense?' },
      { id: 'request-vendor-msg-2', sender: 'Client', senderLabel: 'ABC Plumbing', sentAt: '2026-08-12T11:00:00.000Z', message: 'Business purchase for the Oak Street job.' },
      { id: 'request-vendor-msg-3', sender: 'Bookkeeper', senderLabel: 'LedgerOps Bookkeeper', sentAt: '2026-08-12T14:10:00.000Z', message: 'Thanks — I recorded that explanation and completed the request.' },
    ],
  },
]

export const demoInvoices: Invoice[] = [
  { id: 'invoice-1001', customer: 'Westview Apartments', number: 'INV-1001', invoiceDate: 'August 01, 2026', dueDate: 'August 31, 2026', amount: 4200, amountPaid: 4200, status: 'Paid' },
  { id: 'invoice-1002', customer: 'Oak Street Properties', number: 'INV-1002', invoiceDate: 'August 05, 2026', dueDate: 'September 04, 2026', amount: 3150, amountPaid: 1200, status: 'Partially Paid' },
  { id: 'invoice-1003', customer: 'Riverside Retail', number: 'INV-1003', invoiceDate: 'July 28, 2026', dueDate: 'August 27, 2026', amount: 2840, amountPaid: 0, status: 'Overdue' },
  { id: 'invoice-1004', customer: 'Pinecrest HOA', number: 'INV-1004', invoiceDate: 'August 16, 2026', dueDate: 'September 15, 2026', amount: 1980, amountPaid: 0, status: 'Open' },
  { id: 'invoice-1005', customer: 'Harbor Office Park', number: 'INV-1005', invoiceDate: 'August 22, 2026', dueDate: 'September 21, 2026', amount: 1650, amountPaid: 0, status: 'Open' },
]

export const demoBills: Bill[] = [
  { id: 'bill-2001', vendor: 'Home Depot', number: 'HD-88321', billDate: 'August 18, 2026', dueDate: 'September 17, 2026', amount: 1284, amountPaid: 0, category: 'Materials', status: 'Needs Review' },
  { id: 'bill-2002', vendor: 'ABC Supply Co.', number: 'ABC-4418', billDate: 'August 12, 2026', dueDate: 'September 11, 2026', amount: 860, amountPaid: 0, category: 'Materials', status: 'Due Soon' },
  { id: 'bill-2003', vendor: 'Verizon Business', number: 'VB-081026', billDate: 'August 10, 2026', dueDate: 'September 10, 2026', amount: 126.44, amountPaid: 0, category: 'Utilities', status: 'Open' },
  { id: 'bill-2004', vendor: 'State Farm', number: 'SF-0826', billDate: 'August 01, 2026', dueDate: 'August 15, 2026', amount: 286, amountPaid: 0, category: 'Insurance', status: 'Overdue' },
  { id: 'bill-2005', vendor: 'UPS', number: 'UPS-7734', billDate: 'August 04, 2026', dueDate: 'August 25, 2026', amount: 210, amountPaid: 210, category: 'Shipping', status: 'Paid' },
]

export const todaysWork: WorkItem[] = [
  { title: 'Review 14 transactions', client: 'ABC Plumbing', detail: 'Transactions need review', tone: 'red' },
  { title: 'Complete bank reconciliation', client: 'ABC Plumbing', detail: 'Everything matches', tone: 'blue' },
  { title: 'Review 3 bills', client: 'ABC Plumbing', detail: 'Bills waiting for review', tone: 'amber' },
  { title: 'Request receipt', client: 'ABC Plumbing', detail: 'One receipt is missing', tone: 'amber' },
]

export const navigationItems = [
  { label: 'Dashboard', icon: '⌂' },
  { label: 'Clients', icon: '●' },
  { label: 'Inbox', icon: '✉' },
  { label: 'Bookkeeping Review', icon: '!' },
  { label: 'Transactions', icon: '↔' },
  { label: 'Reconcile', icon: '✓' },
  { label: 'Receivables', icon: '$' },
  { label: 'Payables', icon: '↓' },
  { label: 'Reports', icon: '▥' },
  { label: 'Month End', icon: '◷' },
  { label: 'Client Requests', icon: '?' },
  { label: 'Settings', icon: '⚙' },
]
