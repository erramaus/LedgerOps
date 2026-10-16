import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEMO_CLIENT_ID } from "../shared/demoBooks";
import { demoMonthEndInputs, type DemoLedger } from "../shared/demoMonthEnd";
import { allUnavailable, buildChecklist, monthEndId, validateClose, type Checklist, type MonthEndInputs, type MonthEndRecord, type Source } from "../shared/monthEnd";
import { monthLabel, periodEnd, periodKey, periodStart, type Period } from "../shared/period";
import type { ClientRequest, LedgerAccount, LedgerBill, LedgerInvoice, LedgerTransaction, Transaction } from "./services/bookkeepingTypes";
import { failed, loaded, quickBooksInputs, transactionFacts, type Loaded } from "./services/monthEndData";
import { MonthEndApiError, monthEndService, type MonthEndStorage } from "./services/monthEndService";
import { loadReport } from "./services/periodReports";
import { quickBooksService } from "./services/quickBooksService";
import { reconciliationService, type RecordSummary } from "./services/reconciliationService";

export type QuickBooksReviewData = { transactions: LedgerTransaction[]; accounts: LedgerAccount[]; invoices: LedgerInvoice[]; bills: LedgerBill[] };

type Args = {
  enabled: boolean;
  source: Source;
  client: { id: string; name: string };
  period: Period;
  today: string;
  demoTransactions: Transaction[];
  /** Demo data only: the base demo books plus manually entered transactions. */
  ledger?: DemoLedger;
  requests: ClientRequest[];
  quickBooksData: QuickBooksReviewData | null;
  /** Changes whenever other workflows may have changed what Month End depends on (for example after visiting Reconcile). */
  refreshToken: unknown;
};

