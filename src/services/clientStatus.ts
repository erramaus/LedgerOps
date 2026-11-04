import { monthLabel, periodKey, type Period } from '../../shared/period'
import { describeDue } from './dueDates'
import type { WorkTask } from './workQueue'

export type Tone = 'success' | 'warning' | 'muted'
export type StatusLabel = { label: string; tone: Tone }

/** Bookkeeping attention is about open work items only; it says nothing about month-end completion. */
export function attentionStatus(open: number | null): StatusLabel {
  if (open === null) return { label: 'Bookkeeping: not available', tone: 'muted' }
  if (open === 0) return { label: 'No open bookkeeping items', tone: 'success' }
  return { label: `${open} open bookkeeping ${open === 1 ? 'item' : 'items'}`, tone: 'warning' }
}

/** Month-end completion is separate from bookkeeping attention: a client can be 100% complete and still have open work. */
export function monthEndStatus(percent: number | null): StatusLabel {
  if (percent === null) return { label: 'Month-end: not available', tone: 'muted' }
  if (percent >= 100) return { label: 'Month-end: complete', tone: 'success' }
  return { label: `Month-end: ${percent}% complete`, tone: 'warning' }
}

export type PeriodNotice = {
  label: string
  historical: boolean
  /** Whether the card's stored summary figures were produced for the selected period. */
  figuresMatch: boolean
}

/**
 * Describes the selected accounting period for a card. Never substitutes another month: when the client's summary
 * figures belong to a different period the caller must show them as unavailable for the selected one.
 */
export function periodNotice(selected: Period, figuresPeriodLabel: string | null, todayIso: string): PeriodNotice {
  const currentKey = todayIso.slice(0, 7)
  return {
    label: monthLabel(selected),
    historical: periodKey(selected) < currentKey,
    figuresMatch: figuresPeriodLabel === monthLabel(selected),
  }
}

/** The client's most urgent outstanding task (the list is already sorted most urgent first). */
export function nextTaskFor(tasks: WorkTask[], clientId: string, todayIso: string): { text: string; due?: string } | null {
  const task = tasks.find((item) => item.clientId === clientId)
  if (!task) return null
  const due = task.dueDate ? describeDue(task.dueDate, todayIso)?.label : undefined
  return { text: task.issue, due }
}
