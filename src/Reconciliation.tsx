import { useEffect, useMemo, useState } from "react";
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
import { MissingTransactionPanel, type EntryPrefill, type EntryTools } from "./MissingTransaction";

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
      setNotice("You have unsaved progress on this reconciliation. Use Save progress first, then go back to the account list.");
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
    setError(null);
    setNotice(null);
    const beginningCents = parseMoneyToCents(form.beginning);
    const endingCents = parseMoneyToCents(form.ending);
    if (!isValidIsoDate(form.periodStart) || !isValidIsoDate(form.periodEnd) || !isValidIsoDate(form.statementDate)) return setError("Enter valid dates for the statement start, end and statement date.");
    if (form.periodStart > form.periodEnd) return setError("The statement start date is after the end date.");
    if (beginningCents === null || endingCents === null) return setError("Enter the beginning and ending balances as numbers, for example 1,234.56.");
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
      setNotice("Progress saved.");
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
      setError(errorText(failure));
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
          {storage === null ? "Checking where records are stored..." : storage.durable ? "Records are saved in the LedgerOps database." : "Temporary local development records: they are lost when the server restarts. Set DATABASE_URL for durable storage."}
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
          <small>{computation.differenceCents === 0 ? "No difference remaining" : "Remaining difference to explain"}</small>
        </div>
      )}
      {notice && <div className="data-state-message" role="status">{notice}</div>}
      {error && <div className="data-state-message error" role="alert">{error}</div>}

      {step === "accounts" && <AccountStep accounts={accounts} records={records} listError={listError} busy={busy} lastFor={(id) => completedFor(id).slice(-1)[0]} onChoose={chooseAccount} onOpen={openSaved} />}
      {step === "statement" && account && (
        <StatementStep account={account} form={form} setForm={setForm} lines={statementLines} setLines={setStatementLines} previous={completedFor(account.id).slice(-1)[0]} locked={Boolean(completed)} busy={busy} onContinue={() => void startWork(true)} />
      )}
      {step === "match" && work && computation && <MatchStep work={work} computation={computation} update={update} locked={Boolean(completed)} busy={busy} entryTools={entryTools} onReload={() => void reload()} onNext={() => setStep("review")} />}
      {step === "review" && work && computation && (
        <ReviewStep work={work} computation={computation} storage={storage} busy={busy} onSave={() => void save()} onComplete={() => void complete()} onReopen={(reason) => void reopen(reason)} onDownload={download} />
      )}
    </div>
  );
}

