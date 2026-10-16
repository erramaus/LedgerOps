import { balanceAt, balanceSheet, validateLedger, type JournalEntry, type JournalLine, type LedgerAccountDef, type OpenItem } from './accounting.js'
import { periodEnd, periodStart, type Period } from './period.js'
import type { AccountKind, Direction, ReconTxn, StatementLine } from './reconciliation.js'
import type { DemoLedger } from './demoPayments.js'

export type CompanyDocument = {
  id: string
  party: string
  number: string
  date: string
  dueDate: string
  amountCents: number
  accountId: string
  payments: { date: string; amountCents: number; depositTo: 'checking' }[]
}
export type CompanyTransactionLine = { id: string; description: string; amountCents: number; categoryId: string }
export type CompanyTransaction = {
  id: string
  date: string
  payee: string
  description: string
  amountCents: number
  accountId: 'checking' | 'card'
  categoryId: string
  status: 'Categorized' | 'Needs Review' | 'Needs Receipt' | 'Matched'
  memo: string
  lines?: CompanyTransactionLine[]
}
export type CompanyReconAccount = { id: string; name: string; kind: AccountKind; ledgerId: 'checking' | 'card' }
export type CompanyStatement = {
  id: string
  accountId: string
  kind: AccountKind
  period: Period
  periodStart: string
  periodEnd: string
  statementDate: string
  beginningCents: number
  endingCents: number
  transactions: ReconTxn[]
  statementLines: StatementLine[]
}
export type CompanyReviewScenario = { possibleDuplicates: number; missingReceipts: number; missingPayees: number; openClientRequests: number }
export type CompanyRequest = { id: string; client: string; dateCreated: string; relatedTransaction: string; relatedAmount: string; question: string; status: 'Waiting for Client' }
export type DemoCompanyBooks = {
  clientId: string
  clientName: string
  industry: string
  periods: Period[]
  ledger: DemoLedger
  invoices: CompanyDocument[]
  bills: CompanyDocument[]
  transactions: CompanyTransaction[]
  reconciliationAccounts: CompanyReconAccount[]
  statements: CompanyStatement[]
  reviewScenarios: Record<string, CompanyReviewScenario>
  requests: CompanyRequest[]
}

type MonthPlan = {
  revenueCents: number
  receiptCents: number
  billCents: number
  billPaymentCents: number
  payrollCents: number
  utilitiesCents: number
  fuelCents: number
  cardSpendCents: number
  cardPaymentCents: number
  loanPrincipalCents?: number
  loanInterestCents?: number
}
type CompanyProfile = {
  clientId: string
  clientName: string
  industry: string
  initials: string
  checkingName: string
  cardName: string
  incomeName: string
  cogsName: string
  payrollName: string
  fuelName: string
  suppliesName: string
  customers: string[]
  vendors: string[]
  openingCheckingCents: number
  openingEquipmentCents: number
  openingCardCents: number
  openingLoanCents: number
  monthly: MonthPlan[]
  scenarios: { receipt?: number; duplicate?: number; uncategorized?: number; missingReceipt?: number; split?: number; outstandingCheck?: number; missingBankLine?: number; missingCardLine?: number }
  request?: { payee: string; amountCents: number; question: string }
}

