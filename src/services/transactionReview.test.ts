import { describe, expect, it } from 'vitest'
import type { LedgerTransaction, Transaction } from './bookkeepingTypes'
import { suggestCategories } from './categorySuggestions'
import { demoDataService } from './demoDataService'
import {
  adjacentInQueue,
  applyLineChanges,
  categoriesIn,
  categoryLabel,
  filterTransactions,
  getLines,
  isSplit,
  matchesReviewFilter,
  needsCategory,
  validateLineChanges,
} from './transactionReview'

const { transactions } = demoDataService
const byId = (id: string) => transactions.find((item) => item.id === id)!
const costco = byId('txn-016')
const homeDepotSplit = byId('txn-017')

const sum = (transaction: Transaction) => getLines(transaction).reduce((total, line) => total + Math.round(line.amount * 100), 0)
const total = (transaction: Transaction) => Math.round(Number(transaction.amount.replace(/[$,]/g, '')) * 100)

describe('demo data supports split transactions', () => {
  it('has split transactions whose lines add up to the total', () => {
    const splits = transactions.filter(isSplit)
    expect(splits.length).toBeGreaterThanOrEqual(2)
    splits.forEach((transaction) => expect(sum(transaction)).toBe(total(transaction)))
  })

  it('gives every line its own category, amount and description', () => {
    getLines(costco).forEach((line) => {
      expect(line.description).toBeTruthy()
      expect(line.amount).toBeGreaterThan(0)
      expect(line.category).toBeTruthy()
    })
    expect(new Set(getLines(costco).map((line) => line.category)).size).toBeGreaterThan(1)
  })

  it('treats a transaction without explicit lines as one line', () => {
    const single = byId('txn-003')
    expect(getLines(single)).toHaveLength(1)
    expect(getLines(single)[0]).toMatchObject({ category: 'Fuel', amount: 82.41 })
    expect(isSplit(single)).toBe(false)
  })

  it('labels split transactions in lists without hiding that they are split', () => {
    expect(categoryLabel(costco)).toBe('Split (3 lines)')
    expect(categoryLabel(byId('txn-003'))).toBe('Fuel')
  })

  it('records the account the money moved through, separately from the category', () => {
    expect(costco.account).toBe('Chase Business Credit Card')
    expect(getLines(costco).map((line) => line.category)).not.toContain(costco.account)
  })
})

describe('individual line updates', () => {
  it('changes only the chosen line', () => {
    const updated = applyLineChanges(costco, [{ lineId: 'txn-016-2', category: 'Meals' }])
    expect(getLines(updated).map((line) => line.category)).toEqual(['Office Supplies', 'Meals', 'Uncategorized'])
  })

  it('never copies one category onto every line', () => {
    const updated = applyLineChanges(costco, [{ lineId: 'txn-016-3', category: 'Materials' }])
    const untouched = getLines(updated).filter((line) => line.id !== 'txn-016-3')
    expect(untouched.map((line) => line.category)).toEqual(['Office Supplies', 'Uncategorized'])
  })

  it('preserves amounts, descriptions, ids and every other transaction field', () => {
    const updated = applyLineChanges(costco, [{ lineId: 'txn-016-2', category: 'Meals' }])
    expect(getLines(updated).map(({ id, amount, description }) => ({ id, amount, description }))).toEqual(getLines(costco).map(({ id, amount, description }) => ({ id, amount, description })))
    expect({ ...updated, lines: undefined, category: undefined, status: undefined }).toEqual({ ...costco, lines: undefined, category: undefined, status: undefined })
    expect(sum(updated)).toBe(total(updated))
  })

  it('does not modify the original transaction', () => {
    const snapshot = structuredClone(costco)
    applyLineChanges(costco, [{ lineId: 'txn-016-2', category: 'Meals' }])
    expect(costco).toEqual(snapshot)
  })

  it('updates several lines independently in one request', () => {
    const updated = applyLineChanges(costco, [{ lineId: 'txn-016-2', category: 'Meals' }, { lineId: 'txn-016-3', category: 'Other' }])
    expect(getLines(updated).map((line) => line.category)).toEqual(['Office Supplies', 'Meals', 'Other'])
  })

  it('stays in review until every line has a category, then becomes categorized', () => {
    const partial = applyLineChanges(costco, [{ lineId: 'txn-016-2', category: 'Meals' }])
    expect(partial.status).toBe('Needs Review')
    expect(partial.category).toBe('Split')
    expect(needsCategory(partial)).toBe(true)
    const done = applyLineChanges(partial, [{ lineId: 'txn-016-3', category: 'Other' }])
    expect(done.status).toBe('Categorized')
    expect(needsCategory(done)).toBe(false)
  })

  it('collapses the header to a single category only when all lines agree', () => {
    const same = applyLineChanges(applyLineChanges(costco, [{ lineId: 'txn-016-2', category: 'Office Supplies' }]), [{ lineId: 'txn-016-3', category: 'Office Supplies' }])
    expect(same.category).toBe('Office Supplies')
  })

  it('works for a single-line transaction and keeps Needs Receipt flags', () => {
    const single = byId('txn-006')
    const updated = applyLineChanges(single, [{ lineId: getLines(single)[0].id, category: 'Equipment' }])
    expect(updated.category).toBe('Equipment')
    expect(updated.status).toBe('Needs Receipt')
    expect(getLines(updated)).toHaveLength(1)
  })
})