function AccountStep({ accounts, records, listError, busy, lastFor, onChoose, onOpen }: { accounts: ReconAccount[]; records: RecordSummary[]; listError: string | null; busy: boolean; lastFor: (id: string) => RecordSummary | undefined; onChoose: (account: ReconAccount) => void; onOpen: (record: RecordSummary) => void }) {
  return (
    <>
      <h3>Choose the account to reconcile</h3>
      {accounts.length === 0 && <div className="data-state-message">No bank or credit card accounts are available.</div>}
      <div className="reconciliation-account-grid">
        {accounts.map((account) => {
          const last = lastFor(account.id);
          return (
            <div className="reconciliation-account-card" key={account.id}>
              <div className="account-card-header">
                <span className="account-icon">$</span>
                <span>
                  <strong>{account.name}</strong>
                  <small>{account.kind === "bank" ? "Bank account" : "Credit card"}{account.detail ? ` · ${account.detail}` : ""}</small>
                </span>
              </div>
              <div className="account-card-details">
                <span><small>Last reconciled in LedgerOps</small><strong>{last ? `${last.periodEnd} (ending ${formatCents(last.endingCents)})` : "Not yet"}</strong></span>
                {account.lastReconciled && !last && <span><small>Earlier history (demo)</small><strong>{account.lastReconciled}</strong></span>}
              </div>
              <button className="primary-button" onClick={() => onChoose(account)} aria-label={`Start reconciliation for ${account.name}`}>Start reconciliation <span>→</span></button>
            </div>
          );
        })}
      </div>
      <h3>Saved reconciliations</h3>
      {listError && <div className="data-state-message error">{listError}</div>}
      {records.length === 0 && !listError && <p className="muted">Nothing saved yet for this client and data source.</p>}
      {records.length > 0 && (
        <div className="panel recon-table">
          <div className="recon-row heading"><span>Account</span><span>Period</span><span>Status</span><span>Difference</span><span>Completed</span><span /></div>
          {records.map((record) => (
            <div className="recon-row" key={record.id} data-testid="saved-reconciliation">
              <strong>{record.accountName}</strong>
              <span>{record.periodStart} to {record.periodEnd}</span>
              <span className={`transaction-status ${record.status === "completed" ? "matched" : "needs-review"}`}>{record.status === "completed" ? "Completed" : "Draft"}</span>
              <span>{record.result ? formatCents(record.result.differenceCents) : "Not completed"}</span>
              <span>{record.completedAt ? `${record.completedAt.slice(0, 10)} by ${record.completedBy ?? "unknown"}` : "—"}</span>
              <button className="secondary-button" disabled={busy} onClick={() => onOpen(record)} aria-label={`View reconciliation ${record.accountName} ${record.periodEnd}`}>View</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StatementStep({ account, form, setForm, lines, setLines, previous, locked, busy, onContinue }: { account: ReconAccount; form: Form; setForm: (form: Form) => void; lines: StatementLine[]; setLines: (lines: StatementLine[]) => void; previous?: RecordSummary; locked: boolean; busy: boolean; onContinue: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const field = (key: keyof Form, value: string | boolean) => setForm({ ...form, [key]: value });
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
      {previous && <p className="muted">Last completed reconciliation ended {previous.periodEnd} with a balance of {formatCents(previous.endingCents)}. The beginning balance must match it.</p>}
      <div className="recon-fields">
        <label>Statement start date<input type="date" value={form.periodStart} disabled={locked} onChange={(event) => field("periodStart", event.target.value)} /></label>
        <label>Statement end date<input type="date" value={form.periodEnd} disabled={locked} onChange={(event) => field("periodEnd", event.target.value)} /></label>
        <label>Statement date<input type="date" value={form.statementDate} disabled={locked} onChange={(event) => field("statementDate", event.target.value)} /></label>
        <label>Beginning balance<input inputMode="decimal" value={form.beginning} disabled={locked} onChange={(event) => field("beginning", event.target.value)} placeholder="0.00" /></label>
        <label>Ending balance{account.kind === "credit_card" ? " (amount owed)" : ""}<input inputMode="decimal" value={form.ending} disabled={locked} onChange={(event) => field("ending", event.target.value)} placeholder="0.00" /></label>
      </div>
      {!previous && (
        <label className="recon-check">
          <input type="checkbox" checked={form.openingConfirmed} disabled={locked} onChange={(event) => field("openingConfirmed", event.target.checked)} />
          This is the first reconciliation here. I confirm the beginning balance matches the prior statement and earlier activity was already reconciled.
        </label>
      )}

      <div className="panel recon-import">
        <h4>Import statement transactions (optional)</h4>
        <p className="muted">Used only to match against your books. Nothing is imported into QuickBooks.</p>
        <label>CSV file<input type="file" accept=".csv,text/csv" disabled={locked} aria-label="Statement CSV file" onChange={(event) => void readFile(event.target.files?.[0])} /></label>
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
                <button className="secondary-button" disabled={result.errors.length > 0 || locked} onClick={() => { setLines(result.lines); setRows(null); setMapping(null); }}>
                  {result.errors.length > 0 ? "Fix the errors to import" : `Use these ${result.lines.length} statement lines`}
                </button>
              </div>
            )}
          </>
        )}
        {account.defaults && lines.length === 0 && !rows && !locked && (
          <button className="secondary-button" onClick={() => setLines(account.defaults!.statementLines)}>Load the demo statement transactions</button>
        )}
        {lines.length > 0 && (
          <div className="data-state-message" role="status">
            {lines.length} statement lines will be matched against your books.{" "}
            {!locked && <button className="text-button" onClick={() => setLines([])}>Remove them</button>}
          </div>
        )}
      </div>
      <button className="primary-button" disabled={busy} onClick={onContinue}>Continue to matching <span>→</span></button>
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
  const matchTo = (txnId: string, lineId: string) => update((current) => ({ ...current, matches: [...current.matches.filter((match) => match.txnId !== txnId && match.lineId !== lineId), ...(lineId ? [{ lineId, txnId }] : [])] }));

  return (
    <div className="recon-match">
      <h3>Match transactions to the statement</h3>
      <p className="muted">
        Mark each transaction that appears on the statement as cleared. Items you leave uncleared are shown as {labels.outstandingIncreasePlural.toLowerCase()} and {labels.outstandingDecreasePlural.toLowerCase()}. Marking items here does not mark them reconciled in QuickBooks.
      </p>
      {!work.record.completeness.complete && (
        <div className="data-state-message error" role="alert">
          The transaction data may be incomplete, so this reconciliation cannot be completed: {work.record.completeness.reasons.join(" ") || "the source did not confirm it is complete."}
        </div>
      )}
      {work.assumedInOpening.length > 0 && (
        <div className="data-state-message">{work.assumedInOpening.length} earlier transaction{work.assumedInOpening.length === 1 ? " is" : "s are"} dated before the statement and assumed to be inside the beginning balance.</div>
      )}
      <div className="queue-filters">
        <label>Search<input type="search" value={search} placeholder="Payee, memo or amount" aria-label="Search transactions to match" onChange={(event) => setSearch(event.target.value)} /></label>
        <label>
          Show
          <select value={filter} aria-label="Filter transactions" onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">All</option>
            <option value="cleared">Cleared</option>
            <option value="outstanding">Outstanding</option>
            {csv && <option value="suggested">Suggested matches</option>}
            <option value="flagged">Flagged</option>
          </select>
        </label>
        {!locked && <button className="secondary-button" onClick={() => clear(shown.map((item) => item.id))}>Clear all shown</button>}
        {!locked && <button className="secondary-button" onClick={() => unclear(shown.map((item) => item.id))}>Unclear all shown</button>}
        {!locked && csv && <button className="secondary-button" disabled={computation.suggestions.length === 0} onClick={() => clear(computation.suggestions.map((suggestion) => suggestion.txnId))}>Clear all suggested matches ({computation.suggestions.length})</button>}
        {!locked && <button className="secondary-button" disabled={busy} onClick={onReload}>Reload transactions</button>}
      </div>

      <div className="panel recon-table">
        <div className="recon-row heading match"><span>Cleared</span><span>Date</span><span>Payee</span><span>Amount</span><span>Status</span><span>Statement</span></div>
        {shown.length === 0 && <p className="muted">No transactions match.</p>}
        {shown.map((item) => {
          const isCleared = clearedSet.has(item.id);
          const suggestion = suggestionByTxn.get(item.id);
          const matchedLine = lineById.get(matchByTxn.get(item.id) ?? "");
          const freeLines = computation.unmatchedLines.filter((line) => line.direction === item.direction);
          return (
            <div className={`recon-row match ${isCleared ? "cleared" : ""}`} key={item.id} data-testid="recon-row">
              <button className={`clear-check ${isCleared ? "checked" : ""}`} disabled={locked} aria-pressed={isCleared} aria-label={`${isCleared ? "Mark uncleared" : "Mark cleared"}: ${item.payee || item.memo} ${formatCents(item.amountCents)}`} onClick={() => (isCleared ? unclear([item.id]) : clear([item.id]))}>{isCleared ? "✓" : ""}</button>
              <span>{item.date}</span>
              <span><strong>{item.payee || "(no payee)"}</strong>{item.memo ? <small> {item.memo}</small> : null}{duplicateIds.has(item.id) && <em className="recon-flag">Possible duplicate</em>}{nearTxns.has(item.id) && <em className="recon-flag">Amount differs from a statement line</em>}</span>
              <span>{signed(item)} <small>{item.direction === "increase" ? labels.increase : labels.decrease}</small></span>
              <span className={`transaction-status ${isCleared ? "matched" : "needs-receipt"}`}>{isCleared ? "Cleared" : item.direction === "increase" ? labels.outstandingIncrease : labels.outstandingDecrease}</span>
              <span>
                {!csv && "—"}
                {csv && matchedLine && <>{matchedLine.description || "Statement line"} ({matchedLine.date})</>}
                {csv && !matchedLine && suggestion && !locked && (
                  <button className="text-button" onClick={() => clear([item.id])} aria-label={`Accept suggested match for ${item.payee}`}>
                    Suggested: {lineById.get(suggestion.lineId)?.description || "statement line"} — accept
                  </button>
                )}
                {csv && !matchedLine && isCleared && !locked && freeLines.length > 0 && (
                  <select aria-label={`Match ${item.payee} to a statement line`} value="" onChange={(event) => matchTo(item.id, event.target.value)}>
                    <option value="">Match to statement line…</option>
                    {freeLines.map((line) => <option key={line.id} value={line.id}>{line.date} {line.description} {formatCents(line.amountCents)}</option>)}
                  </select>
                )}
                {csv && !matchedLine && !suggestion && !isCleared && "Not on statement"}
              </span>
            </div>
          );
        })}
      </div>

      {csv && (
        <div className="panel">
          <h4>On the statement but not matched ({computation.unmatchedLines.length})</h4>
          {computation.unmatchedLines.length === 0 ? <p className="muted">Every statement line is matched.</p> : (
            <ul className="recon-problems">
              {computation.unmatchedLines.map((line) => (
                <li key={line.id}>
                  {line.date} · {line.description || "Statement line"} · {signed(line)}. {suggestionHint(line, computation, Boolean(entryTools))}
                  {entryTools && !locked && !computation.suggestions.some((suggestion) => suggestion.lineId === line.id) && !computation.nearMatches.some((near) => near.lineId === line.id) && (
                    <>{" "}<button className="text-button" onClick={() => setPrefill({ key: Date.now(), accountId: record.accountId, date: line.date, payee: line.description, amountCents: line.amountCents, direction: line.direction })} aria-label={`Start entering ${line.description || "statement line"} ${formatCents(line.amountCents)}`}>Start entering this transaction</button></>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
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

function ReviewStep({ work, computation, storage, busy, onSave, onComplete, onReopen, onDownload }: { work: Work; computation: ReturnType<typeof computeReconciliation>; storage: Storage | null; busy: boolean; onSave: () => void; onComplete: () => void; onReopen: (reason: string) => void; onDownload: () => void }) {
  const { record } = work;
  const labels = labelsFor(record.accountKind);
  const [reason, setReason] = useState("");
  const completed = record.status === "completed";
  const blocking = computation.issues.filter((issue) => issue.severity === "blocking");
  const warnings = computation.issues.filter((issue) => issue.severity === "warning");
  const line = (label: string, cents: number, strong = false) => <div className={`recon-calc-row ${strong ? "strong" : ""}`} key={label}><span>{label}</span><span>{formatCents(cents)}</span></div>;

  return (
    <div className="recon-review">
      <h3>Review and complete</h3>
      {completed && (
        <div className="data-state-message" role="status" data-testid="completed-banner">
          Completed {record.completedAt?.slice(0, 10)} by {record.completedBy}. {storage?.durable ? "Saved in the LedgerOps database." : "Saved as a temporary local development record; it will be lost when the server restarts."} QuickBooks was not changed.
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
        {line(labels.outstandingIncreasePlural, computation.outstandingIncreaseCents)}
        {line(labels.outstandingDecreasePlural, computation.outstandingDecreaseCents)}
        {line("Adjusted statement balance", computation.adjustedBankBalanceCents)}
        {line("Book balance at statement date", computation.bookBalanceCents)}
      </div>

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
        {!completed && <button className="secondary-button" disabled={busy} onClick={onSave}>Save progress</button>}
        {!completed && <button className="primary-button" disabled={busy || !computation.canComplete} onClick={onComplete}>Complete reconciliation <span>✓</span></button>}
        <button className="secondary-button" onClick={onDownload}>Download summary (CSV)</button>
      </div>

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
