import { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_CLIENT_ID } from "../shared/demoBooks";
import { ADDITIONAL_DEMO_CLIENT_IDS } from "../shared/demoCompanyBooks";
import { demoMonthEndInputs, type DemoLedger } from "../shared/demoMonthEnd";
import { buildChecklist, monthEndId, type MonthEndRecord } from "../shared/monthEnd";
import { periodKey, type Period } from "../shared/period";
import type { MonthEndItem } from "./data/demoData";
import type { ClientRequest, Transaction } from "./services/bookkeepingTypes";
import { toMonthEndItems, transactionFacts } from "./services/monthEndData";
import { monthEndService } from "./services/monthEndService";
import { reconciliationService, type RecordSummary } from "./services/reconciliationService";

export const ALL_DEMO_CLIENT_IDS = [DEMO_CLIENT_ID, ...ADDITIONAL_DEMO_CLIENT_IDS];

/** Under All clients (Demo Mode) every company's records are loaded; otherwise only the selected client's. */
export const loadedDemoClientIds = (selectedId: string | undefined, source: string) => (selectedId ? [selectedId] : source === "demo" ? ALL_DEMO_CLIENT_IDS : [DEMO_CLIENT_ID]);

export type ClientMonthEndContext = { id: string; name: string; ledger: DemoLedger; transactions: Transaction[]; requests: ClientRequest[] };
export type StoredMonthEnd = { records: RecordSummary[]; record: MonthEndRecord | null };

/** The month-end checks for one demo client, built from its stored reconciliations and sign-offs exactly as the Month End tab builds them. */
export function clientMonthEndItems(period: Period, context: ClientMonthEndContext, stored: StoredMonthEnd, today: string): MonthEndItem[] {
  const live = transactionFacts(period, context.transactions, context.requests);
  const inputs = demoMonthEndInputs(period, {
    records: stored.records, signoffs: stored.record?.signoffs ?? {}, closing: stored.record?.closing,
    liveTransactions: live.facts.total > 0 && live.undated === 0 ? live.facts : null, ledger: context.ledger, clientId: context.id, today,
  });
  return toMonthEndItems(buildChecklist(inputs));
}

type Args = { enabled: boolean; contexts: ClientMonthEndContext[]; period: Period; today: string; refreshToken: unknown };

/**
 * Month-end checks for the demo clients other than the selected one. Stored reconciliations and sign-offs are read from the server;
 * a client whose stored state could not be read has no entry, so the caller never treats it as complete.
 */
export function useClientsMonthEnd({ enabled, contexts, period, today, refreshToken }: Args): Record<string, MonthEndItem[]> {
  const key = periodKey(period);
  const ids = contexts.map((context) => context.id).join(",");
  const [stored, setStored] = useState<{ key: string; data: Record<string, StoredMonthEnd> }>({ key: "", data: {} });
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled || !ids) return;
    const run = ++latest.current;
    Promise.all(ids.split(",").map(async (id): Promise<[string, StoredMonthEnd | null]> => {
      const [records, record] = await Promise.allSettled([reconciliationService.list("demo", id), monthEndService.get(monthEndId("demo", id, key))]);
      return records.status === "fulfilled" && record.status === "fulfilled" ? [id, { records: records.value.records, record: record.value }] : [id, null];
    })).then((entries) => {
      if (run !== latest.current) return;
      setStored({ key, data: Object.fromEntries(entries.filter((entry): entry is [string, StoredMonthEnd] => entry[1] !== null)) });
    }, () => { if (run === latest.current) setStored({ key, data: {} }); });
    return () => { latest.current += 1; };
  }, [enabled, ids, key, today, refreshToken]);

  return useMemo(() => {
    const result: Record<string, MonthEndItem[]> = {};
    if (stored.key !== key) return result;
    for (const context of contexts) {
      const saved = stored.data[context.id];
      if (saved) result[context.id] = clientMonthEndItems(period, context, saved, today);
    }
    return result;
  }, [contexts, stored, key, period, today]);
}