export type MonthEndView = {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  checklist: Checklist | null;
  record: MonthEndRecord | null;
  history: MonthEndRecord[];
  storage: MonthEndStorage | null;
  busy: boolean;
  actionError: string | null;
  clearActionError: () => void;
  signOff: (step: string, note: string, fingerprint: string, figures: string) => Promise<void>;
  withdraw: (step: string) => Promise<void>;
  close: () => Promise<void>;
  reopen: (reason: string) => Promise<void>;
  reload: () => void;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/** Gathers everything the month-end checklist depends on, for one source, client and month, and keeps the actions in one place. */
export function useMonthEnd(args: Args): MonthEndView {
  const { enabled, source, client, period, today, demoTransactions, requests, quickBooksData, refreshToken, ledger } = args;
  const key = periodKey(period);
  const recordId = monthEndId(source, client.id, key);
  const [status, setStatus] = useState<MonthEndView["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<MonthEndInputs | null>(null);
  const [record, setRecord] = useState<MonthEndRecord | null>(null);
  const [history, setHistory] = useState<MonthEndRecord[]>([]);
  const [storage, setStorage] = useState<MonthEndStorage | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const run = ++latest.current;
    setStatus("loading");
    setError(null);
    (async () => {
      const [recordsResult, recordResult, historyResult, storageResult] = await Promise.allSettled([
        reconciliationService.list(source, client.id),
        monthEndService.get(recordId),
        monthEndService.list(source, client.id),
        monthEndService.storage(),
      ]);
      if (run !== latest.current) return;
      if (recordResult.status === "rejected") {
        setStatus("error");
        setError(`The month-end record could not be loaded, so nothing can be checked or changed: ${errorText(recordResult.reason)}`);
        return;
      }
      const stored = recordResult.value;
      const reconciliationRecords: RecordSummary[] = recordsResult.status === "fulfilled" ? recordsResult.value.records : [];
      const reconciliationProblem = recordsResult.status === "rejected" ? `Saved reconciliations could not be loaded: ${errorText(recordsResult.reason)}` : null;
      const context = { records: reconciliationRecords, signoffs: stored?.signoffs ?? {}, closing: stored?.closing, requests };

      let inputs: MonthEndInputs;
      if (source === "demo") {
        if (client.id === DEMO_CLIENT_ID || ledger?.clientId === client.id) {
          const live = transactionFacts(period, demoTransactions, requests);
          inputs = demoMonthEndInputs(period, { records: reconciliationRecords, signoffs: context.signoffs, closing: context.closing, liveTransactions: live.facts.total > 0 && live.undated === 0 ? live.facts : null, ledger, clientId: client.id });
        } else {
          inputs = allUnavailable(key, `Detailed demo records are not set up for ${client.name}.`, context.signoffs, context.closing);
        }
      } else {
        const start = periodStart(period), end = periodEnd(period);
        const ranges = { start, end, label: monthLabel(period) };
        const [completeness, profitLoss, balanceSheet, trialBalance, receivables, payables] = await Promise.all([
          quickBooksService.getListCompleteness().then(loaded, (cause: unknown) => failed<Awaited<ReturnType<typeof quickBooksService.getListCompleteness>>>(errorText(cause))),
          loadReport("quickbooks", "profit-loss", ranges),
          loadReport("quickbooks", "balance-sheet", ranges),
          loadReport("quickbooks", "trial-balance", ranges),
          loadReport("quickbooks", "ar-aging", ranges),
          loadReport("quickbooks", "ap-aging", ranges),
        ]);
        if (run !== latest.current) return;
        const withCompleteness = <T,>(list: Loaded<T>, kind: "transactions" | "accounts"): Loaded<T> => {
          if (!list.ok) return list;
          if (!completeness.ok) return failed(`Could not confirm that every QuickBooks ${kind === "transactions" ? "transaction" : "account"} was loaded: ${completeness.reason}`);
          const verdict = completeness.value[kind];
          return verdict.complete ? list : failed(verdict.reasons.join(" "));
        };
        const lists = (quickBooksData ? loaded(quickBooksData) : failed<QuickBooksReviewData>("The QuickBooks data has not been loaded yet. Open Bookkeeping Review or reload."));
        inputs = quickBooksInputs(period, {
          transactions: withCompleteness(lists.ok ? loaded(lists.value.transactions) : failed(lists.reason), "transactions"),
          accounts: withCompleteness(lists.ok ? loaded(lists.value.accounts) : failed(lists.reason), "accounts"),
          profitLoss, balanceSheet, trialBalance, receivables, payables,
        }, context);
      }
      if (reconciliationProblem) {
        const reason = reconciliationProblem;
        inputs = { ...inputs, bankAccounts: { available: false, reason }, cardAccounts: { available: false, reason } };
      }
      setBase(inputs);
      setRecord(stored);
      setHistory(historyResult.status === "fulfilled" ? historyResult.value : []);
      setStorage(storageResult.status === "fulfilled" ? storageResult.value : null);
      setStatus("ready");
    })().catch((cause: unknown) => {
      if (run !== latest.current) return;
      setStatus("error");
      setError(errorText(cause));
    });
    return () => {
      latest.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, source, client.id, key, reloadCount, refreshToken, demoTransactions, requests, quickBooksData, ledger]);

  const inputs = useMemo(() => (base ? { ...base, signoffs: record?.signoffs ?? {}, closing: record?.closing } : null), [base, record]);
  const checklist = useMemo(() => (inputs ? buildChecklist(inputs) : null), [inputs]);

  const run = useCallback(async (action: () => Promise<MonthEndRecord>) => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      setRecord(next);
      setHistory((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    } catch (cause) {
      setActionError(errorText(cause));
      // A version conflict or a closed month means what is on screen is out of date.
      if (cause instanceof MonthEndApiError && (cause.code === "CONFLICT" || cause.code === "CLOSED" || cause.code === "NOT_CLOSED")) setReloadCount((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status, error, checklist, record, history, storage, busy, actionError,
    clearActionError: () => setActionError(null),
    signOff: (step, note, fingerprint, figures) => run(() => monthEndService.signOff(recordId, { step, note, fingerprint, figures, clientName: client.name, expectedVersion: record?.version ?? 0 })),
    withdraw: (step) => run(() => monthEndService.clearSignOff(recordId, step, record?.version ?? 0)),
    close: () =>
      run(async () => {
        if (!inputs || !record) throw new Error("Review the month before closing it.");
        const verdict = validateClose(inputs, { today });
        if (!verdict.ok) throw new Error(verdict.problems.join(" "));
        return monthEndService.close(recordId, { expectedVersion: record.version, checklist: verdict.closing.checklist, exceptions: verdict.closing.exceptions });
      }),
    reopen: (reason) => run(async () => {
      if (!record) throw new Error("This month has no record to reopen.");
      return monthEndService.reopen(recordId, record.version, reason);
    }),
    reload: () => setReloadCount((count) => count + 1),
  };
}
