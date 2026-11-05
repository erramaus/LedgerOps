import { describe, expect, it } from 'vitest'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from '../../shared/demoCompanyBooks'
import type { Transaction } from './bookkeepingTypes'
import { companyTransactions } from './demoCompanyData'
import { demoDataService } from './demoDataService'
import { explainFinding } from './reviewFindings'
import { FALLBACK_LIMIT, MIN_CLIENT_HISTORY, parseAmountValue, unusualAmounts, unusualAmountsByClient } from './unusualAmounts'
import { buildReviewTasks, buildWorkTasks, summarizeTasks, type ClientRecords } from './workQueue'

const companies = ADDITIONAL_DEMO_CLIENT_IDS.flatMap((id) => {
  const company = getAdditionalDemoCompany(id)
  return company ? [{ id, name: company.clientName, transactions: companyTransactions(company) }] : []
})
const everyCompany = [{ id: demoDataService.demoClient.id, name: demoDataService.demoClient.name, transactions: demoDataService.transactions }, ...companies]

const tx = (id: string, amount: number, payee = 'Vendor', extra: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-08-01', payee, description: '', amount: `$${amount.toFixed(2)}`, category: 'Supplies', status: 'Categorized', ...extra,
})
const records = (transactions: Transaction[], id = 'c1'): ClientRecords => ({ client: { id, name: id }, transactions, invoices: [], bills: [], accounts: [], reconciliations: [], requests: [], monthEnd: [], today: '2026-10-15' })
// Fifteen routine purchases of about $200 to $400.
const routine = (prefix = 'r') => Array.from({ length: 15 }, (_, index) => tx(`${prefix}${index}`, 200 + index * 12, `Shop ${index % 5}`))

