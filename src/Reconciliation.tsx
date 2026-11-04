import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  computeReconciliation,
  formatCents,
  isValidIsoDate,
  labelsFor,
  parseMoneyToCents,
  previousFrom,
  reconciliationId,
  splitEligible,
  type AccountKind,
  type Completeness,
  type PreviousRecon,
  type ReconTxn,
  type ReconciliationRecord,
  type Source,
  type StatementLine,
} from "../shared/reconciliation";
import { applyMapping, parseCsv, suggestMapping, type CsvMapping } from "../shared/statementCsv";
import { periodEnd, periodStart, type Period } from "../shared/period";
import { buildReconciliationCsv, reportFileName } from "./services/reconciliationReport";
import { ReconciliationApiError, reconciliationService, type RecordSummary, type Storage } from "./services/reconciliationService";
import { filterHistory, formatLongDate, formatMonthKey, historyMonths, lastCompleted, monthKey, periodStatus, recordStatus, summarizePeriod, type MonthRef, type PeriodStatus } from "./services/reconStatus";
import { MissingTransactionPanel, type EntryPrefill, type EntryTools } from "./MissingTransaction";
import { displayBalance, netChangeCents, nextStatementDate, validateStatement } from "./services/statementStep";
import { completionChecklist, outstandingBasis } from "../shared/completionChecklist";
import { acceptMatch, classifyTxn, matchEvidence, planBulkClear, validateManualMatch } from "./services/matchView";

export type ReconAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  detail?: string;
  lastReconciled?: string;
  /** Prefilled statement values (demo data only). */
  defaults?: { periodStart: string; periodEnd: string; statementDate: string; beginningCents: number; endingCents: number; statementLines: StatementLine[] };
};
export type AccountData = { transactions: ReconTxn[]; completeness: Completeness };

type Step = "accounts" | "statement" | "match" | "review";
type Form = { periodStart: string; periodEnd: string; statementDate: string; beginning: string; ending: string; openingConfirmed: boolean };
type Work = { record: ReconciliationRecord; sourceTransactions: ReconTxn[]; assumedInOpening: ReconTxn[]; previous?: PreviousRecon; dirty: boolean };