describe('total validation', () => {
  it('blocks a change when the lines no longer add up to the total', () => {
    const broken: Transaction = { ...costco, lines: getLines(costco).map((line, index) => (index === 0 ? { ...line, amount: 100 } : line)) }
    const result = validateLineChanges(broken, [{ lineId: 'txn-016-2', category: 'Meals' }])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/do not add up/)
    expect(() => applyLineChanges(broken, [{ lineId: 'txn-016-2', category: 'Meals' }])).toThrow(/do not add up/)
  })

  it('compares in cents so rounding noise is not an error', () => {
    const tricky: Transaction = { ...costco, amount: '$0.30', lines: [{ id: 'a', description: 'a', amount: 0.1, category: 'Meals' }, { id: 'b', description: 'b', amount: 0.2, category: 'Uncategorized' }] }
    expect(validateLineChanges(tricky, [{ lineId: 'b', category: 'Other' }]).ok).toBe(true)
  })

  it('rejects unknown lines, duplicates, empty and no-op requests and placeholder categories', () => {
    const invalid = (changes: Parameters<typeof validateLineChanges>[1]) => validateLineChanges(costco, changes).ok
    expect(invalid([])).toBe(false)
    expect(invalid([{ lineId: 'missing', category: 'Meals' }])).toBe(false)
    expect(invalid([{ lineId: 'txn-016-2', category: 'Meals' }, { lineId: 'txn-016-2', category: 'Other' }])).toBe(false)
    expect(invalid([{ lineId: 'txn-016-1', category: 'Office Supplies' }])).toBe(false)
    expect(invalid([{ lineId: 'txn-016-2', category: 'Uncategorized' }])).toBe(false)
    expect(invalid([{ lineId: 'txn-016-2', category: 'Split' }])).toBe(false)
    expect(invalid([{ lineId: 'txn-016-2', category: '  ' }])).toBe(false)
  })
})

describe('unsupported transactions are protected', () => {
  const readOnly: LedgerTransaction = { ...costco, source: 'quickbooks', transactionType: 'Deposit', readOnlyReason: 'Deposits, transfers and payments are read-only here.' }

  it('refuses any change to a read-only transaction', () => {
    const result = validateLineChanges(readOnly, [{ lineId: 'txn-016-2', category: 'Meals' }])
    expect(result).toEqual({ ok: false, error: readOnly.readOnlyReason })
    expect(() => applyLineChanges(readOnly, [{ lineId: 'txn-016-2', category: 'Meals' }])).toThrow(/read-only/)
  })
})

