import type { LedgerAccount, LedgerTransaction, Transaction, TransactionLine, TransactionStatus } from './bookkeepingTypes'

export const SPLIT_CATEGORY = 'Split'
export type LineChange = { lineId: string; category: string; categoryId?: string }
export type ReviewFilter = 'Needs Review' | 'Missing Category' | 'Missing Payee' | 'Needs Receipt' | 'Large Transaction'
export const reviewFilters: ReviewFilter[] = ['Needs Review', 'Missing Category', 'Missing Payee', 'Needs Receipt', 'Large Transaction']

// Mirrors the server's allow-list; the server remains the authority.
const CATEGORY_ACCOUNT_TYPES = ['Expense', 'Other Expense', 'Cost of Goods Sold', 'Fixed Asset', 'Other Current Asset', 'Other Asset']
export const isExpenseCategoryAccount = (account: LedgerAccount) => account.active && Boolean(account.quickBooksId) && CATEGORY_ACCOUNT_TYPES.includes(account.accountType)

export const DEMO_CATEGORIES = [
  'Office Supplies', 'Materials', 'Equipment', 'Utilities', 'Meals', 'Travel', 'Fuel', 'Insurance', 'Software',
  'Vehicle Expense', 'Shipping', 'Training', 'Personal / Ask Client', 'Other',
]

export const isUncategorized = (category?: string) => !category || /^uncategorized/i.test(category.trim())
export const toCents = (amount: number) => Math.round(amount * 100)
export const parseAmount = (value: string) => {
  const amount = Number(value.replace(/[$,]/g, ''))
  return Number.isFinite(amount) ? amount : 0
}

/** Every transaction has at least one line; transactions without explicit lines are one line. */
export function getLines(transaction: Transaction): TransactionLine[] {
  if (transaction.lines && transaction.lines.length > 0) return transaction.lines
  return [{ id: `${transaction.id}-line-1`, description: transaction.description, amount: parseAmount(transaction.amount), category: transaction.category }]
}

export const isSplit = (transaction: Transaction) => getLines(transaction).length > 1

export function categorySummary(lines: TransactionLine[]) {
  return new Set(lines.map((line) => line.category)).size === 1 ? lines[0].category : SPLIT_CATEGORY
}

export function categoryLabel(transaction: Transaction) {
  const lines = getLines(transaction)
  return lines.length > 1 ? `Split (${lines.length} lines)` : lines[0].category
}

export const uncategorizedLineCount = (transaction: Transaction) => getLines(transaction).filter((line) => isUncategorized(line.category)).length
export const needsCategory = (transaction: Transaction) => uncategorizedLineCount(transaction) > 0

export type Validation = { ok: true } | { ok: false; error: string }
const formatMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

/** Checks a set of line changes without applying it. */
export function validateLineChanges(transaction: Transaction, changes: LineChange[]): Validation {
  const reason = (transaction as LedgerTransaction).readOnlyReason
  if (reason) return { ok: false, error: reason }
  if (changes.length === 0) return { ok: false, error: 'Choose a category for at least one line.' }
  const lines = getLines(transaction)
  const seen = new Set<string>()
  let changed = 0
  for (const change of changes) {
    const line = lines.find((candidate) => candidate.id === change.lineId)
    if (!line) return { ok: false, error: 'One of the lines was not found on this transaction.' }
    if (seen.has(change.lineId)) return { ok: false, error: 'Each line can only be changed once.' }
    seen.add(change.lineId)
    if (!change.category.trim() || isUncategorized(change.category) || change.category === SPLIT_CATEGORY) {
      return { ok: false, error: 'Choose a real category for each line you change.' }
    }
    if (change.category !== line.category) changed += 1
  }
  if (changed === 0) return { ok: false, error: 'None of the lines would change.' }
  const lineTotal = lines.reduce((sum, line) => sum + toCents(line.amount), 0)
  const total = toCents(parseAmount(transaction.amount))
  if (lineTotal !== total) {
    return { ok: false, error: `The line amounts (${formatMoney(lineTotal / 100)}) do not add up to the transaction total (${formatMoney(total / 100)}), so nothing was changed.` }
  }
  return { ok: true }
}

/**
 * Returns a copy with only the listed lines recategorized. Other lines, amounts, descriptions and
 * every other field are carried over untouched.
 */
export function applyLineChanges<T extends Transaction>(transaction: T, changes: LineChange[]): T {
  const result = validateLineChanges(transaction, changes)
  if (!result.ok) throw new Error(result.error)
  const byLine = new Map(changes.map((change) => [change.lineId, change]))
  const lines = getLines(transaction).map((line) => {
    const change = byLine.get(line.id)
    return change ? { ...line, category: change.category, ...(change.categoryId ? { categoryId: change.categoryId } : {}) } : line
  })
  const status: TransactionStatus = lines.some((line) => isUncategorized(line.category))
    ? 'Needs Review'
    : transaction.status === 'Needs Review' ? 'Categorized' : transaction.status
  return { ...transaction, lines, category: categorySummary(lines), status }
}

export function matchesReviewFilter(transaction: Transaction, filter: ReviewFilter) {
  if (filter === 'Needs Review') return transaction.status === 'Needs Review' || transaction.status === 'Needs Receipt'
  if (filter === 'Missing Category') return needsCategory(transaction)
  if (filter === 'Missing Payee') return !transaction.payee || transaction.payee === 'Unknown'
  if (filter === 'Needs Receipt') return transaction.status === 'Needs Receipt'
  return parseAmount(transaction.amount) >= 1000
}

/** Categorization state only; a missing receipt is a separate requirement (see needsReceipt). */
export type CategorizationStatus = 'Needs review' | 'Categorized' | 'Matched'
export type StatusFilter = 'All' | CategorizationStatus
export const statusFilters: StatusFilter[] = ['All', 'Needs review', 'Categorized', 'Matched']

