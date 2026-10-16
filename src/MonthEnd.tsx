import { useState, type ReactNode } from "react";
import { PeriodPicker } from "./PeriodPicker";
import { monthLabel, type Period } from "../shared/period";
import type { ChecklistItem, MonthEndEvent, MonthEndRecord, Source, StepStatus, StepView } from "../shared/monthEnd";
import type { MonthEndView } from "./useMonthEnd";

const STATUS_CLASS: Record<StepStatus, string> = { "Not Started": "not-started", "In Progress": "in-progress", Blocked: "blocked", Complete: "complete" };
const EVENT_TEXT: Record<MonthEndEvent["action"], string> = { signed_off: "Review recorded", signoff_cleared: "Review withdrawn", closed: "Month closed", reopened: "Month reopened" };

const when = (iso: string) => iso.replace("T", " ").slice(0, 16);

function Step({ item, view, onNavigate, locked }: { item: ChecklistItem; view: MonthEndView; onNavigate: (destination: StepView) => void; locked: boolean }) {
  const [note, setNote] = useState("");
  const signoff = item.signoff;
  const canSign = Boolean(signoff?.allowed) && !locked && item.status !== "Complete";
  const noteOk = !signoff?.noteRequired || note.trim().length >= 5;
  return (
    <li className={`me-step ${STATUS_CLASS[item.status]}`} data-testid={`step-${item.id}`}>
      <div className="me-step-head">
        <span className="me-step-number" aria-hidden="true">{item.status === "Complete" ? "✓" : item.number}</span>
        <h3>{item.number}. {item.title}</h3>
        <span className={`me-status ${STATUS_CLASS[item.status]}`} data-testid={`status-${item.id}`}>{item.status}</span>
      </div>
      <p className="me-attention">{item.attention}</p>
      {item.details.length > 0 && <ul className="me-details">{item.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
      {item.evidence.length > 0 && (
        <div className="me-evidence" data-testid={`evidence-${item.id}`}>
          <strong>Completion evidence</strong>
          <ul>{item.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      <div className="me-actions">
        {item.action && <button className="secondary-button me-open" onClick={() => onNavigate(item.action!.view)}>{item.action.label} <span>→</span></button>}
        {canSign && signoff && (
          <>
            {signoff.noteRequired && (
              <label className="me-note">
                Note (required)
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why is this acceptable?" aria-label={`Note for ${item.title}`} />
              </label>
            )}
            <button className="primary-button" disabled={view.busy || !noteOk} onClick={() => void view.signOff(item.id, note.trim(), signoff.fingerprint, signoff.figures).then(() => setNote(""))}>{signoff.label}</button>
          </>
        )}
        {signoff?.current && !signoff.stale && item.status === "Complete" && !locked && <button className="text-button" disabled={view.busy} onClick={() => void view.withdraw(item.id)}>Withdraw this review</button>}
      </div>
      {signoff && !signoff.allowed && item.status !== "Complete" && <p className="muted me-hint">This cannot be accepted as an exception. Fix it first.</p>}
    </li>
  );
}

function HistoryList({ record }: { record: MonthEndRecord }) {
  if (record.history.length === 0) return <p className="muted">Nothing has been recorded for this month yet.</p>;
  return (
    <div className="panel recon-table" data-testid="month-history">
      <div className="recon-row heading history"><span>When</span><span>Who</span><span>What</span><span>Detail</span></div>
      {record.history.map((event, index) => (
        <div className="recon-row history" key={`${index}-${event.at}-${event.action}`}>
          <span>{when(event.at)}</span>
          <span>{event.by}</span>
          <span>{EVENT_TEXT[event.action]}{event.step ? ` (${event.step})` : ""}</span>
          <span>{event.reason ?? event.note ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

export function MonthEnd({
  source,
  clientName,
  period,
  today,
  view,
  onPeriodChange,
  onNavigate,
  sourceSwitch,
}: {
  source: Source;
  clientName: string;
  period: Period;
  today: string;
  view: MonthEndView;
  onPeriodChange: (period: Period) => void;
  onNavigate: (destination: StepView) => void;
  sourceSwitch: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const { checklist, record, status } = view;
  const closed = Boolean(checklist?.closed);
  const done = checklist ? checklist.items.filter((item) => item.id !== "approval" && item.status === "Complete").length : 0;
  const percent = Math.round((done / 9) * 100);
  const closedWhileChanged = Boolean(record?.closing) && Boolean(checklist) && !checklist!.closed;

  return (
    <div className="page-content month-end">
      <section className="month-end-hero">
        <div>
          <p className="eyebrow">{clientName.toUpperCase()} · {monthLabel(period).toUpperCase()}</p>
          <h2>Month End</h2>
          <p className="muted">Work down the list. Each step shows what is left and takes you to where it is done.</p>
          {source === "quickbooks" && <p className="muted">One QuickBooks Sandbox company is connected. Month-end records are kept in LedgerOps; nothing here closes or locks a period in QuickBooks.</p>}
        </div>
        <PeriodPicker period={period} today={today} onChange={onPeriodChange} />
      </section>
      {sourceSwitch}
      <div className="recon-banner" role="note">
        <strong>{source === "demo" ? "Demo data" : "QuickBooks Sandbox (read only)"}</strong>
        <span>Closing a month is recorded in LedgerOps only. QuickBooks is never changed.</span>
        <span className={`recon-storage ${view.storage?.durable ? "durable" : "temporary"}`} data-testid="month-end-storage">
          {view.storage === null ? "Checking where records are stored..." : view.storage.durable ? "Month-end records are saved in the LedgerOps database." : "Temporary local development records: they are lost when the server restarts. Set DATABASE_URL for durable storage."}
        </span>
      </div>

      {status === "loading" && <div className="data-state-message">Checking {monthLabel(period)}...</div>}
      {status === "error" && <div className="data-state-message error" role="alert">{view.error} <button className="text-button" onClick={view.reload}>Try again</button></div>}
      {view.actionError && <div className="data-state-message error" role="alert">{view.actionError}</div>}

      {checklist && status !== "error" && (
        <>
          <section className={`me-summary ${closed ? "closed" : checklist.readyToClose ? "ready" : "open"}`} data-testid="month-summary">
            <div>
              <strong>{closed ? `${monthLabel(period)} is closed` : checklist.readyToClose ? "Everything checks out. Ready for your approval." : `${9 - done} of 9 checks still need work`}</strong>
              <span>{done} of 9 checks complete</span>
            </div>
            <div className="large-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Month-end progress"><span style={{ width: `${percent}%` }} /></div>
          </section>
          {closedWhileChanged && (
            <div className="data-state-message error" role="alert" data-testid="changed-since-closing">
              This month was closed, but it is no longer verified: {checklist.changedSinceClosing.join("; ")}. Reopen it to review again.
            </div>
          )}
          <ol className="me-steps">
            {checklist.items.filter((item) => item.id !== "approval").map((item) => <Step key={`${item.id}-${item.signoff?.fingerprint ?? ""}`} item={item} view={view} onNavigate={onNavigate} locked={closed} />)}
          </ol>

          {checklist.items.filter((item) => item.id === "approval").map((item) => (
            <section className={`me-step approval ${STATUS_CLASS[item.status]}`} key={item.id} data-testid="step-approval">
              <div className="me-step-head">
                <span className="me-step-number" aria-hidden="true">{item.status === "Complete" ? "✓" : item.number}</span>
                <h3>{item.number}. {item.title}</h3>
                <span className={`me-status ${STATUS_CLASS[item.status]}`} data-testid="status-approval">{item.status}</span>
              </div>
              <p className="me-attention">{item.attention}</p>
              {item.details.length > 0 && <ul className="me-details">{item.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
              {(checklist.readyToClose || closed) && (
                <div className="me-evidence">
                  <strong>{closed ? "Remaining exceptions recorded at closing" : "Remaining exceptions that will be recorded"}</strong>
                  {(closed ? record?.closing?.exceptions : checklist.exceptions)?.length ? <ul data-testid="exceptions">{(closed ? record!.closing!.exceptions : checklist.exceptions).map((line) => <li key={line}>{line}</li>)}</ul> : <p className="muted" data-testid="exceptions">None.</p>}
                </div>
              )}
              {closed && record?.closing && <p className="muted" data-testid="closing-info">Closed {when(record.closing.closedAt)} by {record.closing.closedBy}. {record.closing.reconciliations.length} reconciliation{record.closing.reconciliations.length === 1 ? "" : "s"} relied on.</p>}
              {!closed && (
                <button className="primary-button me-approve" disabled={!checklist.readyToClose || view.busy || !record} onClick={() => void view.close()}>
                  Approve and close {monthLabel(period)} <span>→</span>
                </button>
              )}
              {!closed && !record && checklist.readyToClose && <p className="muted me-hint">Record your review of the receivables, payables and statements first.</p>}
              {(closed || closedWhileChanged) && record?.closing && (
                <div className="me-reopen">
                  <label>
                    Reason for reopening
                    <textarea value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Reason for reopening this month" />
                  </label>
                  <button className="secondary-button" disabled={view.busy || reason.trim().length < 5} onClick={() => void view.reopen(reason.trim()).then(() => setReason(""))}>Reopen {monthLabel(period)}</button>
                </div>
              )}
            </section>
          ))}

          <h3>History for {monthLabel(period)}</h3>
          {record ? <HistoryList record={record} /> : <p className="muted">Nothing has been recorded for this month yet.</p>}
          {view.history.some((item) => item.id !== record?.id) && (
            <>
              <h3>Other months for {clientName}</h3>
              <div className="panel recon-table" data-testid="other-months">
                <div className="recon-row heading history"><span>Month</span><span>Status</span><span>Closed</span><span>Exceptions</span></div>
                {view.history.filter((item) => item.id !== record?.id).sort((left, right) => right.period.localeCompare(left.period)).map((item) => (
                  <div className="recon-row history" key={item.id}>
                    <span>{monthLabel({ year: Number(item.period.slice(0, 4)), month: Number(item.period.slice(5, 7)) })}</span>
                    <span>{item.status === "closed" ? "Closed" : item.history.some((event) => event.action === "reopened") ? "Reopened" : "Open"}</span>
                    <span>{item.closing ? `${when(item.closing.closedAt)} by ${item.closing.closedBy}` : "—"}</span>
                    <span>{item.closing ? item.closing.exceptions.length : "—"}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