describe('filtering and search', () => {
  it('filters by status', () => {
    const review = filterTransactions(transactions, { status: 'Needs Review' })
    expect(review.length).toBeGreaterThan(0)
    expect(review.every((item) => item.status === 'Needs Review')).toBe(true)
    expect(filterTransactions(transactions, { status: 'All' })).toHaveLength(transactions.length)
  })

  it('filters by category, including categories on individual lines of a split', () => {
    const office = filterTransactions(transactions, { category: 'Office Supplies' })
    expect(office.map((item) => item.id)).toContain('txn-016')
    expect(office.map((item) => item.id)).toContain('txn-014')
    expect(filterTransactions(transactions, { category: 'Meals' }).map((item) => item.id)).not.toContain('txn-016')
  })

  it('searches vendor, description and line descriptions without regard to case', () => {
    expect(filterTransactions(transactions, { search: 'costco' }).map((item) => item.id)).toEqual(['txn-016'])
    expect(filterTransactions(transactions, { search: 'LADDER' }).map((item) => item.id)).toEqual(['txn-017'])
    expect(filterTransactions(transactions, { search: 'cleaning supplies' }).map((item) => item.id)).toEqual(['txn-016'])
    expect(filterTransactions(transactions, { search: 'no such text' })).toEqual([])
    expect(filterTransactions(transactions, { search: '   ' })).toHaveLength(transactions.length)
  })

  it('combines filters', () => {
    const result = filterTransactions(transactions, { status: 'Needs Review', search: 'home depot' })
    expect(result.map((item) => item.id)).toEqual(['txn-002', 'txn-017'])
  })

  it('lists the categories present, including split lines, without duplicates', () => {
    const categories = categoriesIn(transactions)
    expect(categories).toContain('Materials')
    expect(categories).toContain('Office Supplies')
    expect(new Set(categories).size).toBe(categories.length)
  })
})

describe('client filtering', () => {
  const others: Transaction[] = [{ ...byId('txn-003'), id: 'other-1', clientId: 'green-leaf-landscaping', payee: 'Shell' }]
  const all = [...transactions, ...others]

  it('shows only the selected client’s transactions', () => {
    const selected = filterTransactions(all, { clientId: 'green-leaf-landscaping' })
    expect(selected.map((item) => item.id)).toEqual(['other-1'])
    expect(filterTransactions(all, { clientId: 'abc-plumbing' })).toHaveLength(transactions.length)
  })

  it('shows every client when none is selected', () => {
    expect(filterTransactions(all, { clientId: null })).toHaveLength(all.length)
  })

  it('does not drop records that carry no client', () => {
    const untagged = { ...byId('txn-003'), clientId: undefined }
    expect(filterTransactions([untagged], { clientId: 'abc-plumbing' })).toHaveLength(1)
  })
})

describe('review navigation', () => {
  const queue = transactions.filter((item) => matchesReviewFilter(item, 'Needs Review'))

  it('finds the next and previous transaction that still needs review', () => {
    const [first, second] = queue
    expect(adjacentInQueue(transactions, queue, first.id, 'next')?.id).toBe(second.id)
    expect(adjacentInQueue(transactions, queue, second.id, 'previous')?.id).toBe(first.id)
  })

  it('returns nothing past either end of the queue', () => {
    expect(adjacentInQueue(transactions, queue, queue[queue.length - 1].id, 'next')).toBeUndefined()
    expect(adjacentInQueue(transactions, queue, queue[0].id, 'previous')).toBeUndefined()
  })

  it('still works when the current transaction has just left the queue', () => {
    const current = queue[1]
    const remaining = queue.filter((item) => item.id !== current.id)
    expect(adjacentInQueue(transactions, remaining, current.id, 'next')?.id).toBe(queue[2].id)
    expect(adjacentInQueue(transactions, remaining, current.id, 'previous')?.id).toBe(queue[0].id)
  })

  it('skips transactions that do not need review', () => {
    const next = adjacentInQueue(transactions, queue, queue[0].id, 'next')!
    expect(matchesReviewFilter(next, 'Needs Review')).toBe(true)
  })

  it('returns nothing for an unknown transaction', () => {
    expect(adjacentInQueue(transactions, queue, 'unknown', 'next')).toBeUndefined()
  })

  it('treats a split with an uncategorized line as missing a category', () => {
    expect(matchesReviewFilter(costco, 'Missing Category')).toBe(true)
    expect(matchesReviewFilter(applyLineChanges(applyLineChanges(costco, [{ lineId: 'txn-016-2', category: 'Meals' }]), [{ lineId: 'txn-016-3', category: 'Other' }]), 'Missing Category')).toBe(false)
  })
})