const MONTHS: Period[] = [3, 4, 5, 6, 7, 8].map((month) => ({ year: 2026, month }))
const dateFor = (period: Period, day: number) => `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const dr = (accountId: string, debitCents: number): JournalLine => ({ accountId, debitCents, creditCents: 0 })
const cr = (accountId: string, creditCents: number): JournalLine => ({ accountId, debitCents: 0, creditCents })
const entry = (id: string, date: string, memo: string, lines: JournalLine[]): JournalEntry => ({ id, date, memo, lines })
const dayBefore = (iso: string) => {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
const documentNumber = (prefix: string, month: number) => `${prefix}-${String(month).padStart(2, '0')}`

const profiles: CompanyProfile[] = [
  {
    clientId: 'green-leaf-landscaping', clientName: 'Green Leaf Landscaping', industry: 'Landscaping', initials: 'GL',
    checkingName: 'Evergreen Community Bank Checking', cardName: 'Green Leaf Business Visa', incomeName: 'Landscape Service Revenue', cogsName: 'Plants and Job Materials', payrollName: 'Field Crew Payroll', fuelName: 'Fleet Fuel', suppliesName: 'Nursery Supplies',
    customers: ['Maple Ridge HOA', 'Westbrook Offices', 'Cedar Grove Homes', 'Northfield School'], vendors: ['Riverbend Nursery', 'GreenFleet Fuel', 'Garden Supply Depot'],
    openingCheckingCents: 7_850_000, openingEquipmentCents: 2_400_000, openingCardCents: 268_000, openingLoanCents: 0,
    monthly: [
      { revenueCents: 625_000, receiptCents: 625_000, billCents: 168_000, billPaymentCents: 168_000, payrollCents: 215_000, utilitiesCents: 31_000, fuelCents: 38_000, cardSpendCents: 24_000, cardPaymentCents: 25_000 },
      { revenueCents: 710_000, receiptCents: 710_000, billCents: 185_000, billPaymentCents: 185_000, payrollCents: 228_000, utilitiesCents: 32_000, fuelCents: 41_000, cardSpendCents: 27_000, cardPaymentCents: 28_000 },
      { revenueCents: 865_000, receiptCents: 865_000, billCents: 246_000, billPaymentCents: 246_000, payrollCents: 246_000, utilitiesCents: 34_000, fuelCents: 49_000, cardSpendCents: 33_000, cardPaymentCents: 34_000 },
      { revenueCents: 1_025_000, receiptCents: 1_025_000, billCents: 308_000, billPaymentCents: 260_000, payrollCents: 267_000, utilitiesCents: 36_000, fuelCents: 57_000, cardSpendCents: 39_000, cardPaymentCents: 37_000 },
      { revenueCents: 1_180_000, receiptCents: 520_000, billCents: 355_000, billPaymentCents: 220_000, payrollCents: 291_000, utilitiesCents: 38_000, fuelCents: 64_000, cardSpendCents: 46_000, cardPaymentCents: 40_000 },
      { revenueCents: 1_090_000, receiptCents: 450_000, billCents: 318_000, billPaymentCents: 185_000, payrollCents: 282_000, utilitiesCents: 39_000, fuelCents: 62_000, cardSpendCents: 43_000, cardPaymentCents: 38_000 },
    ],
    scenarios: { duplicate: 2, missingReceipt: 3, missingCardLine: 5 },
    request: { payee: 'Riverbend Nursery', amountCents: 24_600, question: 'Which planting project was this nursery order for?' },
  },
  {
    clientId: 'smith-construction', clientName: 'Smith Construction', industry: 'Construction', initials: 'SC',
    checkingName: 'First County Construction Checking', cardName: 'Smith Construction Corporate Card', incomeName: 'Contract Revenue', cogsName: 'Subcontractors and Materials', payrollName: 'Site Payroll', fuelName: 'Equipment Fuel', suppliesName: 'Jobsite Supplies',
    customers: ['Harbor Point Development', 'Pine Avenue Partners', 'City Works Department', 'Lakeside Commercial'], vendors: ['Atlas Concrete', 'Northstar Electric', 'BuildRight Supply'],
    openingCheckingCents: 18_425_000, openingEquipmentCents: 8_200_000, openingCardCents: 1_245_000, openingLoanCents: 6_500_000,
    monthly: [
      { revenueCents: 5_200_000, receiptCents: 5_200_000, billCents: 2_480_000, billPaymentCents: 2_480_000, payrollCents: 1_240_000, utilitiesCents: 125_000, fuelCents: 212_000, cardSpendCents: 195_000, cardPaymentCents: 180_000, loanPrincipalCents: 72_000, loanInterestCents: 38_000 },
      { revenueCents: 5_850_000, receiptCents: 5_850_000, billCents: 2_760_000, billPaymentCents: 2_760_000, payrollCents: 1_310_000, utilitiesCents: 128_000, fuelCents: 226_000, cardSpendCents: 212_000, cardPaymentCents: 205_000, loanPrincipalCents: 72_000, loanInterestCents: 37_000 },
      { revenueCents: 6_400_000, receiptCents: 4_400_000, billCents: 3_120_000, billPaymentCents: 3_120_000, payrollCents: 1_385_000, utilitiesCents: 132_000, fuelCents: 241_000, cardSpendCents: 235_000, cardPaymentCents: 220_000, loanPrincipalCents: 74_000, loanInterestCents: 36_000 },
      { revenueCents: 6_100_000, receiptCents: 6_100_000, billCents: 3_280_000, billPaymentCents: 2_800_000, payrollCents: 1_420_000, utilitiesCents: 136_000, fuelCents: 248_000, cardSpendCents: 246_000, cardPaymentCents: 230_000, loanPrincipalCents: 74_000, loanInterestCents: 35_000 },
      { revenueCents: 7_200_000, receiptCents: 5_000_000, billCents: 3_640_000, billPaymentCents: 2_600_000, payrollCents: 1_510_000, utilitiesCents: 141_000, fuelCents: 267_000, cardSpendCents: 268_000, cardPaymentCents: 235_000, loanPrincipalCents: 76_000, loanInterestCents: 34_000 },
      { revenueCents: 6_850_000, receiptCents: 4_200_000, billCents: 3_510_000, billPaymentCents: 2_300_000, payrollCents: 1_485_000, utilitiesCents: 143_000, fuelCents: 259_000, cardSpendCents: 256_000, cardPaymentCents: 225_000, loanPrincipalCents: 76_000, loanInterestCents: 33_000 },
    ],
    scenarios: { uncategorized: 2, split: 3, outstandingCheck: 4, missingCardLine: 5 },
    request: { payee: 'Northstar Electric', amountCents: 682_000, question: 'Please identify the site and phase for this subcontractor payment.' },
  },
  {
    clientId: 'johnson-dental', clientName: 'Johnson Dental', industry: 'Dental Practice', initials: 'JD',
    checkingName: 'Lakeshore Dental Practice Checking', cardName: 'Johnson Dental Business Mastercard', incomeName: 'Dental Services Revenue', cogsName: 'Dental Lab and Clinical Supplies', payrollName: 'Clinical and Office Payroll', fuelName: 'Business Travel', suppliesName: 'Dental Supplies',
    customers: ['Patient Services', 'Cedar Dental Plan', 'Pioneer Health Network', 'Riverview Family Dentistry'], vendors: ['BrightSmile Dental Lab', 'MediSource Dental', 'Northstar Office Supply'],
    openingCheckingCents: 12_840_000, openingEquipmentCents: 6_400_000, openingCardCents: 385_000, openingLoanCents: 0,
    monthly: [
      { revenueCents: 2_180_000, receiptCents: 2_050_000, billCents: 468_000, billPaymentCents: 468_000, payrollCents: 842_000, utilitiesCents: 92_000, fuelCents: 18_000, cardSpendCents: 58_000, cardPaymentCents: 60_000 },
      { revenueCents: 2_260_000, receiptCents: 2_260_000, billCents: 485_000, billPaymentCents: 485_000, payrollCents: 860_000, utilitiesCents: 94_000, fuelCents: 17_000, cardSpendCents: 61_000, cardPaymentCents: 62_000 },
      { revenueCents: 2_410_000, receiptCents: 2_300_000, billCents: 512_000, billPaymentCents: 512_000, payrollCents: 875_000, utilitiesCents: 96_000, fuelCents: 19_000, cardSpendCents: 66_000, cardPaymentCents: 68_000 },
      { revenueCents: 2_375_000, receiptCents: 2_375_000, billCents: 505_000, billPaymentCents: 400_000, payrollCents: 884_000, utilitiesCents: 98_000, fuelCents: 18_000, cardSpendCents: 68_000, cardPaymentCents: 64_000 },
      { revenueCents: 2_520_000, receiptCents: 2_120_000, billCents: 548_000, billPaymentCents: 370_000, payrollCents: 902_000, utilitiesCents: 101_000, fuelCents: 20_000, cardSpendCents: 73_000, cardPaymentCents: 66_000 },
      { revenueCents: 2_480_000, receiptCents: 1_900_000, billCents: 536_000, billPaymentCents: 320_000, payrollCents: 918_000, utilitiesCents: 104_000, fuelCents: 21_000, cardSpendCents: 76_000, cardPaymentCents: 67_000 },
    ],
    scenarios: { uncategorized: 0, missingReceipt: 3, missingBankLine: 5 },
    request: { payee: 'BrightSmile Dental Lab', amountCents: 104_000, question: 'Which patient case should this lab invoice be assigned to?' },
  },
  {
    clientId: 'acme-consulting', clientName: 'Acme Consulting', industry: 'Management Consulting', initials: 'AC',
    checkingName: 'Acme Consulting Operating Checking', cardName: 'Acme Consulting Corporate Amex', incomeName: 'Consulting Fees', cogsName: 'Contractor Services', payrollName: 'Consultant Payroll', fuelName: 'Travel', suppliesName: 'Office Supplies',
    customers: ['Orion Retail Group', 'Summit Manufacturing', 'Pioneer Health Systems', 'Atlas Property Group'], vendors: ['Cloudline Software', 'Northstar Research', 'Metro Travel Services'],
    openingCheckingCents: 9_425_000, openingEquipmentCents: 780_000, openingCardCents: 195_000, openingLoanCents: 0,
    monthly: [
      { revenueCents: 2_850_000, receiptCents: 2_850_000, billCents: 640_000, billPaymentCents: 640_000, payrollCents: 1_060_000, utilitiesCents: 46_000, fuelCents: 84_000, cardSpendCents: 138_000, cardPaymentCents: 132_000 },
      { revenueCents: 2_940_000, receiptCents: 2_940_000, billCents: 690_000, billPaymentCents: 690_000, payrollCents: 1_085_000, utilitiesCents: 47_000, fuelCents: 93_000, cardSpendCents: 145_000, cardPaymentCents: 140_000 },
      { revenueCents: 3_120_000, receiptCents: 3_120_000, billCents: 735_000, billPaymentCents: 735_000, payrollCents: 1_110_000, utilitiesCents: 48_000, fuelCents: 102_000, cardSpendCents: 152_000, cardPaymentCents: 150_000 },
      { revenueCents: 3_280_000, receiptCents: 2_280_000, billCents: 780_000, billPaymentCents: 600_000, payrollCents: 1_135_000, utilitiesCents: 49_000, fuelCents: 108_000, cardSpendCents: 161_000, cardPaymentCents: 154_000 },
      { revenueCents: 3_040_000, receiptCents: 1_500_000, billCents: 825_000, billPaymentCents: 500_000, payrollCents: 1_155_000, utilitiesCents: 50_000, fuelCents: 97_000, cardSpendCents: 158_000, cardPaymentCents: 149_000 },
      { revenueCents: 3_360_000, receiptCents: 1_850_000, billCents: 860_000, billPaymentCents: 430_000, payrollCents: 1_180_000, utilitiesCents: 51_000, fuelCents: 111_000, cardSpendCents: 169_000, cardPaymentCents: 152_000 },
    ],
    scenarios: { duplicate: 4, missingReceipt: 2, outstandingCheck: 5, missingBankLine: 3 },
    request: { payee: 'Northstar Research', amountCents: 184_000, question: 'Which engagement should this research subscription be charged to?' },
  },
]

function chartFor(profile: CompanyProfile): LedgerAccountDef[] {
  return [
    { id: 'checking', name: profile.checkingName, klass: 'asset', kind: 'bank', cashFlow: 'cash' },
    { id: 'undeposited', name: 'Undeposited Funds', klass: 'asset', cashFlow: 'operating' },
    { id: 'ar', name: 'Accounts Receivable', klass: 'asset', kind: 'ar', cashFlow: 'operating' },
    { id: 'equipment', name: 'Equipment and Furniture', klass: 'asset', cashFlow: 'investing' },
    { id: 'ap', name: 'Accounts Payable', klass: 'liability', kind: 'ap', cashFlow: 'operating' },
    { id: 'card', name: profile.cardName, klass: 'liability', kind: 'credit_card', cashFlow: 'operating' },
    { id: 'loan', name: 'Term Loan Payable', klass: 'liability', cashFlow: 'financing' },
    { id: 'equity', name: "Owner's Equity", klass: 'equity', cashFlow: 'financing' },
    { id: 'income', name: profile.incomeName, klass: 'income' },
    { id: 'cogs', name: profile.cogsName, klass: 'cogs' },
    { id: 'payroll', name: profile.payrollName, klass: 'expense' },
    { id: 'utilities', name: 'Utilities and Internet', klass: 'expense' },
    { id: 'fuel', name: profile.fuelName, klass: 'expense' },
    { id: 'supplies', name: profile.suppliesName, klass: 'expense' },
    { id: 'software', name: 'Software and Subscriptions', klass: 'expense' },
    { id: 'rent', name: 'Rent and Facilities', klass: 'expense' },
    { id: 'interest', name: 'Interest Expense', klass: 'expense' },
    { id: 'uncategorized', name: 'Uncategorized Expense', klass: 'expense' },
  ]
}

function buildCompany(profile: CompanyProfile): DemoCompanyBooks {
  const accounts = chartFor(profile)
  const entries: JournalEntry[] = []
  const transactions: CompanyTransaction[] = []
  const invoices: CompanyDocument[] = []
  const bills: CompanyDocument[] = []
  const debitTotal = profile.openingCheckingCents + profile.openingEquipmentCents
  const creditTotal = profile.openingCardCents + profile.openingLoanCents
  const openingEquityCents = debitTotal - creditTotal
  entries.push(entry(`${profile.clientId}-opening`, '2026-02-28', 'Opening balances', [
    dr('checking', profile.openingCheckingCents), dr('equipment', profile.openingEquipmentCents), cr('card', profile.openingCardCents), cr('loan', profile.openingLoanCents), cr('equity', openingEquityCents),
  ]))

  const pushTransaction = (transaction: CompanyTransaction, journalLines: JournalLine[]) => {
    entries.push(entry(transaction.id, transaction.date, transaction.memo, journalLines))
    transactions.push(transaction)
  }
  const bankMovement = (args: { id: string; date: string; payee: string; description: string; amountCents: number; categoryId: string; status?: CompanyTransaction['status']; split?: { accountId: string; amountCents: number; description: string }[] }) => {
    const splits = args.split ?? [{ accountId: args.categoryId, amountCents: args.amountCents, description: args.description }]
    const debitLines = splits.map((line) => dr(line.accountId, line.amountCents))
    const accountId = splits.length > 1 ? 'split' : args.categoryId
    const lines = splits.map((line, index) => ({ id: `${args.id}-line-${index + 1}`, description: line.description, amountCents: line.amountCents, categoryId: line.accountId }))
    pushTransaction({ id: args.id, date: args.date, payee: args.payee, description: args.description, amountCents: args.amountCents, accountId: 'checking', categoryId: accountId, status: args.status ?? 'Categorized', memo: args.description, ...(splits.length > 1 ? { lines } : {}) }, [...debitLines, cr('checking', args.amountCents)])
  }
  const cardMovement = (args: { id: string; date: string; payee: string; description: string; amountCents: number; categoryId: string; status?: CompanyTransaction['status'] }) => {
    pushTransaction({ id: args.id, date: args.date, payee: args.payee, description: args.description, amountCents: args.amountCents, accountId: 'card', categoryId: args.categoryId, status: args.status ?? 'Categorized', memo: args.description }, [dr(args.categoryId, args.amountCents), cr('card', args.amountCents)])
  }

  MONTHS.forEach((period, index) => {
    const plan = profile.monthly[index]
    const monthTag = `${period.year}${String(period.month).padStart(2, '0')}`
    const customer = profile.customers[index % profile.customers.length]
    const vendor = profile.vendors[index % profile.vendors.length]
    const invoiceAmount = plan.revenueCents
    const invoice: CompanyDocument = { id: `${profile.clientId}-invoice-${monthTag}`, party: customer, number: `${profile.initials}-I${monthTag}`, date: dateFor(period, 4), dueDate: dateFor(period, 28), amountCents: invoiceAmount, accountId: 'income', payments: [] }
    entries.push(entry(`${invoice.id}-issued`, invoice.date, `Invoice ${invoice.number} to ${customer}`, [dr('ar', invoiceAmount), cr('income', invoiceAmount)]))
    if (plan.receiptCents > 0) {
      const received = Math.min(plan.receiptCents, invoiceAmount)
      const receiptId = `${profile.clientId}-receipt-${monthTag}`
      const receiptDate = dateFor(period, 21)
      invoice.payments.push({ date: receiptDate, amountCents: received, depositTo: 'checking' })
      bankMovement({ id: receiptId, date: receiptDate, payee: customer, description: `Customer receipt ${invoice.number}`, amountCents: received, categoryId: 'ar' })
      // Replace the generated receipt's generic checking debit and AR credit lines with the exact document post.
      entries[entries.length - 1] = entry(receiptId, receiptDate, `Payment on ${invoice.number} from ${customer}`, [dr('checking', received), cr('ar', received)])
      transactions[transactions.length - 1].memo = `Payment on ${invoice.number} from ${customer}`
    }
    invoices.push(invoice)

    const billAmount = plan.billCents
    const bill: CompanyDocument = { id: `${profile.clientId}-bill-${monthTag}`, party: vendor, number: `${profile.initials}-B${monthTag}`, date: dateFor(period, 8), dueDate: dateFor(period, 26), amountCents: billAmount, accountId: 'cogs', payments: [] }
    entries.push(entry(`${bill.id}-entered`, bill.date, `Bill ${bill.number} from ${vendor}`, [dr('cogs', billAmount), cr('ap', billAmount)]))
    if (plan.billPaymentCents > 0) {
      const paid = Math.min(plan.billPaymentCents, billAmount)
      const paymentId = `${profile.clientId}-billpay-${monthTag}`
      const paymentDate = dateFor(period, 25)
      bill.payments.push({ date: paymentDate, amountCents: paid, depositTo: 'checking' })
      pushTransaction({ id: paymentId, date: paymentDate, payee: vendor, description: `Payment of ${bill.number}`, amountCents: paid, accountId: 'checking', categoryId: 'ap', status: 'Categorized', memo: `Payment of ${bill.number}` }, [dr('ap', paid), cr('checking', paid)])
    }
    bills.push(bill)

    bankMovement({ id: `${profile.clientId}-payroll-${monthTag}`, date: dateFor(period, 27), payee: 'Payroll', description: `Payroll ${monthLabel(period)}`, amountCents: plan.payrollCents, categoryId: 'payroll' })
    bankMovement({ id: `${profile.clientId}-utilities-${monthTag}`, date: dateFor(period, 12), payee: 'Utility Provider', description: `Monthly utilities ${monthLabel(period)}`, amountCents: plan.utilitiesCents, categoryId: 'utilities' })
    const fuelStatus = profile.scenarios.missingReceipt === index ? 'Needs Receipt' : 'Categorized'
    bankMovement({ id: `${profile.clientId}-fuel-${monthTag}`, date: dateFor(period, 18), payee: profile.vendors[(index + 1) % profile.vendors.length], description: `${profile.industry} vehicle fuel`, amountCents: plan.fuelCents, categoryId: 'fuel', status: fuelStatus })
    const cardStatus = profile.scenarios.uncategorized === index ? 'Needs Review' : 'Categorized'
    cardMovement({ id: `${profile.clientId}-card-supplies-${monthTag}`, date: dateFor(period, 6), payee: profile.vendors[(index + 2) % profile.vendors.length], description: `${profile.industry} tools and supplies`, amountCents: plan.cardSpendCents, categoryId: cardStatus === 'Needs Review' ? 'uncategorized' : 'supplies', status: cardStatus })
    if (profile.scenarios.duplicate === index) {
      const repeated = Math.min(plan.fuelCents, 19_900)
      bankMovement({ id: `${profile.clientId}-fuel-duplicate-look-${monthTag}`, date: dateFor(period, 20), payee: profile.vendors[(index + 1) % profile.vendors.length], description: `${profile.industry} vehicle fuel`, amountCents: repeated, categoryId: 'fuel' })
      bankMovement({ id: `${profile.clientId}-fuel-duplicate-look2-${monthTag}`, date: dateFor(period, 22), payee: profile.vendors[(index + 1) % profile.vendors.length], description: `${profile.industry} vehicle fuel`, amountCents: repeated, categoryId: 'fuel' })
    }
    if (profile.scenarios.split === index) {
      const total = Math.min(plan.billCents, 124_000)
      const first = Math.floor(total * 0.65)
      bankMovement({ id: `${profile.clientId}-split-purchase-${monthTag}`, date: dateFor(period, 15), payee: 'Project Supply Center', description: 'Job materials and equipment parts', amountCents: total, categoryId: 'split', split: [{ accountId: 'cogs', amountCents: first, description: 'Job materials' }, { accountId: 'equipment', amountCents: total - first, description: 'Equipment parts' }] })
    }
    if ((plan.loanPrincipalCents ?? 0) + (plan.loanInterestCents ?? 0) > 0) {
      const principal = plan.loanPrincipalCents ?? 0
      const interest = plan.loanInterestCents ?? 0
      const total = principal + interest
      pushTransaction({ id: `${profile.clientId}-loan-payment-${monthTag}`, date: dateFor(period, 24), payee: 'Commercial Lender', description: 'Monthly loan payment: principal and interest', amountCents: total, accountId: 'checking', categoryId: 'split', status: 'Categorized', memo: 'Loan payment split between principal and interest', lines: [{ id: `${profile.clientId}-loan-principal-${monthTag}`, description: 'Loan principal', amountCents: principal, categoryId: 'loan' }, { id: `${profile.clientId}-loan-interest-${monthTag}`, description: 'Interest expense', amountCents: interest, categoryId: 'interest' }] }, [dr('loan', principal), dr('interest', interest), cr('checking', total)])
    }
    const cardPayment = Math.min(plan.cardPaymentCents, profile.openingCardCents + profile.monthly.slice(0, index + 1).reduce((sum, month) => sum + month.cardSpendCents, 0))
    pushTransaction({ id: `${profile.clientId}-card-payment-${monthTag}`, date: dateFor(period, 23), payee: profile.cardName, description: 'Credit card payment from checking', amountCents: cardPayment, accountId: 'checking', categoryId: 'card', status: 'Categorized', memo: 'Credit card settlement' }, [dr('card', cardPayment), cr('checking', cardPayment)])
  })

  const ledgerEntries = entries.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
  const ledger: DemoLedger = { accounts, entries: ledgerEntries }
  const invoiceItems: OpenItem[] = invoices.map((document) => ({ id: document.id, party: document.party, number: document.number, date: document.date, dueDate: document.dueDate, amountCents: document.amountCents, payments: document.payments.map((payment) => ({ date: payment.date, amountCents: payment.amountCents })) }))
  const billItems: OpenItem[] = bills.map((document) => ({ id: document.id, party: document.party, number: document.number, date: document.date, dueDate: document.dueDate, amountCents: document.amountCents, payments: document.payments.map((payment) => ({ date: payment.date, amountCents: payment.amountCents })) }))
  ledger.receivableItems = invoiceItems
  ledger.payableItems = billItems

  const reconciliationAccounts: CompanyReconAccount[] = [
    { id: `${profile.clientId}-checking`, name: profile.checkingName, kind: 'bank', ledgerId: 'checking' },
    { id: `${profile.clientId}-card`, name: profile.cardName, kind: 'credit_card', ledgerId: 'card' },
  ]
  const statements: CompanyStatement[] = []
  for (const period of MONTHS) {
    const start = periodStart(period), end = periodEnd(period)
    for (const account of reconciliationAccounts) {
      const beginningCents = balanceAt(accounts, ledgerEntries, account.ledgerId, dayBefore(start))
      const bookEndingCents = balanceAt(accounts, ledgerEntries, account.ledgerId, end)
      const register = registerFor(ledgerEntries, account.ledgerId, start, end)
      let statementRegister = register
      const outstanding = profile.scenarios.outstandingCheck === period.month - 3 && account.ledgerId === 'checking'
      if (outstanding && register.length > 0) statementRegister = register.filter((item) => item.id !== register[register.length - 1].id)
      const statementLines: StatementLine[] = statementRegister.map((item, index) => ({ id: `${profile.clientId}-${account.ledgerId}-${period.month}-line-${index + 1}`, date: item.date, description: item.payee, amountCents: item.amountCents, direction: item.direction }))
      if (profile.scenarios.missingBankLine === period.month - 3 && account.ledgerId === 'checking') statementLines.push({ id: `${profile.clientId}-${account.ledgerId}-${period.month}-missing-fee`, date: dateFor(period, 28), description: 'BANK SERVICE FEE', amountCents: 1_850, direction: 'decrease' })
      if (profile.scenarios.missingCardLine === period.month - 3 && account.ledgerId === 'card') statementLines.push({ id: `${profile.clientId}-${account.ledgerId}-${period.month}-missing-charge`, date: dateFor(period, 19), description: 'UNRECOGNIZED CARD PURCHASE', amountCents: 12_450, direction: 'increase' })
      const signed = statementLines.reduce((sum, line) => sum + (line.direction === 'increase' ? line.amountCents : -line.amountCents), 0)
      const endingCents = beginningCents + signed
      const transactions: ReconTxn[] = register.map((item) => ({ id: item.id, date: item.date, payee: item.payee, memo: item.memo, amountCents: item.amountCents, direction: item.direction }))
      statements.push({ id: `${profile.clientId}:${account.id}:${period.year}-${String(period.month).padStart(2, '0')}`, accountId: account.id, kind: account.kind, period, periodStart: start, periodEnd: end, statementDate: end, beginningCents, endingCents, transactions, statementLines })
      void bookEndingCents
    }
  }

  const reviewScenarios: Record<string, CompanyReviewScenario> = {}
  MONTHS.forEach((period, index) => {
    reviewScenarios[`${period.year}-${String(period.month).padStart(2, '0')}`] = {
      possibleDuplicates: profile.scenarios.duplicate === index ? 1 : 0,
      missingReceipts: profile.scenarios.missingReceipt === index ? 1 : 0,
      missingPayees: 0,
      openClientRequests: profile.request && (profile.scenarios.uncategorized === index || profile.scenarios.missingReceipt === index) ? 1 : 0,
    }
  })
  ledger.clientId = profile.clientId
  ledger.periods = MONTHS
  ledger.reconAccounts = reconciliationAccounts
  ledger.reviewScenarios = reviewScenarios
  const requests: CompanyRequest[] = profile.request ? [{ id: `${profile.clientId}-request-1`, client: profile.clientName, dateCreated: 'August 18, 2026', relatedTransaction: profile.request.payee, relatedAmount: `$${(profile.request.amountCents / 100).toFixed(2)}`, question: profile.request.question, status: 'Waiting for Client' }] : []
  return { clientId: profile.clientId, clientName: profile.clientName, industry: profile.industry, periods: MONTHS, ledger, invoices, bills, transactions, reconciliationAccounts, statements, reviewScenarios, requests }
}

function registerFor(entries: JournalEntry[], ledgerId: 'checking' | 'card', start: string, end: string) {
  const rows = [] as { id: string; date: string; payee: string; memo: string; amountCents: number; direction: Direction }[]
  for (const item of entries) {
    if (item.date < start || item.date > end) continue
    const line = item.lines.find((candidate) => candidate.accountId === ledgerId)
    if (!line) continue
    const amountCents = line.debitCents || line.creditCents
    const direction: Direction = ledgerId === 'checking' ? (line.debitCents > 0 ? 'increase' : 'decrease') : line.creditCents > 0 ? 'increase' : 'decrease'
    rows.push({ id: item.id, date: item.date, payee: item.memo, memo: '', amountCents, direction })
  }
  return rows
}

export const OTHER_DEMO_COMPANIES: DemoCompanyBooks[] = profiles.map(buildCompany)
export const ADDITIONAL_DEMO_CLIENT_IDS = OTHER_DEMO_COMPANIES.map((company) => company.clientId)
export const getAdditionalDemoCompany = (clientId: string) => OTHER_DEMO_COMPANIES.find((company) => company.clientId === clientId)
export const validateAdditionalDemoCompanies = () => OTHER_DEMO_COMPANIES.map((company) => ({
  clientId: company.clientId,
  ledgerIssues: validateLedger(company.ledger.accounts, company.ledger.entries),
  balanceSheet: balanceSheet(company.ledger.accounts, company.ledger.entries, '2026-08-31'),
  arLedgerCents: balanceAt(company.ledger.accounts, company.ledger.entries, 'ar', '2026-08-31'),
  arAgingCents: company.ledger.receivableItems!.reduce((sum, item) => sum + item.amountCents - item.payments.filter((payment) => payment.date <= '2026-08-31').reduce((paid, payment) => paid + payment.amountCents, 0), 0),
  apLedgerCents: balanceAt(company.ledger.accounts, company.ledger.entries, 'ap', '2026-08-31'),
  apAgingCents: company.ledger.payableItems!.reduce((sum, item) => sum + item.amountCents - item.payments.filter((payment) => payment.date <= '2026-08-31').reduce((paid, payment) => paid + payment.amountCents, 0), 0),
  statements: company.statements,
}))

export function monthLabel(period: Period) {
  return new Date(Date.UTC(period.year, period.month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
