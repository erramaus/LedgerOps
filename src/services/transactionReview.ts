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
  return lines.length > 1 ? `Split (${lines.length})` : lines[0].category
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

export type TransactionFilters = {
  clientId?: string | null
  status?: TransactionStatus | 'All'
  category?: string
  search?: string
}

export function filterTransactions<T extends Transaction>(transactions: T[], filters: TransactionFilters): T[] {
  const search = filters.search?.trim().toLowerCase()
  return transactions.filter((transaction) => {
    if (filters.clientId && transaction.clientId && transaction.clientId !== filters.clientId) return false
    if (filters.status && filters.status !== 'All' && transaction.status !== filters.status) return false
    if (filters.category && filters.category !== 'All' && !getLines(transaction).some((line) => line.category === filters.category)) return false
    if (search) {
      const haystack = [transaction.payee, transaction.description, ...getLines(transaction).map((line) => line.description)].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
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