describe('category suggestions', () => {
  const suggestions = suggestCategories(homeDepotSplit, transactions)

  it('suggests from earlier transactions with the same payee and says why', () => {
    const suggestion = suggestions['txn-017-2']
    expect(suggestion.category).toBe('Materials')
    expect(suggestion.basedOn).toBe(2)
    expect(suggestion.confidence).toBe('Medium')
    expect(suggestion.reasons.join(' ')).toMatch(/Used for 2 of 2 earlier Home Depot lines/)
    expect(suggestion.reasons.join(' ')).toMatch(/Most recently on/)
  })

  it('only proposes categories for lines that are not yet categorized', () => {
    expect(Object.keys(suggestions)).toEqual(['txn-017-2'])
  })

  it('never changes anything by itself', () => {
    const snapshot = structuredClone(homeDepotSplit)
    suggestCategories(homeDepotSplit, transactions)
    expect(homeDepotSplit).toEqual(snapshot)
    expect(getLines(homeDepotSplit)[1].category).toBe('Uncategorized')
  })

  it('has no opinion about an unknown payee or one never seen before', () => {
    expect(suggestCategories({ ...costco, payee: 'Unknown' }, transactions)).toEqual({})
    expect(suggestCategories(costco, transactions)).toEqual({})
  })

  it('only uses the same client’s history', () => {
    const foreign = transactions.map((item) => ({ ...item, clientId: 'someone-else' }))
    expect(suggestCategories(homeDepotSplit, foreign)).toEqual({})
  })

  it('is more confident with more consistent history and mentions exact-amount matches', () => {
    const history: Transaction[] = ['a', 'b', 'c'].map((id, index) => ({ id, date: `Aug 0${index + 1}, 2026`, payee: 'Acme Supply', description: 'Parts', amount: '$50.00', category: 'Materials', status: 'Matched' }))
    const target: Transaction = { id: 't', date: 'Aug 20, 2026', payee: 'Acme Supply', description: 'Parts', amount: '$50.00', category: 'Uncategorized', status: 'Needs Review' }
    const result = suggestCategories(target, history)[getLines(target)[0].id]
    expect(result.confidence).toBe('High')
    expect(result.reasons.join(' ')).toMatch(/\$50\.00 Acme Supply charge/)
  })

  it('is cautious when history disagrees', () => {
    const mixed: Transaction[] = ['Materials', 'Meals', 'Equipment'].map((category, index) => ({ id: `m${index}`, date: `Aug 0${index + 1}, 2026`, payee: 'Acme Supply', description: 'Stuff', amount: `$${10 + index}.00`, category, status: 'Matched' }))
    const target: Transaction = { id: 't', date: 'Aug 20, 2026', payee: 'Acme Supply', description: 'Other', amount: '$99.00', category: 'Uncategorized', status: 'Needs Review' }
    expect(suggestCategories(target, mixed)[getLines(target)[0].id].confidence).toBe('Low')
  })

  it('uses wording on a line to prefer the matching category', () => {
    const history: Transaction[] = [
      { id: 'h1', date: 'Aug 01, 2026', payee: 'Costco Wholesale', description: 'Coffee and snacks', amount: '$40.00', category: 'Meals', status: 'Matched' },
      { id: 'h2', date: 'Aug 02, 2026', payee: 'Costco Wholesale', description: 'Printer paper', amount: '$40.00', category: 'Office Supplies', status: 'Matched' },
    ]
    const result = suggestCategories(costco, history)
    expect(result['txn-016-2'].category).toBe('Meals')
    expect(result['txn-016-2'].reasons.join(' ')).toMatch(/Similar wording/)
  })
})