const centsToInput = (cents: number) => (cents / 100).toFixed(2);
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const previousMonth = (today: string) => {
  const [year, month] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 2, 1));
  const end = new Date(Date.UTC(year, month - 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};
const errorText = (error: unknown) =>
  error instanceof ReconciliationApiError ? [error.message, ...error.issues.map((issue) => issue.message)].join(" ") : error instanceof Error ? error.message : "Something went wrong.";
const editable = (record: ReconciliationRecord) => ({
  clientName: record.clientName, accountName: record.accountName, accountKind: record.accountKind, periodStart: record.periodStart, statementDate: record.statementDate,
  beginningCents: record.beginningCents, endingCents: record.endingCents, openingConfirmed: record.openingConfirmed, statementMode: record.statementMode,
  statementLines: record.statementLines, transactions: record.transactions, clearedIds: record.clearedIds, matches: record.matches, completeness: record.completeness,
});
const signed = (item: { direction: string; amountCents: number }) => `${item.direction === "increase" ? "+" : "−"}${formatCents(item.amountCents)}`;

export function ReconcileWorkspace({
  source,
  client,
  accounts,
  loadAccountData,
  today,
  period,
  homeSignal,
  entryTools,
}: {
  source: Source;
  client: { id: string; name: string };
  accounts: ReconAccount[];
  loadAccountData: (accountId: string, through: string) => Promise<AccountData>;
  today: string;
  /** The accounting month chosen elsewhere in the app; statements default to it. */
  period?: Period;
  /** Changes when the user clicks Reconcile in the sidebar while already here: go back to the account list. */
  homeSignal?: number;
  /** Demo data only: lets the person record a transaction that is missing from the books. */
  entryTools?: EntryTools;
}) {
  const [step, setStep] = useState<Step>("accounts");
  const [storage, setStorage] = useState<Storage | null>(null);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [account, setAccount] = useState<ReconAccount | null>(null);
  const [form, setForm] = useState<Form>({ periodStart: "", periodEnd: "", statementDate: "", beginning: "", ending: "", openingConfirmed: false });
  const [statementLines, setStatementLines] = useState<StatementLine[]>([]);
  const [work, setWork] = useState<Work | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!homeSignal) return;
    if (work?.dirty && work.record.status !== "completed") {
      setNotice("You have unsaved progress on this reconciliation. Use Save for later first, then go back to the account list.");
      return;
    }
    setStep("accounts");
    setWork(null);
    setError(null);
    setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeSignal]);
  const refresh = async () => {
    try {
      const result = await reconciliationService.list(source, client.id);
      setRecords(result.records);
      setListError(null);
    } catch (listFailure) {
      setListError(errorText(listFailure));
    }
  };

  useEffect(() => {
    reconciliationService.storage().then(setStorage).catch(() => setStorage(null));
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, client.id]);

  // The month whose status the account cards show: the app's accounting month, else the previous month.
  const statusPeriod: MonthRef = period ?? { year: Number(previousMonth(today).end.slice(0, 4)), month: Number(previousMonth(today).end.slice(5, 7)) };
  const completedFor = (accountId: string) =>
    records.filter((record) => record.accountId === accountId && record.status === "completed").sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));

  /** Earlier completed reconciliations of this account: the opening-balance chain and what is already cleared. */
  const loadChain = async (accountId: string, periodEnd: string) => {
    const earlier = completedFor(accountId).filter((record) => record.periodEnd < periodEnd);
    const full = (await Promise.all(earlier.map((record) => reconciliationService.get(record.id)))).filter((record): record is ReconciliationRecord => record !== null);
    const latest = full[full.length - 1];
    return { previous: latest ? previousFrom(latest) : undefined, previouslyClearedIds: new Set(full.flatMap((record) => record.clearedIds)) };
  };

  const chooseAccount = (chosen: ReconAccount) => {
    const last = completedFor(chosen.id).slice(-1)[0];
    const month = period ? { start: periodStart(period), end: periodEnd(period) } : previousMonth(today);
    setAccount(chosen);
    setWork(null);
    setError(null);
    setNotice(null);
    const d = chosen.defaults;
    const demoMatchesMonth = Boolean(d) && d!.periodEnd === month.end;
    if (last) {
      const start = addDays(last.periodEnd, 1);
      setForm({ periodStart: start, periodEnd: month.end, statementDate: month.end, beginning: centsToInput(last.endingCents), ending: demoMatchesMonth ? centsToInput(d!.endingCents) : "", openingConfirmed: false });
      setStatementLines([]);
    } else if (d && demoMatchesMonth) {
      setForm({ periodStart: d.periodStart, periodEnd: d.periodEnd, statementDate: d.statementDate, beginning: centsToInput(d.beginningCents), ending: centsToInput(d.endingCents), openingConfirmed: false });
      setStatementLines([]);
    } else if (chosen.defaults && !period) {
      const defaults = chosen.defaults;
      setForm({ periodStart: defaults.periodStart, periodEnd: defaults.periodEnd, statementDate: defaults.statementDate, beginning: centsToInput(defaults.beginningCents), ending: centsToInput(defaults.endingCents), openingConfirmed: false });
      setStatementLines([]);
    } else {
      setForm({ periodStart: month.start, periodEnd: month.end, statementDate: month.end, beginning: "", ending: "", openingConfirmed: false });
      setStatementLines([]);
    }
    setStep("statement");
  };

  const startWork = async (continuing: boolean) => {
    if (!account) return;
    const previousForForm = completedFor(account.id).filter((record) => record.periodEnd < form.periodStart).slice(-1)[0];
    setError(null);
    setNotice(null);
    const checked = validateStatement(form, previousForForm);
    if (checked.errors.length > 0) return setError(checked.errors[0]);
    const beginningCents = checked.beginningCents!;
    const endingCents = checked.endingCents!;
    setBusy(true);
    try {
      const id = reconciliationId(source, client.id, account.id, form.periodEnd);
      if (continuing && work && work.record.id === id) {
        const lines = statementLines;
        const record = { ...work.record, periodStart: form.periodStart, statementDate: form.statementDate, beginningCents, endingCents, openingConfirmed: form.openingConfirmed, statementMode: lines.length > 0 ? ("csv" as const) : ("manual" as const), statementLines: lines };
        setWork({ ...work, record, dirty: true });
        return setStep("match");
      }
      const existing = await reconciliationService.get(id);
      if (existing) {
        const chain = await loadChain(account.id, existing.periodEnd);
        setWork({ record: existing, sourceTransactions: existing.transactions, assumedInOpening: [], previous: chain.previous, dirty: false });
        setForm({ periodStart: existing.periodStart, periodEnd: existing.periodEnd, statementDate: existing.statementDate, beginning: centsToInput(existing.beginningCents), ending: centsToInput(existing.endingCents), openingConfirmed: existing.openingConfirmed });
        setStatementLines(existing.statementLines);
        setNotice(existing.status === "completed" ? "This period is already reconciled. You are viewing the saved record." : "Continuing the saved draft for this period.");
        return setStep(existing.status === "completed" ? "review" : "match");
      }
      const chain = await loadChain(account.id, form.periodEnd);
      const data = await loadAccountData(account.id, form.periodEnd);
      const { eligible, assumedInOpening } = splitEligible(data.transactions, { periodStart: form.periodStart, periodEnd: form.periodEnd, previouslyClearedIds: chain.previouslyClearedIds, hasPrevious: Boolean(chain.previous) });
      const now = new Date().toISOString();
      setWork({
        record: {
          id, source, clientId: client.id, clientName: client.name, accountId: account.id, accountName: account.name, accountKind: account.kind,
          periodStart: form.periodStart, periodEnd: form.periodEnd, statementDate: form.statementDate, beginningCents, endingCents, openingConfirmed: form.openingConfirmed,
          statementMode: statementLines.length > 0 ? "csv" : "manual", statementLines, transactions: eligible, clearedIds: [], matches: [], completeness: data.completeness,
          status: "draft", version: 0, createdAt: now, updatedAt: now, history: [],
        },
        sourceTransactions: data.transactions, assumedInOpening, previous: chain.previous, dirty: true,
      });
      setStep("match");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const openSaved = async (summary: RecordSummary) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const full = await reconciliationService.get(summary.id);
      if (!full) return setError("That reconciliation could not be found.");
      const chain = await loadChain(full.accountId, full.periodEnd);
      setAccount(accounts.find((item) => item.id === full.accountId) ?? { id: full.accountId, name: full.accountName, kind: full.accountKind });
      setWork({ record: full, sourceTransactions: full.transactions, assumedInOpening: [], previous: chain.previous, dirty: false });
      setForm({ periodStart: full.periodStart, periodEnd: full.periodEnd, statementDate: full.statementDate, beginning: centsToInput(full.beginningCents), ending: centsToInput(full.endingCents), openingConfirmed: full.openingConfirmed });
      setStatementLines(full.statementLines);
      setStep("review");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const update = (change: (record: ReconciliationRecord) => ReconciliationRecord) => setWork((current) => (current ? { ...current, record: change(current.record), dirty: true } : current));
  const completed = work?.record.status === "completed";

  const computation = useMemo(
    () => (work ? computeReconciliation(work.record, { previous: work.previous, sourceTransactions: work.sourceTransactions, today }) : null),
    [work, today],
  );

  const persist = async (current: Work) => {
    const saved = await reconciliationService.save(current.record.id, editable(current.record), current.record.version);
    const next = { ...current, record: saved, dirty: false };
    setWork(next);
    void refresh();
    return next;
  };

  const save = async () => {
    if (!work) return;
    setBusy(true);
    setError(null);
    try {
      await persist(work);
      setNotice("Saved for later. You can continue this reconciliation from the account list.");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!work) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = work.dirty || work.record.version === 0 ? await persist(work) : work;
      const done = await reconciliationService.complete(saved.record.id, saved.record.version);
      setWork({ ...saved, record: done, dirty: false });
      setNotice("Reconciliation completed and saved in LedgerOps. QuickBooks was not changed.");
      void refresh();
    } catch (failure) {
      setError(`The reconciliation was not completed. ${errorText(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (reason: string) => {
    if (!work) return;
    setBusy(true);
    setError(null);
    try {
      const record = await reconciliationService.reopen(work.record.id, work.record.version, reason);
      setWork({ ...work, record, dirty: false });
      setNotice("Reopened. The reopening, who did it and why are recorded in the history below.");
      void refresh();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (!work || !account) return;
    setBusy(true);
    setError(null);
    try {
      const chain = await loadChain(account.id, work.record.periodEnd);
      const data = await loadAccountData(account.id, work.record.periodEnd);
      const { eligible, assumedInOpening } = splitEligible(data.transactions, { periodStart: work.record.periodStart, periodEnd: work.record.periodEnd, previouslyClearedIds: chain.previouslyClearedIds, hasPrevious: Boolean(chain.previous) });
      const ids = new Set(eligible.map((item) => item.id));
      const kept = work.record.clearedIds.filter((id) => ids.has(id));
      const dropped = work.record.clearedIds.length - kept.length;
      const added = eligible.filter((item) => !work.record.transactions.some((old) => old.id === item.id)).length;
      setWork({
        ...work, sourceTransactions: data.transactions, assumedInOpening, previous: chain.previous, dirty: true,
        record: { ...work.record, transactions: eligible, clearedIds: kept, matches: work.record.matches.filter((match) => kept.includes(match.txnId)), completeness: data.completeness },
      });
      setNotice(`Reloaded: ${added} new transaction${added === 1 ? "" : "s"}${dropped > 0 ? `, ${dropped} cleared item${dropped === 1 ? "" : "s"} no longer in the books were removed` : ""}.`);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!work || !computation) return;
    const blob = new Blob([buildReconciliationCsv(work.record, { durable: storage?.durable ?? false }, computation)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(work.record);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const steps: { id: Step; label: string; enabled: boolean }[] = [
    { id: "accounts", label: "1. Account", enabled: true },
    { id: "statement", label: "2. Statement", enabled: Boolean(account) },
    { id: "match", label: "3. Match", enabled: Boolean(work) },
    { id: "review", label: "4. Review & complete", enabled: Boolean(work) },
  ];

  return (
    <div className="recon">
      <div className="recon-banner" role="note">
        <strong>{source === "demo" ? "Demo data" : "QuickBooks Sandbox (read only)"}</strong>
        <span>Reconciliation is tracked in LedgerOps only. Nothing here changes QuickBooks.</span>
        <span className={`recon-storage ${storage?.durable ? "durable" : "temporary"}`} data-testid="storage-label">
          {storage === null ? "Checking where records are stored..." : storage.durable ? "Records are saved in the LedgerOps database." : "Temporary local development records may be lost when the server restarts."}
        </span>
      </div>
      <nav className="recon-steps" aria-label="Reconciliation steps">
        {steps.map((item) => (
          <button key={item.id} className={`recon-step ${step === item.id ? "active" : ""}`} disabled={!item.enabled} aria-current={step === item.id ? "step" : undefined} onClick={() => setStep(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      {work && computation && step !== "accounts" && (
        <div className={`recon-difference ${computation.differenceCents === 0 ? "zero" : "off"}`} data-testid="remaining-difference-bar">
          <span>{work.record.accountName} · {work.record.periodStart} to {work.record.periodEnd}{completed ? " · Completed" : ""}</span>
          <strong data-testid="remaining-difference">{formatCents(computation.differenceCents)}</strong>
          <small>{computation.differenceCents === 0 ? "No arithmetic difference remains. Other completeness checks must also pass before this can be completed." : "Remaining difference before completion."}</small>
        </div>
      )}
      {notice && <div className="data-state-message" role="status">{notice}</div>}
      {error && <div className="data-state-message error" role="alert">{error}</div>}

      {step === "accounts" && <AccountStep accounts={accounts} records={records} listError={listError} busy={busy} period={statusPeriod} onChoose={chooseAccount} onOpen={openSaved} />}
      {step === "statement" && account && (
        <StatementStep account={account} form={form} setForm={setForm} lines={statementLines} setLines={setStatementLines} previous={completedFor(account.id).filter((record) => record.periodEnd < form.periodStart).slice(-1)[0]} locked={Boolean(completed)} busy={busy} onContinue={() => void startWork(true)} />
      )}
      {step === "match" && work && computation && <MatchStep work={work} computation={computation} update={update} locked={Boolean(completed)} busy={busy} entryTools={entryTools} onReload={() => void reload()} onNext={() => setStep("review")} />}
      {step === "review" && work && computation && (
        <ReviewStep work={work} computation={computation} storage={storage} busy={busy} onSave={() => void save()} onComplete={() => void complete()} onReopen={(reason) => void reopen(reason)} onDownload={download} onBack={() => setStep("match")} />
      )}
    </div>
  );
}

export type ReconClientChoice = { id: string; name: string; accountIds: string[] };

/** Shown instead of a single client's accounts when All clients is selected: each client's month status plus combined history. */
export function ReconcileClientPicker({ clients, period, source, onOpen }: { clients: ReconClientChoice[]; period: MonthRef; source: "demo" | "quickbooks"; onOpen: (clientId: string) => void }) {
  const [byClient, setByClient] = useState<Record<string, RecordSummary[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ids = clients.map((client) => client.id).join("|");
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all(clients.map(async (client) => [client.id, (await reconciliationService.list(source, client.id)).records] as const)).then(
      (entries) => { if (live) { setByClient(Object.fromEntries(entries)); setError(null); setLoading(false); } },
      (failure: unknown) => { if (live) { setError(failure instanceof Error ? failure.message : "Unable to load saved reconciliations."); setLoading(false); } },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, source]);
  const all = clients.flatMap((client) => byClient[client.id] ?? []).sort((left, right) => right.periodEnd.localeCompare(left.periodEnd));
  return (
    <>
      <div className="recon-banner" data-testid="recon-pick-client">
        <strong>Choose a client to reconcile</strong>
        <span>Each reconciliation belongs to one client. Pick a client below to see its bank and credit card accounts.</span>
      </div>
      <div className="reconciliation-account-grid">
        {clients.map((client) => {
          const counts = summarizePeriod(byClient[client.id] ?? [], client.accountIds, period);
          return (
            <div className="reconciliation-account-card kind-bank" key={client.id} data-testid="recon-client-card">
              <div className="account-card-header"><span className="account-icon">Client</span><span><strong>{client.name}</strong><small>{client.accountIds.length} accounts · {formatMonthKey(monthKey(period))}</small></span></div>
              <div className="account-card-details">
                {loading ? <span><small>Loading status…</small></span> : (["Completed", "In progress", "Blocked", "Not started"] as const).map((status) => <span key={status}><small>{status}</small><strong>{counts[status]}</strong></span>)}
              </div>
              <button className="primary-button" onClick={() => onOpen(client.id)} aria-label={`Open reconciliations for ${client.name}`}>Open {client.name} <span>→</span></button>
            </div>
          );
        })}
      </div>
      <HistoryPanel records={all} listError={error} busy={false} showClient openLabel="Open client" onOpen={(record) => onOpen(record.clientId)} />
    </>
  );
}

const statusTone = (status: string) => status.toLowerCase().replaceAll(" ", "-");

function AccountStep({ accounts, records, listError, busy, period, onChoose, onOpen }: { accounts: ReconAccount[]; records: RecordSummary[]; listError: string | null; busy: boolean; period: MonthRef; onChoose: (account: ReconAccount) => void; onOpen: (record: RecordSummary) => void }) {
  return (
    <>
      <h3>Choose the account to reconcile</h3>
      {accounts.length === 0 && <div className="data-state-message">No bank or credit card accounts are available.</div>}
      <div className="reconciliation-account-grid">
        {accounts.map((account) => {
          const last = lastCompleted(records, account.id);
          const current = periodStatus(records, account.id, period);
          return (
            <div className={`reconciliation-account-card ${account.kind === "bank" ? "kind-bank" : "kind-card"}`} key={account.id}>
              <div className="account-card-header">
                <span className="account-icon">{account.kind === "bank" ? "Bank" : "Card"}</span>
                <span>
                  <strong>{account.name}</strong>
                  <small>{account.kind === "bank" ? "Bank account" : "Credit card"}{account.detail ? ` · ${account.detail}` : ""}</small>
                </span>
              </div>
              <div className="period-status-line" data-testid="period-status">
                <small>{formatMonthKey(monthKey(period))}</small>
                <span className={`recon-status ${statusTone(current.status)}`}>{current.status}</span>
              </div>
              {current.reason && <p className="recon-blocked-reason">{current.reason}</p>}
              <div className="account-card-details">
                <span><small>Last completed reconciliation</small><strong>{last ? formatLongDate(last.periodEnd) : "None in LedgerOps yet"}</strong></span>
                {last && <span><small>Statement ending balance</small><strong>{formatCents(last.endingCents)}</strong></span>}
                {account.lastReconciled && !last && <span><small>Earlier history (demo)</small><strong>{account.lastReconciled}</strong></span>}
              </div>
              <button className="primary-button" onClick={() => onChoose(account)} aria-label={`Start reconciliation for ${account.name}`}>Start reconciliation <span>→</span></button>
            </div>
          );
        })}
      </div>
      <HistoryPanel records={records} listError={listError} busy={busy} accounts={accounts} onOpen={onOpen} openLabel="View" />
    </>
  );
}

/** Saved reconciliations with search and client/account/period/status filters. Older records stay reachable. */
export function HistoryPanel({ records, listError, busy, accounts, showClient, openLabel, onOpen }: { records: RecordSummary[]; listError: string | null; busy: boolean; accounts?: ReconAccount[]; showClient?: boolean; openLabel: string; onOpen: (record: RecordSummary) => void }) {
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("All");
  const [accountId, setAccountId] = useState("All");
  const [period, setPeriod] = useState("All");
  const [status, setStatus] = useState<PeriodStatus | "All">("All");
  const clients = [...new Map(records.map((record) => [record.clientId, record.clientName])).entries()];
  const accountOptions = [...new Map([...(accounts ?? []).map((account) => [account.id, account.name] as const), ...records.map((record) => [record.accountId, record.accountName] as const)]).entries()];
  const shown = filterHistory(records, { search, clientId, accountId, period, status });
  const active = search.trim() !== "" || clientId !== "All" || accountId !== "All" || period !== "All" || status !== "All";
  const reset = () => { setSearch(""); setClientId("All"); setAccountId("All"); setPeriod("All"); setStatus("All"); };
  return (
    <>
      <h3>Saved reconciliations</h3>
      {listError && <div className="data-state-message error">{listError}</div>}
      {records.length === 0 && !listError && <p className="muted">Nothing saved yet for {showClient ? "these clients" : "this client"} and data source.</p>}
      {records.length > 0 && (
        <>
          <div className="queue-filters recon-history-filters">
            <label>Search<input type="search" value={search} placeholder="Account, client or date" aria-label="Search saved reconciliations" onChange={(event) => setSearch(event.target.value)} /></label>
            {showClient && <label>Client<select value={clientId} aria-label="Filter history by client" onChange={(event) => setClientId(event.target.value)}><option value="All">All clients</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
            <label>Account<select value={accountId} aria-label="Filter history by account" onChange={(event) => setAccountId(event.target.value)}><option value="All">All accounts</option>{accountOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Period<select value={period} aria-label="Filter history by period" onChange={(event) => setPeriod(event.target.value)}><option value="All">All periods</option>{historyMonths(records).map((key) => <option key={key} value={key}>{formatMonthKey(key)}</option>)}</select></label>
            <label>Status<select value={status} aria-label="Filter history by status" onChange={(event) => setStatus(event.target.value as PeriodStatus | "All")}><option value="All">All statuses</option><option value="Completed">Completed</option><option value="In progress">In progress</option><option value="Blocked">Blocked</option></select></label>
            {active && <button className="text-button" onClick={reset}>Reset filters</button>}
          </div>
          <p className="muted" role="status" data-testid="history-count">Showing {shown.length} of {records.length} saved reconciliations</p>
          {shown.length === 0 ? <p className="muted">No saved reconciliations match these filters.</p> : (
            <div className="panel recon-table">
              <div className={`recon-row heading ${showClient ? "with-client" : ""}`}>{showClient && <span>Client</span>}<span>Account</span><span>Period</span><span>Status</span><span>Difference</span><span>Completed</span><span /></div>
              {shown.map((record) => (
                <div className={`recon-row ${showClient ? "with-client" : ""}`} key={record.id} data-testid="saved-reconciliation">
                  {showClient && <span>{record.clientName}</span>}
                  <strong>{record.accountName}</strong>
                  <span>{formatLongDate(record.periodStart)} to {formatLongDate(record.periodEnd)}</span>
                  <span className={`recon-status ${statusTone(recordStatus(record))}`}>{recordStatus(record)}</span>
                  <span>{record.result ? formatCents(record.result.differenceCents) : "Not completed"}</span>
                  <span>{record.completedAt ? `${formatLongDate(record.completedAt.slice(0, 10))} by ${record.completedBy ?? "unknown"}` : "—"}</span>
                  <button className="secondary-button" disabled={busy} onClick={() => onOpen(record)} aria-label={`${openLabel} reconciliation ${record.accountName} ${record.periodEnd}`}>{openLabel}</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function MoneyField({ label, value, disabled, readOnly, placeholder, describedBy, onChange }: { label: string; value: string; disabled?: boolean; readOnly?: boolean; placeholder?: string; describedBy?: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Swapping the formatted text for the raw number must not leave the caret in the wrong place.
  useLayoutEffect(() => { if (editing) input.current?.select(); }, [editing]);
  return (
    <label>
      {label}
      <input ref={input} inputMode="decimal" value={editing && !readOnly ? value : displayBalance(value)} disabled={disabled} readOnly={readOnly} aria-describedby={describedBy} placeholder={placeholder} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function StatementStep({ account, form, setForm, lines, setLines, previous, locked, busy, onContinue }: { account: ReconAccount; form: Form; setForm: (form: Form) => void; lines: StatementLine[]; setLines: (lines: StatementLine[]) => void; previous?: RecordSummary; locked: boolean; busy: boolean; onContinue: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const field = (key: keyof Form, value: string | boolean) => setForm({ ...form, [key]: value });
  const changeEnd = (value: string) => setForm({ ...form, periodEnd: value, statementDate: nextStatementDate(form.periodEnd, value, form.statementDate) });
  const checked = validateStatement(form, previous);
  const beginningLocked = Boolean(previous) && !unlocked;
  const beginningMismatch = Boolean(previous) && checked.beginningCents !== null && checked.beginningCents !== previous!.endingCents;
  const summaryReady = checked.beginningCents !== null && checked.endingCents !== null && isValidIsoDate(form.periodStart) && isValidIsoDate(form.periodEnd);
  const periodReady = isValidIsoDate(form.periodStart) && isValidIsoDate(form.periodEnd);
  const result = useMemo(() => (rows && mapping && periodReady ? applyMapping(rows, mapping, { start: form.periodStart, end: form.periodEnd }) : null), [rows, mapping, periodReady, form.periodStart, form.periodEnd]);
  const headers = rows?.[0] ?? [];
  const columns = headers.map((header, index) => ({ index, label: mapping?.hasHeader ? header || `Column ${index + 1}` : `Column ${index + 1}` }));
  const useSplit = mapping !== undefined && mapping !== null && mapping.amount === undefined;

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setParseError(null);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0) throw new Error("The file is empty.");
      setRows(parsed);
      setMapping(suggestMapping(parsed[0], account.kind));
      setFileName(file.name);
    } catch (failure) {
      setRows(null);
      setMapping(null);
      setParseError(failure instanceof Error ? failure.message : "The file could not be read.");
    }
  };

  const column = (label: string, key: "date" | "description" | "amount" | "debit" | "credit", optional = false) => (
    <label>
      {label}
      <select value={mapping?.[key] ?? ""} onChange={(event) => mapping && setMapping({ ...mapping, [key]: event.target.value === "" ? undefined : Number(event.target.value) })}>
        {optional && <option value="">(none)</option>}
        {columns.map((item) => <option key={item.index} value={item.index}>{item.label}</option>)}
      </select>
    </label>
  );

  return (
    <div className="recon-form">
      <h3>Statement details — {account.name}</h3>
      {previous && <p className="muted" id="beginning-source" data-testid="beginning-source">Beginning balance comes from the reconciliation completed through {formatLongDate(previous.periodEnd)}, which ended at {formatCents(previous.endingCents)}. It must match that balance.</p>}
      <div className="recon-fields">
        <label>Statement start date<input type="date" value={form.periodStart} disabled={locked} onChange={(event) => field("periodStart", event.target.value)} /></label>
        <label>Statement end date<input type="date" value={form.periodEnd} disabled={locked} onChange={(event) => changeEnd(event.target.value)} /></label>
        <label>Statement date<input type="date" value={form.statementDate} disabled={locked} onChange={(event) => field("statementDate", event.target.value)} /></label>
        <MoneyField label="Beginning balance" value={form.beginning} disabled={locked} readOnly={beginningLocked} placeholder="0.00" describedBy={previous ? "beginning-source" : undefined} onChange={(value) => field("beginning", value)} />
        <MoneyField label={`Ending balance${account.kind === "credit_card" ? " (amount owed)" : ""}`} value={form.ending} disabled={locked} placeholder="0.00" onChange={(value) => field("ending", value)} />
      </div>
      {previous && !locked && !unlocked && <button className="text-button" onClick={() => setUnlocked(true)}>Edit the beginning balance (only if the statement differs)</button>}
      {beginningMismatch && !locked && <div className="data-state-message error" role="alert" data-testid="beginning-mismatch">The beginning balance does not agree with the previous completed reconciliation ({formatCents(previous!.endingCents)}). You cannot continue until it matches. If the earlier reconciliation was wrong, reopen it first.</div>}
      {summaryReady && (
        <dl className="panel recon-summary" data-testid="statement-summary" aria-label="Statement summary">
          <div><dt>Statement period</dt><dd>{formatLongDate(form.periodStart)} to {formatLongDate(form.periodEnd)}</dd></div>
          <div><dt>Beginning balance</dt><dd>{formatCents(checked.beginningCents!)}</dd></div>
          <div><dt>Ending balance</dt><dd>{formatCents(checked.endingCents!)}</dd></div>
          <div><dt>Net change</dt><dd data-testid="net-change">{formatCents(netChangeCents(checked.beginningCents!, checked.endingCents!))}</dd></div>
        </dl>
      )}
      {!previous && (
        <label className="recon-check">
          <input type="checkbox" checked={form.openingConfirmed} disabled={locked} onChange={(event) => field("openingConfirmed", event.target.checked)} />
          This is the first reconciliation here. I confirm the beginning balance matches the prior statement and earlier activity was already reconciled.
        </label>
      )}

      <div className="panel recon-import">
        <h4>Statement transactions (optional)</h4>
        <p className="muted">Used only to match against your books. Importing a statement does not create any transactions in QuickBooks or in your books.</p>
        {account.defaults && lines.length === 0 && !locked && (
          <button className="primary-button" onClick={() => setLines(account.defaults!.statementLines)}>Load the demo statement transactions</button>
        )}
        <h4 className="recon-secondary-heading">{account.defaults ? "Or import your own CSV file" : "Import a CSV file"}</h4>
        <label>CSV file<input type="file" accept=".csv,text/csv" disabled={locked} aria-label="Statement CSV file" onChange={(event) => { setConfirmReplace(false); void readFile(event.target.files?.[0]); }} /></label>
        {parseError && <div className="data-state-message error" role="alert">{parseError}</div>}
        {rows && mapping && (
          <>
            <p className="muted">{fileName}: {rows.length} rows</p>
            <div className="recon-fields">
              <label className="recon-check"><input type="checkbox" checked={mapping.hasHeader} onChange={(event) => setMapping({ ...mapping, hasHeader: event.target.checked })} /> First row is a header</label>
              {column("Date column", "date")}
              {column("Description column", "description")}
              <label>
                Amounts are in
                <select value={useSplit ? "split" : "single"} onChange={(event) => setMapping(event.target.value === "split" ? { ...mapping, amount: undefined, debit: 0, credit: Math.min(1, headers.length - 1) } : { ...mapping, amount: Math.min(2, headers.length - 1), debit: undefined, credit: undefined })}>
                  <option value="single">One amount column</option>
                  <option value="split">Separate debit and credit columns</option>
                </select>
              </label>
              {!useSplit && column("Amount column", "amount")}
              {useSplit && column("Debit column", "debit", true)}
              {useSplit && column("Credit column", "credit", true)}
              {!useSplit ? (
                <label>
                  A positive amount means
                  <select value={mapping.positiveMeans} onChange={(event) => setMapping({ ...mapping, positiveMeans: event.target.value as "increase" | "decrease" })}>
                    <option value="increase">{labelsFor(account.kind).increase} (increases the balance)</option>
                    <option value="decrease">{labelsFor(account.kind).decrease} (decreases the balance)</option>
                  </select>
                </label>
              ) : (
                <label>
                  A debit means
                  <select value={mapping.debitMeans} onChange={(event) => setMapping({ ...mapping, debitMeans: event.target.value as "increase" | "decrease" })}>
                    <option value="decrease">{labelsFor(account.kind).decrease}</option>
                    <option value="increase">{labelsFor(account.kind).increase}</option>
                  </select>
                </label>
              )}
              <label>
                Date format
                <select value={mapping.dateFormat} onChange={(event) => setMapping({ ...mapping, dateFormat: event.target.value as CsvMapping["dateFormat"] })}>
                  <option value="auto">Detect</option>
                  <option value="MDY">Month / day / year</option>
                  <option value="DMY">Day / month / year</option>
                </select>
              </label>
            </div>
            {!periodReady && <div className="data-state-message">Enter valid statement dates to preview the import.</div>}
            {result && (
              <div data-testid="csv-preview">
                <strong>Preview: {result.lines.length} valid line{result.lines.length === 1 ? "" : "s"}, {result.errors.length} error{result.errors.length === 1 ? "" : "s"}, {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</strong>
                <table className="recon-preview">
                  <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
                  <tbody>{result.lines.slice(0, 8).map((line) => <tr key={line.id}><td>{line.date}</td><td>{line.description}</td><td>{signed(line)}</td></tr>)}</tbody>
                </table>
                {result.errors.length > 0 && <ul className="recon-problems error">{result.errors.slice(0, 6).map((problem) => <li key={problem.message}>{problem.message}</li>)}</ul>}
                {result.warnings.length > 0 && <ul className="recon-problems">{result.warnings.slice(0, 6).map((problem) => <li key={problem.message}>{problem.message}</li>)}</ul>}
                <button className="secondary-button" disabled={result.errors.length > 0 || locked} onClick={() => { if (lines.length > 0 && !confirmReplace) return setConfirmReplace(true); setLines(result.lines); setRows(null); setMapping(null); setConfirmReplace(false); }}>
                  {result.errors.length > 0 ? "Fix the errors to import" : lines.length > 0 ? (confirmReplace ? `Confirm: replace the ${lines.length} loaded lines with these ${result.lines.length}` : `Replace the ${lines.length} loaded statement lines…`) : `Use these ${result.lines.length} statement lines`}
                </button>
              </div>
            )}
          </>
        )}
        {lines.length > 0 && (
          <div className="data-state-message" role="status">
            {lines.length} statement lines will be matched against your books.{" "}
            {!locked && <button className="text-button" onClick={() => setLines([])}>Remove them</button>}
          </div>
        )}
      </div>
      <button className="primary-button" disabled={busy || (beginningMismatch && !locked)} onClick={onContinue}>Continue to matching <span>→</span></button>
    </div>
  );
}

function MatchStep({ work, computation, update, locked, busy, entryTools, onReload, onNext }: { work: Work; computation: ReturnType<typeof computeReconciliation>; update: (change: (record: ReconciliationRecord) => ReconciliationRecord) => void; locked: boolean; busy: boolean; entryTools?: EntryTools; onReload: () => void; onNext: () => void }) {
  const { record } = work;
  const labels = labelsFor(record.accountKind);
  const [prefill, setPrefill] = useState<EntryPrefill | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "cleared" | "outstanding" | "suggested" | "flagged">("all");
  const csv = record.statementMode === "csv";
  const clearedSet = new Set(record.clearedIds);
  const lineById = new Map(record.statementLines.map((line) => [line.id, line]));
  const matchByTxn = new Map(record.matches.map((match) => [match.txnId, match.lineId]));
  const suggestionByTxn = new Map(computation.suggestions.map((suggestion) => [suggestion.txnId, suggestion]));
  const nearTxns = new Set(computation.nearMatches.map((near) => near.txnId));
  const duplicateIds = new Set(computation.duplicates.flat().map((item) => item.id));
  const needle = search.trim().toLowerCase();

  const shown = record.transactions.filter((item) => {
    if (needle && !`${item.payee} ${item.memo} ${formatCents(item.amountCents)}`.toLowerCase().includes(needle)) return false;
    if (filter === "cleared") return clearedSet.has(item.id);
    if (filter === "outstanding") return !clearedSet.has(item.id);
    if (filter === "suggested") return suggestionByTxn.has(item.id);
    if (filter === "flagged") return duplicateIds.has(item.id) || nearTxns.has(item.id);
    return true;
  });

  const clear = (ids: string[]) =>
    update((current) => {
      const cleared = new Set(current.clearedIds);
      const matches = [...current.matches];
      const usedLines = new Set(matches.map((match) => match.lineId));
      for (const id of ids) {
        cleared.add(id);
        const suggestion = suggestionByTxn.get(id);
        if (current.statementMode === "csv" && suggestion && !usedLines.has(suggestion.lineId) && !matches.some((match) => match.txnId === id)) {
          matches.push({ lineId: suggestion.lineId, txnId: id });
          usedLines.add(suggestion.lineId);
        }
      }
      return { ...current, clearedIds: [...cleared], matches };
    });
  const unclear = (ids: string[]) => update((current) => ({ ...current, clearedIds: current.clearedIds.filter((id) => !ids.includes(id)), matches: current.matches.filter((match) => !ids.includes(match.txnId)) }));
  const matchTo = (txnId: string, lineId: string) => {
    if (!lineId) return;
    const item = record.transactions.find((entry) => entry.id === txnId);
    const line = lineById.get(lineId);
    const problem = item && line ? validateManualMatch(item, line, record.matches) : "That statement item could not be found.";
    if (problem) {
      setMatchProblem({ txnId, text: problem });
      return;
    }
    setMatchProblem(null);
    update((current) => ({ ...current, matches: [...current.matches.filter((match) => match.txnId !== txnId && match.lineId !== lineId), { lineId, txnId }] }));
  };
  const [matchProblem, setMatchProblem] = useState<{ txnId: string; text: string } | null>(null);

  const unmatchedLines = computation.unmatchedLines;
  const [pending, setPending] = useState<{ kind: "clear" | "unclear" | "suggested"; ids: string[]; skipped: string[] } | null>(null);
  const requestClear = () => {
    if (!csv) return setPending({ kind: "clear", ids: shown.map((item) => item.id), skipped: [] });
    const plan = planBulkClear(shown, record.clearedIds, record.matches, computation.suggestions);
    setPending({ kind: "clear", ids: plan.clear, skipped: plan.skipped });
  };
  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === "unclear") unclear(pending.ids);
    else clear(pending.ids);
    setPending(null);
  };
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const pendingText = pending
    ? pending.kind === "unclear"
      ? `Remove the cleared mark from ${plural(pending.ids.length, "transaction")}? Their statement matches are also removed.`
      : pending.kind === "suggested"
        ? `Accept all ${plural(pending.ids.length, "suggested match").replace("matchs", "matches")} and mark those transactions cleared? Review the evidence first.`
        : csv
          ? `Clear ${plural(pending.ids.length, "transaction")} that ${pending.ids.length === 1 ? "has" : "have"} a matching, unclaimed statement item.${pending.skipped.length > 0 ? ` ${plural(pending.skipped.length, "shown transaction")} ha${pending.skipped.length === 1 ? "s" : "ve"} no statement match and will stay uncleared; review ${pending.skipped.length === 1 ? "it" : "them"} individually.` : " Every shown transaction has a statement match."}`
          : `Mark ${plural(pending.ids.length, "transaction")} as cleared on this statement?`
    : "";
  const acceptOne = (txnId: string, lineId: string) =>
    update((current) => {
      const next = acceptMatch({ clearedIds: current.clearedIds, matches: current.matches }, txnId, lineId);
      return next ? { ...current, ...next } : current;
    });
  const [inspect, setInspect] = useState<string | null>(null);

  return (
    <div className="recon-match">
      <h3>Match transactions to the statement</h3>
      <p className="muted">
        Mark each transaction that appears on the statement as cleared. Items left uncleared are only potentially {labels.outstandingIncreasePlural.toLowerCase()} or {labels.outstandingDecreasePlural.toLowerCase()} until you have checked them. Marking items here does not mark them reconciled in QuickBooks, and nothing is posted automatically.
      </p>
      {!work.record.completeness.complete && (
        <div className="data-state-message error" role="alert">
          The transaction data may be incomplete, so this reconciliation cannot be completed: {work.record.completeness.reasons.join(" ") || "the source did not confirm it is complete."}
        </div>
      )}
      {work.assumedInOpening.length > 0 && (
        <div className="data-state-message">{work.assumedInOpening.length} earlier transaction{work.assumedInOpening.length === 1 ? " is" : "s are"} dated before the statement and assumed to be inside the beginning balance.</div>
      )}
      <div className="queue-filters recon-toolbar" role="toolbar" aria-label="Match actions">
        <label>Search<input type="search" value={search} placeholder="Payee, memo or amount" aria-label="Search transactions to match" onChange={(event) => setSearch(event.target.value)} /></label>
        <label>
          Show
          <select value={filter} aria-label="Filter transactions" onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">All</option>
            <option value="cleared">Cleared</option>
            <option value="outstanding">Uncleared</option>
            {csv && <option value="suggested">Suggested matches</option>}
            <option value="flagged">Needs investigation</option>
          </select>
        </label>
        {!locked && <button className="secondary-button" disabled={shown.length === 0} onClick={requestClear}>Clear all shown</button>}
        {!locked && <button className="secondary-button" disabled={shown.length === 0} onClick={() => setPending({ kind: "unclear", ids: shown.map((item) => item.id), skipped: [] })}>Unclear all shown</button>}
        {!locked && csv && <button className="secondary-button" disabled={computation.suggestions.length === 0} onClick={() => setPending({ kind: "suggested", ids: computation.suggestions.map((suggestion) => suggestion.txnId), skipped: [] })}>Clear all suggested matches ({computation.suggestions.length})</button>}
        {!locked && <button className="secondary-button" disabled={busy} onClick={onReload}>Reload transactions</button>}
      </div>
      {pending && (
        <div className="data-state-message recon-confirm" role="alertdialog" aria-label="Confirm bulk change" data-testid="bulk-confirm">
          <span>{pendingText}</span>{" "}
          <button className="primary-button" disabled={pending.ids.length === 0} onClick={confirmPending}>Confirm: {pending.kind === "unclear" ? "remove cleared mark" : "clear"} {pending.ids.length}</button>{" "}
          <button className="secondary-button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}

      <div className="panel recon-table">
        <div className="recon-row heading match"><span>Cleared</span><span>Date</span><span>Payee</span><span>Amount</span><span>Status</span><span>Statement</span></div>
        {shown.length === 0 && <p className="muted">No transactions match.</p>}
        {shown.map((item) => {
          const isCleared = clearedSet.has(item.id);
          const suggestion = suggestionByTxn.get(item.id);
          const matchedLine = lineById.get(matchByTxn.get(item.id) ?? "");
          const freeLines = unmatchedLines;
          const state = classifyTxn({ cleared: isCleared, flagged: duplicateIds.has(item.id) || nearTxns.has(item.id), suggested: Boolean(suggestion), csv });
          const suggestedLine = suggestion ? lineById.get(suggestion.lineId) : undefined;
          return (
            <div className={`recon-row match ${isCleared ? "cleared" : ""}`} key={item.id} data-testid="recon-row">
              <button className={`clear-check ${isCleared ? "checked" : ""}`} disabled={locked} aria-pressed={isCleared} aria-label={`${isCleared ? "Mark uncleared" : "Mark cleared"}: ${item.payee || item.memo} ${formatCents(item.amountCents)}`} onClick={() => (isCleared ? unclear([item.id]) : clear([item.id]))}>{isCleared ? "✓" : ""}</button>
              <span>{item.date}</span>
              <span><strong>{item.payee || "(no payee)"}</strong>{item.memo ? <small> {item.memo}</small> : null}{duplicateIds.has(item.id) && <em className="recon-flag">Possible duplicate</em>}{nearTxns.has(item.id) && <em className="recon-flag">Amount differs from a statement line</em>}</span>
              <span>{signed(item)} <small>{item.direction === "increase" ? labels.increase : labels.decrease}</small></span>
              <span className={`transaction-status ${state === "Matched and cleared" ? "matched" : state === "Needs investigation" ? "needs-review" : "needs-receipt"}`} data-testid="txn-state">{state}</span>
              <span>
                {!csv && "—"}
                {csv && matchedLine && <>{matchedLine.description || "Statement line"} ({matchedLine.date})</>}
                {csv && !matchedLine && suggestion && suggestedLine && !locked && (
                  <span className="recon-suggestion">
                    <small>Suggested statement item: {suggestedLine.description || "Statement line"} · {suggestedLine.date} · {signed(suggestedLine)}</small>
                    <ul className="recon-evidence">{matchEvidence(item, suggestedLine).map((text) => <li key={text}>{text}</li>)}</ul>
                    <button className="secondary-button" onClick={() => acceptOne(item.id, suggestion.lineId)} aria-label={`Accept Match for ${item.payee} ${formatCents(item.amountCents)}`}>Accept Match</button>
                  </span>
                )}
                {csv && !matchedLine && isCleared && !locked && freeLines.length > 0 && (
                  <>
                  <select aria-label={`Match ${item.payee} to a statement line`} value="" onChange={(event) => matchTo(item.id, event.target.value)}>
                    <option value="">Match to statement line…</option>
                    {freeLines.map((line) => <option key={line.id} value={line.id}>{line.date} {line.description} {formatCents(line.amountCents)}</option>)}
                  </select>
                  {matchProblem?.txnId === item.id && <small className="field-error" role="alert" data-testid="match-problem">{matchProblem.text}</small>}
                  </>
                )}
                {csv && !matchedLine && !suggestion && !isCleared && "Not on statement"}
              </span>
            </div>
          );
        })}
      </div>

      {csv && (
        <details className="panel recon-unmatched" open data-testid="unmatched-statement">
          <summary><strong data-testid="unmatched-count">{unmatchedLines.length}</strong> statement item{unmatchedLines.length === 1 ? "" : "s"} not matched (of {record.statementLines.length})</summary>
          {unmatchedLines.length === 0 ? <p className="muted">Every statement line is matched.</p> : (
            <ul className="recon-problems">
              {unmatchedLines.map((line) => {
                const open = inspect === line.id;
                const hasSuggestion = computation.suggestions.some((suggestion) => suggestion.lineId === line.id);
                const hasNear = computation.nearMatches.some((near) => near.lineId === line.id);
                return (
                  <li key={line.id} data-testid="unmatched-line">
                    {line.date} · {line.description || "Statement line"} · {signed(line)}. {suggestionHint(line, computation, Boolean(entryTools))}{" "}
                    <button className="text-button" aria-expanded={open} onClick={() => setInspect(open ? null : line.id)} aria-label={`${open ? "Hide" : "Investigate"} statement item ${line.description || "Statement line"} ${formatCents(line.amountCents)}`}>{open ? "Hide details" : "Investigate"}</button>
                    {open && <div className="recon-inspect"><small>Statement entry {line.id}: dated {line.date}, {line.direction === "increase" ? labels.increase : labels.decrease} of {formatCents(line.amountCents)}, described as "{line.description}".</small></div>}
                    {entryTools && !locked && !hasSuggestion && !hasNear && (
                      <>{" "}<button className="text-button" onClick={() => setPrefill({ key: Date.now(), accountId: record.accountId, date: line.date, payee: line.description, amountCents: line.amountCents, direction: line.direction })} aria-label={`Start entering ${line.description || "statement line"} ${formatCents(line.amountCents)}`}>Start entering this transaction</button></>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      )}
      {entryTools && <MissingTransactionPanel tools={entryTools} accountId={record.accountId} locked={locked} prefill={prefill} onChanged={onReload} />}
      {!entryTools && record.source === "quickbooks" && (
        <div className="panel" data-testid="quickbooks-missing-note">
          <h4>Something missing from the books?</h4>
          <p className="muted">LedgerOps cannot create or change QuickBooks transactions yet. Create the missing transaction in QuickBooks, then use Reload transactions here. It will appear in this list to be cleared.</p>
        </div>
      )}
      <div className="recon-summary-grid">
        <div><small>{labels.outstandingIncreasePlural}</small><strong>{formatCents(computation.outstandingIncreaseCents)}</strong><span>{computation.outstandingIncrease.length} item{computation.outstandingIncrease.length === 1 ? "" : "s"}</span></div>
        <div><small>{labels.outstandingDecreasePlural}</small><strong>{formatCents(computation.outstandingDecreaseCents)}</strong><span>{computation.outstandingDecrease.length} item{computation.outstandingDecrease.length === 1 ? "" : "s"}</span></div>
        <div><small>Cleared balance</small><strong>{formatCents(computation.clearedBalanceCents)}</strong><span>{computation.cleared.length} cleared</span></div>
        <div><small>Statement ending balance</small><strong>{formatCents(record.endingCents)}</strong><span>from the statement</span></div>
      </div>
      <button className="primary-button" onClick={onNext}>Review and complete <span>→</span></button>
    </div>
  );
}

function suggestionHint(line: StatementLine, computation: ReturnType<typeof computeReconciliation>, canEnter: boolean) {
  if (computation.suggestions.some((suggestion) => suggestion.lineId === line.id)) return "A matching transaction is suggested above.";
  if (computation.nearMatches.some((near) => near.lineId === line.id)) return "A similar transaction exists with a different amount.";
  if (canEnter) return "Not found in your books. If it is genuinely missing, enter it with Add a missing transaction below. LedgerOps does not add it for you.";
  return "Not found in your books. Record it in QuickBooks, then use Reload transactions. LedgerOps does not add it for you.";
}

function ReviewStep({ work, computation, storage, busy, onSave, onComplete, onReopen, onDownload, onBack }: { work: Work; computation: ReturnType<typeof computeReconciliation>; storage: Storage | null; busy: boolean; onSave: () => void; onComplete: () => void; onReopen: (reason: string) => void; onDownload: () => void; onBack: () => void }) {
  const { record } = work;
  const labels = labelsFor(record.accountKind);
  const [reason, setReason] = useState("");
  const completed = record.status === "completed";
  const blocking = computation.issues.filter((issue) => issue.severity === "blocking");
  const warnings = computation.issues.filter((issue) => issue.severity === "warning");
  const checklist = completionChecklist(record, computation);
  const basis = outstandingBasis(record, computation);
  const tag = basis.basis === "verified" ? "verified" : "provisional";
  const statusText = { passed: "Passed", attention: "Needs attention", unavailable: "Unavailable" } as const;
  const line = (label: string, cents: number, strong = false) => <div className={`recon-calc-row ${strong ? "strong" : ""}`} key={label}><span>{label}</span><span>{formatCents(cents)}</span></div>;

  return (
    <div className="recon-review">
      <h3>Review and complete</h3>
      {completed && (
        <div className="data-state-message" role="status" data-testid="completed-banner">
          Completed {record.completedAt?.slice(0, 10)} by {record.completedBy}. {storage?.durable ? "Saved in the LedgerOps database." : "Saved as a temporary local development record; it will be lost when the server restarts."} QuickBooks was not changed.
        </div>
      )}
      {!completed && !computation.canComplete && (
        <div className="data-state-message" data-testid="difference-help">
          <strong>Remaining difference: {formatCents(computation.differenceCents)}.</strong> A difference or an unmatched item does not automatically mean an accounting error. It often means a transaction is not yet cleared, a statement line is unmatched, or a balance needs checking.{" "}
          <button className="secondary-button" onClick={onBack}>Return to matching</button>
        </div>
      )}
      <div className="panel recon-calc">
        {line("Beginning balance", record.beginningCents)}
        {line(`+ Cleared ${labels.increase.toLowerCase()}s`, computation.clearedIncreaseCents)}
        {line(`− Cleared ${labels.decrease.toLowerCase()}s`, computation.clearedDecreaseCents)}
        {line("Cleared balance", computation.clearedBalanceCents, true)}
        {line("Statement ending balance", record.endingCents)}
        {line("Difference", computation.differenceCents, true)}
        <hr />
        {line(`${labels.outstandingIncreasePlural} (${tag})`, computation.outstandingIncreaseCents)}
        {line(`${labels.outstandingDecreasePlural} (${tag})`, computation.outstandingDecreaseCents)}
        {line(`Adjusted statement balance (${tag})`, computation.adjustedBankBalanceCents)}
        {line("Book balance at statement date", computation.bookBalanceCents)}
        <p className="muted" data-testid="outstanding-basis">{basis.basis === "verified" ? "Verified: " : "Provisional: "}{basis.reason}</p>
      </div>

      <h4>Completion checklist</h4>
      <ul className="recon-checklist" data-testid="completion-checklist">
        {checklist.map((item) => (
          <li key={item.id} data-status={item.status} data-testid="checklist-item">
            <strong>{item.label}:</strong> <span className={`checklist-status ${item.status}`}>{statusText[item.status]}</span>
            <small> {item.reason}</small>
          </li>
        ))}
      </ul>

      <h4>{computation.canComplete ? "Ready to complete" : "What needs attention"}</h4>
      {computation.canComplete && !completed && <div className="data-state-message" role="status">Everything checks out: the difference is $0.00 and all required checks pass.</div>}
      {blocking.length > 0 && !completed && (
        <ul className="recon-problems error" data-testid="blocking-issues">{blocking.map((issue) => <li key={`${issue.code}-${issue.message}`}><strong>Needs attention:</strong> {issue.message}</li>)}</ul>
      )}
      {computation.explanations.length > 0 && !completed && (
        <div className="panel" data-testid="explanations"><strong>Why it does not balance</strong><ul>{computation.explanations.map((text) => <li key={text}>{text}</li>)}</ul></div>
      )}
      {warnings.length > 0 && <ul className="recon-problems" data-testid="warnings">{warnings.map((issue) => <li key={issue.message}><strong>Check:</strong> {issue.message}</li>)}</ul>}
      {record.statementMode === "manual" && <p className="muted">Statement detail was entered manually, so the cleared items are your own comparison against the statement.</p>}

      <div className="recon-actions">
        {!completed && <button className="secondary-button" disabled={busy} onClick={onSave}>Save for later</button>}
        {!completed && <button className="primary-button" disabled={busy || !computation.canComplete} aria-describedby={computation.canComplete ? undefined : "complete-blocked"} onClick={onComplete}>Complete reconciliation <span>✓</span></button>}
        <button className="secondary-button" onClick={onDownload}>Download reconciliation report (CSV)</button>
      </div>
      {!completed && !computation.canComplete && <p className="muted" id="complete-blocked" data-testid="complete-blocked">Complete reconciliation is unavailable until every check above passes. The server checks the same rules again when you submit.</p>}

      {completed && (
        <div className="panel">
          <h4>Reopen this reconciliation</h4>
          <p className="muted">Reopening is recorded permanently with your name, the time and the reason. The reconciliation must be completed again.</p>
          <label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Reason for reopening" /></label>
          <button className="secondary-button" disabled={busy || reason.trim().length < 5} onClick={() => { onReopen(reason.trim()); setReason(""); }}>Reopen</button>
        </div>
      )}

      <h4>History</h4>
      {record.history.length === 0 ? <p className="muted">No completion or reopening events yet.</p> : (
        <div className="panel recon-table" data-testid="history">
          <div className="recon-row heading history"><span>When</span><span>Who</span><span>Action</span><span>Reason</span></div>
          {record.history.map((event, index) => <div className="recon-row history" key={`${index}-${event.at}-${event.action}`}><span>{event.at.replace("T", " ").slice(0, 16)}</span><span>{event.by}</span><span>{event.action}</span><span>{event.reason ?? "—"}</span></div>)}
        </div>
      )}
    </div>
  );
}
