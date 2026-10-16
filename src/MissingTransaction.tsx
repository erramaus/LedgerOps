import { useEffect, useState } from "react";
import type { LedgerAccountDef } from "../shared/accounting";
import { DEMO_CLIENT_ID, demoLedger } from "../shared/demoBooks";
import { getAdditionalDemoCompany } from "../shared/demoCompanyBooks";
import {
  ENTRY_TYPE_LABELS,
  ENTRY_TYPES_FOR,
  activeRevision,
  categoryOptions,
  entryAccounts,
  validateEntryInput,
  type DemoEntryInput,
  type DemoEntryRecord,
  type EntryErrors,
  type EntryType,
} from "../shared/demoEntries";
import { formatCents, parseMoneyToCents, type Direction } from "../shared/reconciliation";
import { DemoEntryApiError } from "./services/demoEntryService";

/** Everything the panel may do. Supplied only for demo data; QuickBooks transactions cannot be created here. */
export type EntryTools = {
  clientId: string;
  chart: LedgerAccountDef[];
  records: DemoEntryRecord[];
  loadError: string | null;
  create: (input: DemoEntryInput, confirmedNotDuplicate: boolean) => Promise<void>;
  edit: (record: DemoEntryRecord, input: DemoEntryInput, reason: string, confirmedNotDuplicate: boolean) => Promise<void>;
  reverse: (record: DemoEntryRecord, reason: string) => Promise<void>;
};
/** A statement line the person chose to enter. It only fills in the form; nothing is saved until they confirm. */
export type EntryPrefill = { key: number; accountId: string; date: string; payee: string; amountCents: number; direction: Direction };

type FormState = { accountId: string; type: EntryType | ""; date: string; payee: string; amount: string; categoryId: string; memo: string };
type Mode = { kind: "add" } | { kind: "edit"; record: DemoEntryRecord };

const kindOf = (accountId: string, clientId: string) => entryAccounts(clientId).find((account) => account.id === accountId)?.kind;
const accountName = (accountId: string, clientId: string) => entryAccounts(clientId).find((account) => account.id === accountId)?.name ?? accountId;
const centsText = (cents: number) => (cents / 100).toFixed(2);
const stamp = (iso: string) => iso.replace("T", " ").slice(0, 16);
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : "The transaction could not be saved. Nothing was changed.");

function typeFor(accountId: string, direction: Direction, clientId: string): EntryType | "" {
  const kind = kindOf(accountId, clientId);
  if (kind === "credit_card") return direction === "increase" ? "charge" : "payment_or_credit";
  if (kind === "bank") return direction === "increase" ? "deposit" : "withdrawal";
  return "";
}

