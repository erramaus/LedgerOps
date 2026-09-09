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

export type ClientRequestStatus = 'Draft' | 'Waiting for Client' | 'Answered' | 'Client Responded' | 'Resolved'

export type ClientRequest = {
  id: string
  client: string
  dateCreated: string
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

export type BillStatus = 'Open' | 'Due Soon' | 'Overdue' | 'Paid' | 'Needs Review'

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

export const demoClient: Client = {
  id: 'abc-plumbing',
  name: 'ABC Plumbing',
  initials: 'AB',
  status: 'Needs attention',
  month: 'August 2026',
  attention: 6,
  reconciliation: 'Ready to complete',
  monthEnd: 90,
  income: '$84,260',
  expenses: '$52,418',
  profit: '$31,842',
  bankBalance: '$48,421.72',
  accountsReceivable: '$12,840',
  accountsPayable: '$6,210',
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

export const demoTransactions: Transaction[] = [
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
]

export const reconciliationAccounts: ReconciliationAccount[] = [
  {
    id: 'chase-checking',
    name: 'Chase Business Checking',
    lastReconciled: 'July 31, 2026',
    statementEnding: 'August 31, 2026',
    quickBooksBalance: 48421.72,
    statementBalance: 48421.72,
    status: 'Ready to complete',
    transactions: [
      { id: 'rec-checking-1', date: 'Aug 02, 2026', payee: 'ABC Plumbing Customer', amount: 5000, type: 'Deposit', cleared: true },
      { id: 'rec-checking-2', date: 'Aug 04, 2026', payee: 'Home Depot', amount: 341.22, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-3', date: 'Aug 05, 2026', payee: 'Shell', amount: 82.41, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-4', date: 'Aug 07, 2026', payee: 'Verizon', amount: 126.44, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-5', date: 'Aug 09, 2026', payee: 'Grainger', amount: 218.65, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-6', date: 'Aug 11, 2026', payee: 'City Water Department', amount: 174.2, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-7', date: 'Aug 13, 2026', payee: 'Ace Hardware', amount: 96.37, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-8', date: 'Aug 15, 2026', payee: 'Quick Lane', amount: 89.5, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-9', date: 'Aug 17, 2026', payee: 'Lowe\'s', amount: 412.06, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-10', date: 'Aug 20, 2026', payee: 'State Farm', amount: 286, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-11', date: 'Aug 22, 2026', payee: 'UPS', amount: 38.72, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-12', date: 'Aug 25, 2026', payee: 'Office Depot', amount: 73.45, type: 'Withdrawal', cleared: true },
      { id: 'rec-checking-13', date: 'Aug 29, 2026', payee: 'Payroll', amount: 1639.26, type: 'Withdrawal', cleared: true },
    ],
  },
  {
    id: 'chase-card',
    name: 'Chase Business Credit Card',
    lastReconciled: 'July 31, 2026',
    statementEnding: 'August 31, 2026',
    quickBooksBalance: 6010.3,
    statementBalance: 6234.5,
    status: 'Difference to resolve',
    possibleProblems: ['Home Depot charge may be missing from the books', 'A duplicate materials charge may be recorded', 'The statement amount may be different'],
    transactions: [
      { id: 'rec-card-1', date: 'Aug 03, 2026', payee: 'Amazon Business', amount: 112.45, type: 'Withdrawal', cleared: true },
      { id: 'rec-card-2', date: 'Aug 08, 2026', payee: 'Home Depot', amount: 224.2, type: 'Withdrawal', cleared: true },
      { id: 'rec-card-3', date: 'Aug 12, 2026', payee: 'Adobe', amount: 59.99, type: 'Withdrawal', cleared: true },
      { id: 'rec-card-4', date: 'Aug 18, 2026', payee: 'BuildPro Training', amount: 225, type: 'Withdrawal', cleared: true },
      { id: 'rec-card-5', date: 'Aug 24, 2026', payee: 'Fuel Rewards', amount: 88.66, type: 'Withdrawal', cleared: true },
    ],
  },
]

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
  { id: 'request-home-depot', client: 'ABC Plumbing', dateCreated: 'August 18, 2026', relatedTransaction: 'Home Depot', relatedAmount: '$1,284.00', question: 'What was this purchase for?', status: 'Waiting for Client' },
  { id: 'request-deposit', client: 'ABC Plumbing', dateCreated: 'August 16, 2026', relatedTransaction: 'Bank deposit', relatedAmount: '$2,450.00', question: 'Who sent this deposit?', status: 'Answered', answer: 'Payment from Westview Apartments for the July service call.' },
  { id: 'request-vendor', client: 'ABC Plumbing', dateCreated: 'August 12, 2026', relatedTransaction: 'PlumbPro Supply', relatedAmount: '$680.00', question: 'Is this a business purchase or a personal expense?', status: 'Resolved', answer: 'Business purchase for the Oak Street job.' },
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