describe('unusual amount detection', () => {
  it('flags far fewer routine transactions than the old $1,000 rule in every demo company', () => {
    everyCompany.forEach(({ name, transactions }) => {
      const old = transactions.filter((item) => parseAmountValue(item.amount) >= 1000).length
      const now = unusualAmounts(transactions).size
      expect(now, name).toBeLessThan(Math.max(old, 1))
      expect(now, name).toBeLessThanOrEqual(Math.ceil(transactions.length * 0.1))
    })
    const construction = companies.find((company) => company.name === 'Smith Construction')!
    expect(construction.transactions.every((item) => parseAmountValue(item.amount) >= 1000)).toBe(true)
    expect(unusualAmounts(construction.transactions).size).toBe(0)
  })

  it('still detects a genuinely unusual amount against a company’s own history', () => {
    const history = routine()
    const flagged = unusualAmounts([...history, tx('big', 9500, 'Shop 1')])
    expect(flagged.has('big')).toBe(true)
    expect(flagged.get('big')?.basis).not.toBe('fallback')
    expect(history.some((item) => flagged.has(item.id))).toBe(false)
    const smith = companies.find((company) => company.name === 'Smith Construction')!
    expect(unusualAmounts([...smith.transactions, tx('huge', 900000, 'New Vendor')]).has('huge')).toBe(true)
  })

  it('does not flag a modest increase', () => {
    expect(unusualAmounts([...routine(), tx('a-bit-more', 700)]).size).toBe(0)
  })

  it('uses vendor history when a payee’s usual amount is far exceeded', () => {
    const vendor = Array.from({ length: 6 }, (_, index) => tx(`v${index}`, 400 + index * 10, 'Power Co'))
    const wide = Array.from({ length: 8 }, (_, index) => tx(`w${index}`, 100 + index * 600, `Other ${index}`))
    const result = unusualAmounts([...vendor, ...wide, tx('spike', 1800, 'Power Co')])
    expect(result.get('spike')?.basis).toBe('vendor')
    expect(result.get('spike')?.explanation).toMatch(/Power Co/)
  })

  it('uses a clearly labelled conservative fallback when history is insufficient', () => {
    const few = Array.from({ length: MIN_CLIENT_HISTORY - 2 }, (_, index) => tx(`f${index}`, 100))
    expect(unusualAmounts([...few, tx('small', FALLBACK_LIMIT - 1)]).size).toBe(0)
    const result = unusualAmounts([...few, tx('large', FALLBACK_LIMIT)])
    const finding = result.get('large')
    expect(finding?.basis).toBe('fallback')
    expect(finding?.explanation).toMatch(/too little history/)
    expect(finding?.typical).toBeUndefined()
  })

  it('explains the comparison without claiming an error or statistical confidence', () => {
    const explanation = unusualAmounts([...routine(), tx('big', 9500)]).get('big')!.explanation
    expect(explanation).toMatch(/significantly larger than this client's typical transactions/)
    expect(explanation).toMatch(/\$9,500/)
    expect(explanation).toMatch(/based on 15 other transactions/)
    expect(explanation).not.toMatch(/error|wrong|fraud|confidence|probab|%/i)
  })

  it('ignores zero and unreadable amounts', () => {
    const result = unusualAmounts([...routine(), tx('zero', 0), { ...tx('bad', 1), amount: 'n/a' }])
    expect(result.size).toBe(0)
  })

  it('judges each client separately, so one company’s normal never sets another’s', () => {
    const dental = routine('d').map((item) => ({ ...item, clientId: 'dental' }))
    const construction = Array.from({ length: 15 }, (_, index) => ({ ...tx(`c${index}`, 40000 + index * 1000, `Supplier ${index % 4}`), clientId: 'construction' }))
    const dentalOutlier = { ...tx('d-outlier', 9500), clientId: 'dental' }
    const constructionRoutine = { ...tx('c-routine', 50000), clientId: 'construction' }
    const grouped = unusualAmountsByClient([...dental, ...construction, dentalOutlier, constructionRoutine])
    expect(grouped.has('d-outlier')).toBe(true)
    expect(grouped.has('c-routine')).toBe(false)
    // Mixed together the dental amount would look normal next to construction spending, which is why they are never mixed.
    expect(unusualAmounts([...routine('d'), ...construction, tx('d-outlier', 9500)]).has('d-outlier')).toBe(false)
  })
})

describe('review tasks for unusual amounts', () => {
  it('creates one explained, Medium-priority task for an unusual categorized transaction', () => {
    const tasks = buildReviewTasks(records([...routine(), tx('big', 9500)]))
    const large = tasks.filter((task) => task.kind === 'large-transaction')
    expect(large).toHaveLength(1)
    expect(large[0].priority).toBe('Medium')
    expect(large[0].suspected).toBe(true)
    expect(large[0].recordId).toBe('big')
    expect(large[0].description).toMatch(/significantly larger/)
    expect(explainFinding(large[0]).why).toMatch(/Possible issue, not a confirmed error/)
  })

  it('does not make every large transaction High priority', () => {
    const tasks = buildReviewTasks(records([...routine(), tx('big', 9500)]))
    expect(tasks.filter((task) => task.priority === 'High')).toHaveLength(0)
  })

  it('uses Low priority for the short-history fallback', () => {
    const tasks = buildReviewTasks(records([tx('a', 100), tx('b', 7000)]))
    expect(tasks.find((task) => task.kind === 'large-transaction')?.priority).toBe('Low')
  })

  it('folds the unusual amount into a missing-category task instead of adding a second task', () => {
    const tasks = buildReviewTasks(records([...routine(), tx('big', 9500, 'Vendor', { category: 'Uncategorized', status: 'Needs Review' })]))
    const forBig = tasks.filter((task) => task.recordId === 'big')
    expect(forBig.map((task) => task.kind)).toEqual(['uncategorized'])
    expect(forBig[0].priority).toBe('High')
    expect(forBig[0].description).toMatch(/Also unusual: .*significantly larger/)
  })

  it('keeps a possible duplicate as its own task next to the unusual amount', () => {
    const tasks = buildReviewTasks(records([...routine(), tx('big', 9500, 'Acme'), tx('big2', 9500, 'Acme')]))
    const kinds = tasks.filter((task) => task.recordId === 'big2').map((task) => task.kind).sort()
    expect(kinds).toEqual(['large-transaction', 'possible-duplicate'])
  })

  it('preserves the existing missing category, payee, receipt and duplicate checks', () => {
    const tasks = buildReviewTasks(records([
      ...routine(),
      tx('nocat', 50, 'Acme', { category: 'Uncategorized', status: 'Needs Review' }),
      tx('nopayee', 50, 'Unknown'),
      tx('receipt', 50, 'Shop 9', { status: 'Needs Receipt' }),
      tx('dup-a', 77, 'Twin'), tx('dup-b', 77, 'Twin'),
    ]))
    const kinds = new Set(tasks.map((task) => task.kind))
    ;(['uncategorized', 'missing-payee', 'needs-receipt', 'possible-duplicate'] as const).forEach((kind) => expect(kinds.has(kind), kind).toBe(true))
  })
})

describe('Dashboard, Inbox and Review counts per company', () => {
  const perClient = everyCompany.map(({ id, name, transactions }) => ({ name, tasks: buildWorkTasks(records(transactions, id)) }))

  it('raise no unusual-amount task for routine demo activity, and the totals agree', () => {
    perClient.forEach(({ name, tasks }) => {
      expect(tasks.filter((task) => task.kind === 'large-transaction'), name).toHaveLength(0)
    })
    const all = perClient.flatMap((entry) => entry.tasks)
    const summed = perClient.reduce((total, entry) => total + summarizeTasks(entry.tasks).transactions, 0)
    expect(summarizeTasks(all).transactions).toBe(summed)
  })

  it('keeps each unusual-amount task inside its own client', () => {
    const smith = companies.find((company) => company.name === 'Smith Construction')!
    const dental = companies.find((company) => company.name === 'Johnson Dental')!
    const smithTasks = buildReviewTasks(records([...smith.transactions, tx('huge', 900000, 'New Vendor')], smith.id))
    const dentalTasks = buildReviewTasks(records(dental.transactions, dental.id))
    expect(smithTasks.some((task) => task.kind === 'large-transaction' && task.recordId === 'huge')).toBe(true)
    expect(dentalTasks.some((task) => task.recordId === 'huge')).toBe(false)
  })
})
