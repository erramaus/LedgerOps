import type { RuleMatch } from './automationRules'
import type { RecurringPattern } from './recurringTransactions'
import type { WorkTask, TaskPriority } from './workQueue'

export type ReminderClient = { id: string; name: string }

export function buildAutomationTasks(client: ReminderClient, matches: Map<string, RuleMatch>, patterns: RecurringPattern[]): WorkTask[] {
  const tasks: WorkTask[] = []
  void matches
  for (const pattern of patterns.filter((item) => item.missing)) {
    tasks.push({
      id: `${client.id}/${pattern.id}-missing-recurring`,
      clientId: client.id,
      client: client.name,
      type: 'Transactions',
      kind: 'missing-recurring',
      issue: 'Expected recurring transaction missing',
      description: `${pattern.vendor} is usually ${pattern.frequency.toLowerCase()} around ${pattern.expectedNextDate}. Expected amount ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(pattern.typicalAmountCents / 100)}.`,
      priority: pattern.reviewPriority as TaskPriority,
      dueDate: pattern.expectedNextDate,
      status: 'Ready to review',
      suspected: true,
      count: 1,
      destination: 'Transactions',
      action: 'Review recurring reminder',
      automationId: pattern.id,
    })
  }
  return dedupeAutomationTasks(tasks)
}

function dedupeAutomationTasks(tasks: WorkTask[]) {
  const byId = new Map<string, WorkTask>()
  for (const task of tasks) {
    const current = byId.get(task.id)
    if (!current || rank(task.priority) < rank(current.priority)) byId.set(task.id, task)
  }
  return [...byId.values()]
}

function rank(priority: TaskPriority) {
  return priority === 'High' ? 0 : priority === 'Medium' ? 1 : 2
}
