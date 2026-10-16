import { buildDemoMonthEndRecords, buildDemoReconciliations } from '../shared/demoMonthEnd.js'
import type { MonthEndStore } from './monthEndStore.js'
import type { ReconciliationStore } from './reconciliationStore.js'

/**
 * Inserts the Demo Data scenario records (May to July 2026) if they are missing. They belong to the demo source
 * and the demo client only, and existing records are never overwritten, so real work on them is kept.
 */
export async function seedDemoRecords(reconciliations: ReconciliationStore, monthEnd: MonthEndStore) {
  let added = 0
  for (const record of buildDemoReconciliations()) if (await reconciliations.put(record, 0)) added += 1
  for (const record of buildDemoMonthEndRecords()) if (await monthEnd.put(record, 0)) added += 1
  return added
}