export function MissingTransactionPanel({ tools, accountId, locked, prefill, onChanged }: { tools: EntryTools; accountId: string; locked: boolean; prefill: EntryPrefill | null; onChanged: () => void }) {
  const accounts = entryAccounts(tools.clientId);
  const blank = (): FormState => ({ accountId, type: "", date: "", payee: "", amount: "", categoryId: "", memo: "" });
  const [mode, setMode] = useState<Mode | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<EntryErrors & { reason?: string; amount?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reversing, setReversing] = useState<DemoEntryRecord | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  useEffect(() => {
    if (!prefill) return;
    setMode({ kind: "add" });
    setForm({ accountId: prefill.accountId, type: typeFor(prefill.accountId, prefill.direction, tools.clientId), date: prefill.date, payee: prefill.payee, amount: centsText(prefill.amountCents), categoryId: "", memo: "" });
    setReason("");
    setErrors({});
    setServerError(null);
    setDuplicate(null);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.key, tools.clientId]);

  const open = (next: Mode) => {
    setMode(next);
    setReason("");
    setErrors({});
    setServerError(null);
    setDuplicate(null);
    setMessage(null);
    setReversing(null);
    if (next.kind === "add") return setForm(blank());
    const revision = activeRevision(next.record)!;
    setForm({ accountId: revision.accountId, type: revision.type, date: revision.date, payee: revision.payee, amount: centsText(revision.amountCents), categoryId: revision.categoryId, memo: revision.memo });
  };
  const close = () => {
    setMode(null);
    setErrors({});
    setServerError(null);
    setDuplicate(null);
  };
  const change = (patch: Partial<FormState>) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      const types = kindOf(next.accountId, tools.clientId) === "credit_card" ? ENTRY_TYPES_FOR.credit_card : ENTRY_TYPES_FOR.bank;
      if (next.type && !types.includes(next.type)) next.type = "";
      if (next.type && next.categoryId && !categoryOptions(next.type, tools.chart).some((option) => option.id === next.categoryId)) next.categoryId = "";
      if (!next.type) next.categoryId = "";
      return next;
    });
    setDuplicate(null);
  };

  const submit = async (confirmedNotDuplicate: boolean) => {
    setServerError(null);
    const cents = parseMoneyToCents(form.amount);
    const input = { accountId: form.accountId, type: form.type || undefined, date: form.date, payee: form.payee, amountCents: cents ?? undefined, categoryId: form.categoryId, memo: form.memo };
    const found: EntryErrors & { reason?: string; amount?: string } = validateEntryInput(input, tools.chart, tools.clientId);
    if (cents === null && form.amount.trim()) found.amountCents = "Enter the amount as a number, for example 224.20.";
    if (mode?.kind === "edit" && reason.trim().length < 5) found.reason = "Give a reason for the change. It is kept in the history.";
    setErrors(found);
    if (Object.keys(found).length > 0 || !mode) return;
    const complete = input as DemoEntryInput;
    setBusy(true);
    try {
      if (mode.kind === "edit") await tools.edit(mode.record, complete, reason.trim(), confirmedNotDuplicate);
      else await tools.create(complete, confirmedNotDuplicate);
      setMessage(mode.kind === "edit" ? "Saved. The old entry was reversed and the corrected one added. Both stay in the history." : `Saved. ${formatCents(complete.amountCents)} for ${complete.payee.trim()} is now in the books. It is not marked cleared: tick it once it matches the statement.`);
      close();
      onChanged();
    } catch (failure) {
      if (failure instanceof DemoEntryApiError && failure.code === "POSSIBLE_DUPLICATE") setDuplicate(failure.message);
      else setServerError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const confirmReverse = async () => {
    if (!reversing) return;
    if (reverseReason.trim().length < 5) return setServerError("Give a reason for reversing it. It is kept in the history.");
    setBusy(true);
    setServerError(null);
    try {
      await tools.reverse(reversing, reverseReason.trim());
      setMessage("Reversed. The original entry and its reversal both stay in the books and the history.");
      setReversing(null);
      setReverseReason("");
      onChanged();
    } catch (failure) {
      setServerError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const types = kindOf(form.accountId, tools.clientId) === "credit_card" ? ENTRY_TYPES_FOR.credit_card : kindOf(form.accountId, tools.clientId) === "bank" ? ENTRY_TYPES_FOR.bank : [];
  const categories = form.type ? categoryOptions(form.type, tools.chart) : [];
  const field = (key: keyof EntryErrors | "reason", text?: string) => (text ? <small className="field-error" role="alert" data-field={key}>{text}</small> : null);

  return (
    <div className="panel" data-testid="missing-transaction-panel">
      <h4>Add a missing transaction</h4>
      <p className="muted">
        If something on the statement is not in the books, record it here. Demo data only: nothing is sent to QuickBooks. LedgerOps never adds a transaction on its own to make a reconciliation balance.
      </p>
      {tools.loadError && <div className="data-state-message error" role="alert">Saved manual entries could not be loaded: {tools.loadError}</div>}
      {message && <div className="data-state-message" role="status">{message}</div>}
      {locked && <p className="muted">This reconciliation is completed. Reopen it, with a reason, before adding or changing transactions.</p>}
      {!locked && !mode && <button className="secondary-button" onClick={() => open({ kind: "add" })}>Add missing transaction</button>}

      {!locked && mode && (
        <form className="recon-form" aria-label={mode.kind === "edit" ? "Edit transaction" : "New transaction"} onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
          <div className="recon-fields">
            <label>Date<input type="date" value={form.date} onChange={(event) => change({ date: event.target.value })} />{field("date", errors.date)}</label>
            <label>Payee<input value={form.payee} onChange={(event) => change({ payee: event.target.value })} />{field("payee", errors.payee)}</label>
            <label>Amount<input inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(event) => change({ amount: event.target.value })} />{field("amountCents", errors.amountCents)}</label>
            <label>
              Account
              <select value={form.accountId} onChange={(event) => change({ accountId: event.target.value })}>
                <option value="">Choose an account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              {field("accountId", errors.accountId)}
            </label>
            <label>
              Transaction type
              <select value={form.type} onChange={(event) => change({ type: event.target.value as EntryType | "" })}>
                <option value="">Choose a type</option>
                {types.map((type) => <option key={type} value={type}>{ENTRY_TYPE_LABELS[type]}</option>)}
              </select>
              {field("type", errors.type)}
            </label>
            <label>
              Category
              <select value={form.categoryId} disabled={!form.type} onChange={(event) => change({ categoryId: event.target.value })}>
                <option value="">{form.type ? "Choose a category" : "Choose a type first"}</option>
                {categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
              {field("categoryId", errors.categoryId)}
            </label>
            <label>Memo (optional)<input value={form.memo} onChange={(event) => change({ memo: event.target.value })} />{field("memo", errors.memo)}</label>
            {mode.kind === "edit" && <label>Reason for the change<input value={reason} onChange={(event) => setReason(event.target.value)} />{field("reason", errors.reason)}</label>}
          </div>
          {serverError && <div className="data-state-message error" role="alert">{serverError}</div>}
          {duplicate && (
            <div className="data-state-message error" role="alert" data-testid="duplicate-warning">
              {duplicate}{" "}
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void submit(true)}>This is a separate transaction, save it</button>
            </div>
          )}
          <div className="recon-actions">
            <button type="submit" className="primary-button" disabled={busy}>{mode.kind === "edit" ? "Save correction" : "Save transaction"}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </form>
      )}

      {tools.records.length > 0 && (
        <div data-testid="entered-transactions">
          <h4>Entered in LedgerOps</h4>
          <ul className="entry-list">
            {tools.records.map((record) => {
              const shown = activeRevision(record) ?? record.revisions[record.revisions.length - 1];
              const active = record.status === "active";
              return (
                <li key={record.id} data-testid="entered-transaction">
                  <div>
                    <strong>{shown.payee}</strong> · {shown.date} · {accountName(shown.accountId, tools.clientId)} · {ENTRY_TYPE_LABELS[shown.type]} · {formatCents(shown.amountCents)}
                    {" "}<span className={`transaction-status ${active ? "matched" : "needs-receipt"}`}>{active ? "Active" : "Reversed"}</span>
                  </div>
                  {!locked && active && (
                    <div className="recon-actions">
                      <button className="text-button" disabled={busy} onClick={() => open({ kind: "edit", record })} aria-label={`Edit ${shown.payee} ${formatCents(shown.amountCents)}`}>Edit</button>
                      <button className="text-button" disabled={busy} onClick={() => { setReversing(record); setReverseReason(""); setServerError(null); setMode(null); }} aria-label={`Reverse ${shown.payee} ${formatCents(shown.amountCents)}`}>Reverse</button>
                    </div>
                  )}
                  {reversing?.id === record.id && (
                    <div className="recon-form">
                      <p className="muted">Reversing adds an opposite entry. The original stays in the books and the history; nothing is deleted.</p>
                      <label>Reason for reversing<input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} /></label>
                      {serverError && <div className="data-state-message error" role="alert">{serverError}</div>}
                      <div className="recon-actions">
                        <button className="primary-button" disabled={busy} onClick={() => void confirmReverse()}>Confirm reversal</button>
                        <button className="secondary-button" disabled={busy} onClick={() => setReversing(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                  <details>
                    <summary>History ({record.history.length})</summary>
                    <ul className="recon-problems">
                      {record.history.map((event, index) => (
                        <li key={`${index}-${event.at}`}>{stamp(event.at)} · {event.by} · {event.action}: {event.summary}{event.reason ? ` Reason: ${event.reason}` : ""}</li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
