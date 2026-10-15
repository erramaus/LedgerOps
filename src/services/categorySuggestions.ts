import type { Transaction } from './bookkeepingTypes'
import { getLines, isUncategorized, SPLIT_CATEGORY, toCents } from './transactionReview'

export type Confidence = 'High' | 'Medium' | 'Low'
/** A proposal only. Nothing is ever posted until the user approves it. */
export type Suggestion = { category: string; confidence: Confidence; reasons: string[]; basedOn: number }

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'new', 'job'])
const words = (value: string) => new Set(normalize(value).split(' ').filter((word) => word.length >= 4 && !STOP_WORDS.has(word)))
const when = (date: string) => (Number.isNaN(Date.parse(date)) ? 0 : Date.parse(date))
const sharedWord = (left: string, right: string) => [...words(left)].find((word) => words(right).has(word))
const formatMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

type Evidence = { score: number; count: number; latest: Transaction; latestDate: number; sameAmount?: Transaction; wording?: { word: string; text: string } }

/**
 * Suggests a category for each uncategorized line from earlier categorized transactions with the
 * same payee for the same client, and explains every suggestion.
 */
export function suggestCategories(transaction: Transaction, history: Transaction[]): Record<string, Suggestion> {
  const payee = normalize(transaction.payee || '')
  const suggestions: Record<string, Suggestion> = {}
  if (!payee || payee === 'unknown') return suggestions

  const comparable = history.filter(
    (other) => other.id !== transaction.id && normalize(other.payee || '') === payee && (!transaction.clientId || !other.clientId || other.clientId === transaction.clientId),
  )
  const past = comparable.flatMap((other) => getLines(other).filter((line) => !isUncategorized(line.category) && line.category !== SPLIT_CATEGORY).map((line) => ({ other, line })))
  if (past.length === 0) return suggestions

  for (const line of getLines(transaction)) {
    if (!isUncategorized(line.category)) continue
    const text = line.description || transaction.description
    const byCategory = new Map<string, Evidence>()
    for (const { other, line: earlier } of past) {
      const sameAmount = toCents(earlier.amount) === toCents(line.amount)
      const word = sharedWord(text, earlier.description || other.description)
      const entry = byCategory.get(earlier.category) ?? { score: 0, count: 0, latest: other, latestDate: 0 }
      entry.score += 1 + (sameAmount ? 1 : 0) + (word ? 1 : 0)
      entry.count += 1
      if (when(other.date) >= entry.latestDate) {
        entry.latest = other
        entry.latestDate = when(other.date)
      }
      if (sameAmount) entry.sameAmount = other
      if (word && !entry.wording) entry.wording = { word, text: earlier.description || other.description }
      byCategory.set(earlier.category, entry)
    }

    const ranked = [...byCategory.entries()].sort((left, right) => right[1].score - left[1].score || right[1].count - left[1].count || right[1].latestDate - left[1].latestDate)
    const [category, top] = ranked[0]
    const share = top.count / past.length
    const confidence: Confidence = top.count >= 3 && share >= 0.8 ? 'High' : top.count >= 2 && share >= 0.6 ? 'Medium' : 'Low'
    const name = transaction.payee.trim()
    const reasons = [
      past.length === 1 ? `Used once before for ${name}.` : `Used for ${top.count} of ${past.length} earlier ${name} lines.`,
      `Most recently on ${top.latest.date}.`,
    ]
    if (top.sameAmount) reasons.push(`A ${formatMoney(line.amount)} ${name} charge on ${top.sameAmount.date} was also ${category}.`)
    if (top.wording) reasons.push(`Similar wording ("${top.wording.word}") appears in "${top.wording.text}".`)
    suggestions[line.id] = { category, confidence, reasons, basedOn: past.length }
  }
  return suggestions
}
