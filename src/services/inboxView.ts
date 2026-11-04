import { describeDue, type DueDescription } from './dueDates'
import type { WorkTask } from './workQueue'

export type Readiness = 'all' | 'ready' | 'waiting'

/** The browser's own calendar date (not UTC), as YYYY-MM-DD. */
export function localIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A task is waiting when someone else has to act first. Nothing here changes a task's stored status. */
export const isWaiting = (task: WorkTask) => task.status === 'Waiting on client'

export function filterByReadiness(tasks: WorkTask[], readiness: Readiness): WorkTask[] {
  if (readiness === 'all') return tasks
  return tasks.filter((task) => (readiness === 'waiting' ? isWaiting(task) : !isWaiting(task)))
}

/** Case-insensitive match over every word typed against the client, task text, identifiers, amount and record. */
export function searchTasks(tasks: WorkTask[], query: string): WorkTask[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return tasks
  return tasks.filter((task) => {
    const amount = task.amount === undefined ? '' : `${task.amount} ${task.amount.toFixed(2)} ${task.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const haystack = [task.client, task.type, task.issue, task.description, task.action, task.status, task.priority, task.recordId ?? '', amount, task.dueDate ?? ''].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** Relative due label measured from the supplied local date. Missing or invalid dates return undefined. */
export function dueLabel(task: WorkTask, todayIso: string): DueDescription | undefined {
  return task.dueDate ? describeDue(task.dueDate, todayIso) : undefined
}

/**
 * Drops wording the Due column already says ("is overdue", "is due soon", "due on <date>") but only when the task
 * has a due date, so vendors, invoice numbers and amounts stay in the text.
 */
export function cleanDescription(task: WorkTask): string {
  if (!task.dueDate) return task.description
  const cleaned = task.description
    .replace(/,? (?:and )?(?:is )?due (?:on|by) [A-Za-z0-9,/ -]+?(?=[.]|$)/i, '')
    .replace(/ is (?:overdue|due soon)(?=[.]|$)/i, '')
    .trim()
  return cleaned || task.description
}
