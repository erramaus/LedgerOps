import { DEMO_CLIENT_ID } from '../../shared/demoBooks'
import type { RecurringHistoryEntry } from './recurringTransactions'

const history = (id: string, clientId: string, date: string, payee: string, amountCents: number, description: string): RecurringHistoryEntry => ({
  id,
  clientId,
  source: 'demo',
  date,
  payee,
  amountCents,
  description,
})

export const demoRecurringHistory: RecurringHistoryEntry[] = [
  history('hist-abc-adobe-1', DEMO_CLIENT_ID, '2026-06-26', 'Adobe', 5_999, 'Creative Cloud monthly subscription'),
  history('hist-abc-adobe-2', DEMO_CLIENT_ID, '2026-07-26', 'Adobe', 5_999, 'Creative Cloud monthly subscription'),
  history('hist-abc-adobe-3', DEMO_CLIENT_ID, '2026-08-26', 'Adobe', 5_999, 'Creative Cloud monthly subscription'),
  history('hist-abc-state-farm-1', DEMO_CLIENT_ID, '2026-06-15', 'State Farm', 28_600, 'Commercial vehicle insurance'),
  history('hist-abc-state-farm-2', DEMO_CLIENT_ID, '2026-07-15', 'State Farm', 28_600, 'Commercial vehicle insurance'),
  history('hist-abc-state-farm-3', DEMO_CLIENT_ID, '2026-08-15', 'State Farm', 28_600, 'Commercial vehicle insurance'),
  history('hist-green-software-1', 'green-leaf-landscaping', '2026-06-05', 'Cloudline Software', 18_900, 'Scheduling software subscription'),
  history('hist-green-software-2', 'green-leaf-landscaping', '2026-07-05', 'Cloudline Software', 18_900, 'Scheduling software subscription'),
  history('hist-green-software-3', 'green-leaf-landscaping', '2026-08-05', 'Cloudline Software', 18_900, 'Scheduling software subscription'),
  history('hist-smith-insurance-1', 'smith-construction', '2026-06-12', 'Builders Mutual', 64_500, 'General liability insurance'),
  history('hist-smith-insurance-2', 'smith-construction', '2026-07-12', 'Builders Mutual', 64_500, 'General liability insurance'),
  history('hist-smith-insurance-3', 'smith-construction', '2026-08-12', 'Builders Mutual', 64_500, 'General liability insurance'),
  history('hist-johnson-rent-1', 'johnson-dental', '2026-06-01', 'Main Street Properties', 185_000, 'Office rent'),
  history('hist-johnson-rent-2', 'johnson-dental', '2026-07-01', 'Main Street Properties', 185_000, 'Office rent'),
  history('hist-johnson-rent-3', 'johnson-dental', '2026-08-01', 'Main Street Properties', 185_000, 'Office rent'),
  history('hist-acme-software-1', 'acme-consulting', '2026-06-09', 'Cloudline Software', 12_500, 'Research platform subscription'),
  history('hist-acme-software-2', 'acme-consulting', '2026-07-09', 'Cloudline Software', 12_500, 'Research platform subscription'),
  history('hist-acme-software-3', 'acme-consulting', '2026-08-09', 'Cloudline Software', 12_500, 'Research platform subscription'),
]
