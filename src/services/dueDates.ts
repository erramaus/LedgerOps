export type DueTone = 'overdue' | 'soon' | 'later'
export type DueDescription = { label: string; tone: DueTone; days: number }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function dayNumber(iso: string) {
  const match = ISO_DATE.exec(iso)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const time = Date.UTC(year, month - 1, day)
  const check = new Date(time)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return time / 86_400_000
}

const plural = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`

/** Relative wording for a due date, always measured from the `today` that is passed in (never a fixed date). Invalid dates give undefined. */
export function describeDue(dueIso: string, todayIso: string): DueDescription | undefined {
  const due = dayNumber(dueIso)
  const today = dayNumber(todayIso)
  if (due === null || today === null) return undefined
  const days = due - today
  if (days < 0) return { label: `Overdue by ${plural(-days)}`, tone: 'overdue', days }
  if (days === 0) return { label: 'Due today', tone: 'soon', days }
  if (days === 1) return { label: 'Due tomorrow', tone: 'soon', days }
  return { label: `Due in ${plural(days)}`, tone: days <= 7 ? 'soon' : 'later', days }
}