export function categorizationStatus(transaction: Transaction): CategorizationStatus {
  if (needsCategory(transaction) || transaction.status === 'Needs Review') return 'Needs review'
  return transaction.status === 'Matched' ? 'Matched' : 'Categorized'
}
export const needsReceipt = (transaction: Transaction) => transaction.status === 'Needs Receipt'
export const needsAttention = (transaction: Transaction) => categorizationStatus(transaction) === 'Needs review' || needsReceipt(transaction)

export type ReasonFilter = 'Any' | 'Missing category' | 'Missing payee' | 'Missing receipt' | 'Large transaction'
export const reasonFilters: ReasonFilter[] = ['Any', 'Missing category', 'Missing payee', 'Missing receipt', 'Large transaction']

export function matchesReason(transaction: Transaction, reason: ReasonFilter) {
  if (reason === 'Any') return true
  if (reason === 'Missing category') return needsCategory(transaction)
  if (reason === 'Missing payee') return !transaction.payee || transaction.payee === 'Unknown'
  if (reason === 'Missing receipt') return needsReceipt(transaction)
  return parseAmount(transaction.amount) >= 1000
}

/** Plain-language reasons a transaction needs a bookkeeper's attention, independent of its status label. */
export function reviewReasons(transaction: Transaction): string[] {
  return reasonFilters.filter((reason) => reason !== 'Any' && matchesReason(transaction, reason))
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const validIso = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Accepts "2026-08-29" or "Aug 29, 2026"; anything else is undated (null), never guessed. */
export function transactionIsoDate(value: string | undefined): string | null {
  if (!value) return null
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return validIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const display = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})$/.exec(text)
  if (!display) return null
  const month = MONTH_NAMES.indexOf(display[1].toLowerCase()) + 1
  return month ? validIso(Number(display[3]), month, Number(display[2])) : null
}

export type DateRange = { from?: string; to?: string }
export const monthRange = (period: { year: number; month: number }): DateRange => {
  const last = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate()
  const prefix = `${String(period.year).padStart(4, '0')}-${String(period.month).padStart(2, '0')}`
  return { from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, '0')}` }
}
export const hasDateRange = (range?: DateRange) => Boolean(range?.from || range?.to)

export function inDateRange(transaction: Transaction, range?: DateRange) {
  if (!hasDateRange(range)) return true
  const date = transactionIsoDate(transaction.date)
  if (!date) return false
  return (!range?.from || date >= range.from) && (!range?.to || date <= range.to)
}

const formatIso = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1].replace(/^./, (char) => char.toUpperCase())} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`
export function describeDateRange(range?: DateRange) {
  if (!range?.from && !range?.to) return 'All dates'
  if (range.from && range.to) return `${formatIso(range.from)} – ${formatIso(range.to)}`
  return range.from ? `From ${formatIso(range.from)}` : `Up to ${formatIso(range.to!)}`
}

export type TransactionFilters = {
  clientId?: string | null
  status?: TransactionStatus | 'All'
  categorization?: StatusFilter
  reason?: ReasonFilter
  range?: DateRange
  category?: string
  search?: string
}

export function filterTransactions<T extends Transaction>(transactions: T[], filters: TransactionFilters): T[] {
  const search = filters.search?.trim().toLowerCase()
  return transactions.filter((transaction) => {
    if (filters.clientId && transaction.clientId && transaction.clientId !== filters.clientId) return false
    if (filters.status && filters.status !== 'All' && transaction.status !== filters.status) return false
    if (filters.categorization && filters.categorization !== 'All' && categorizationStatus(transaction) !== filters.categorization) return false
    if (filters.reason && !matchesReason(transaction, filters.reason)) return false
    if (!inDateRange(transaction, filters.range)) return false
    if (filters.category && filters.category !== 'All' && !getLines(transaction).some((line) => line.category === filters.category)) return false
    if (search) {
      const haystack = [transaction.payee, transaction.description, transaction.amount, ...getLines(transaction).map((line) => line.description)].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

/** Distinct clients among the given rows; rows without a client id are not counted. */
export const clientIdsIn = (transactions: Transaction[]) => [...new Set(transactions.flatMap((transaction) => transaction.clientId ? [transaction.clientId] : []))]

/**
 * The next transaction to review after `currentId`: the following queued item in display order, wrapping
 * to the start. The current transaction is never returned, so a finished item is not reopened.
 */
export function nextActionable<T extends Transaction>(ordered: T[], queue: T[], currentId: string): T | undefined {
  const forward = adjacentInQueue(ordered, queue, currentId, 'next')
  if (forward) return forward
  const inQueue = new Set(queue.map((transaction) => transaction.id))
  return ordered.find((transaction) => transaction.id !== currentId && inQueue.has(transaction.id))
}

export function categoriesIn(transactions: Transaction[]) {
  return [...new Set(transactions.flatMap((transaction) => getLines(transaction).map((line) => line.category)))].sort((left, right) => left.localeCompare(right))
}

/**
 * The transaction before/after `currentId` in display order that is also in `queue`. Works when
 * the current transaction has just left the queue because it was categorized.
 */
export function adjacentInQueue<T extends Transaction>(ordered: T[], queue: T[], currentId: string, direction: 'next' | 'previous'): T | undefined {
  const index = ordered.findIndex((transaction) => transaction.id === currentId)
  if (index === -1) return undefined
  const inQueue = new Set(queue.map((transaction) => transaction.id))
  const candidates = direction === 'next' ? ordered.slice(index + 1) : ordered.slice(0, index).reverse()
  return candidates.find((transaction) => inQueue.has(transaction.id))
}
