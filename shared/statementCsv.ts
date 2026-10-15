import type { AccountKind, Direction, StatementLine } from './reconciliation.js'
import { daysBetween, isValidIsoDate, parseMoneyToCents } from './reconciliation.js'

export const MAX_CSV_ROWS = 5000

/** Parses CSV text (quoted fields, escaped quotes, embedded newlines; comma, semicolon or tab). */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].map((candidate) => ({ candidate, count: firstLine.split(candidate).length })).sort((left, right) => right.count - left.count)[0].candidate
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      field = ''
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      if (rows.length > MAX_CSV_ROWS + 1) throw new Error(`The file has more than ${MAX_CSV_ROWS} rows.`)
    } else field += char
  }
  row.push(field)
  if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  if (quoted) throw new Error('The file has an unclosed quote.')
  return rows
}

export type DateFormat = 'auto' | 'MDY' | 'DMY' | 'YMD'
export type CsvMapping = {
  hasHeader: boolean
  date: number
  description: number
  /** Single signed amount column; positive values are `positiveMeans`. */
  amount?: number
  debit?: number
  credit?: number
  /** For debit/credit columns: which way a debit moves the statement balance. */
  debitMeans: Direction
  positiveMeans: Direction
  dateFormat: DateFormat
}

export function suggestMapping(headers: string[], kind: AccountKind): CsvMapping {
  const find = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header.trim()))
  const amount = find(/^(amount|transaction amount)$/i)
  const debit = find(/debit|withdraw/i)
  const credit = find(/credit|deposit/i)
  const description = find(/desc|memo|payee|name|detail|merchant/i)
  return {
    hasHeader: true,
    date: Math.max(0, find(/date/i)),
    description: description === -1 ? Math.min(1, headers.length - 1) : description,
    ...(amount !== -1 ? { amount } : debit !== -1 || credit !== -1 ? { debit: debit === -1 ? undefined : debit, credit: credit === -1 ? undefined : credit } : { amount: Math.max(0, headers.length - 1) }),
    debitMeans: kind === 'bank' ? 'decrease' : 'increase',
    positiveMeans: 'increase',
    dateFormat: 'auto',
  }
}

export function parseDate(value: string, format: DateFormat): { iso: string; ambiguous: boolean } | null {
  const text = value.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const pad = (part: string | number) => String(part).padStart(2, '0')
  if (iso) {
    const candidate = `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`
    return isValidIsoDate(candidate) ? { iso: candidate, ambiguous: false } : null
  }
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text)
  if (!slash) return null
  const [first, second] = [Number(slash[1]), Number(slash[2])]
  const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])
  let order: 'MDY' | 'DMY' | 'YMD' = format === 'auto' ? (first > 12 ? 'DMY' : 'MDY') : format
  if (order === 'YMD') order = 'MDY'
  const [month, day] = order === 'MDY' ? [first, second] : [second, first]
  const candidate = `${year}-${pad(month)}-${pad(day)}`
  if (!isValidIsoDate(candidate)) return null
  return { iso: candidate, ambiguous: format === 'auto' && first <= 12 && second <= 12 && first !== second }
}

export type RowProblem = { row: number; message: string }
export type CsvImport = { lines: StatementLine[]; errors: RowProblem[]; warnings: RowProblem[] }

/** Turns mapped rows into statement lines; nothing is sent anywhere. */
export function applyMapping(rows: string[][], mapping: CsvMapping, period: { start: string; end: string }): CsvImport {
  const lines: StatementLine[] = []
  const errors: RowProblem[] = []
  const warnings: RowProblem[] = []
  const body = mapping.hasHeader ? rows.slice(1) : rows
  const offset = mapping.hasHeader ? 2 : 1
  let ambiguous = 0

  body.forEach((cells, index) => {
    const row = index + offset
    const date = parseDate(cells[mapping.date] ?? '', mapping.dateFormat)
    if (!date) { errors.push({ row, message: `Row ${row}: "${cells[mapping.date] ?? ''}" is not a valid date.` }); return }
    if (date.ambiguous) ambiguous += 1

    const cell = (column?: number) => (column === undefined ? '' : (cells[column] ?? '').trim())
    let signed: number | null = null
    if (mapping.amount !== undefined) {
      const cents = parseMoneyToCents(cell(mapping.amount))
      signed = cents === null ? null : mapping.positiveMeans === 'increase' ? cents : -cents
    } else {
      const debit = cell(mapping.debit) === '' ? 0 : parseMoneyToCents(cell(mapping.debit))
      const credit = cell(mapping.credit) === '' ? 0 : parseMoneyToCents(cell(mapping.credit))
      if (debit === null || credit === null) signed = null
      else if (debit !== 0 && credit !== 0) { errors.push({ row, message: `Row ${row}: both a debit and a credit are filled in.` }); return }
      else {
        const moves = debit !== 0 ? Math.abs(debit) : -Math.abs(credit)
        signed = mapping.debitMeans === 'increase' ? moves : -moves
      }
    }
    if (signed === null) { errors.push({ row, message: `Row ${row}: the amount is not a valid number.` }); return }
    if (signed === 0) { warnings.push({ row, message: `Row ${row}: a zero-amount line was skipped.` }); return }

    const direction: Direction = signed > 0 ? 'increase' : 'decrease'
    lines.push({ id: `line-${lines.length + 1}`, date: date.iso, description: (cells[mapping.description] ?? '').trim(), amountCents: Math.abs(signed), direction })
    if (date.iso < period.start || date.iso > period.end) {
      const early = date.iso < period.start ? daysBetween(date.iso, period.start) : daysBetween(period.end, date.iso)
      warnings.push({ row, message: `Row ${row}: ${date.iso} is ${early} day${early === 1 ? '' : 's'} outside the statement period.` })
    }
  })
  if (ambiguous > 0) warnings.push({ row: 0, message: `${ambiguous} date${ambiguous === 1 ? ' is' : 's are'} ambiguous (day and month could swap). Choose the date format to be sure.` })
  if (lines.length === 0 && errors.length === 0) errors.push({ row: 0, message: 'No transactions were found in the file.' })
  return { lines, errors, warnings }
}
