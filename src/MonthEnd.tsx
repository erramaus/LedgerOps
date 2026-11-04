import { useState, type ReactNode } from "react";
import { PeriodPicker } from "./PeriodPicker";
import { monthLabel, type Period } from "../shared/period";
import { progressCounts, type ChecklistItem, type MonthEndEvent, type MonthEndRecord, type Source, type StepStatus, type StepView } from "../shared/monthEnd";
import type { MonthEndView } from "./useMonthEnd";

const STATUS_CLASS: Record<StepStatus, string> = { "Not Started": "not-started", "In Progress": "in-progress", Blocked: "blocked", Complete: "complete" };
const EVENT_TEXT: Record<MonthEndEvent["action"], string> = { signed_off: "Review recorded", signoff_cleared: "Review withdrawn", closed: "Month closed", reopened: "Month reopened" };

const when = (iso: string) => iso.replace("T", " ").slice(0, 16);

function ReviewConfirmation({ item, view, clientName, periodLabel, onDone }: { item: ChecklistItem; view: MonthEndView; clientName: string; periodLabel: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const signoff = item.signoff!;
  const noteOk = !signoff.noteRequired || note.trim().length >= 5;
  return (
    <div className="me-confirm" role="group" aria-label={`Confirm review: ${item.title}`} data-testid={`confirm-${item.id}`}>
      <strong>Confirm your review before it is recorded</strong>
      <dl>
        <div><dt>Client</dt><dd>{clientName}</dd></div>
        <div><dt>Period</dt><dd>{periodLabel}</dd></div>
        <div><dt>{signoff.asOf ? `Figures as of ${signoff.asOf}` : "Figures"}</dt><dd data-testid={`confirm-figures-${item.id}`}>{signoff.figures}</dd></div>
        <div>
          <dt>Exceptions you are accepting</dt>
          <dd data-testid={`confirm-exceptions-${item.id}`}>{signoff.exceptions.length > 0 ? <ul>{signoff.exceptions.map((line) => <li key={line}>{line}</li>)}</ul> : "None"}</dd>
        </div>
      </dl>
      <p className="muted me-hint">Your name and the time are recorded with this review. It does not complete any reconciliation or other required check, and it stops counting if these figures change.</p>
      {signoff.noteRequired && (
        <label className="me-note">
          Note (required, because you are accepting an exception)
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why is this acceptable?" aria-label={`Note for ${item.title}`} />
        </label>
      )}
      <div className="me-actions">
        <button className="primary-button" disabled={view.busy || !noteOk} onClick={() => void view.signOff(item.id, note.trim(), { fingerprint: signoff.fingerprint, figures: signoff.figures, exceptions: signoff.exceptions, asOf: signoff.asOf }).then(onDone)}>Confirm review</button>
        <button className="text-button" disabled={view.busy} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function Step({ item, view, onNavigate, locked, clientName, periodLabel }: { item: ChecklistItem; view: MonthEndView; onNavigate: (destination: StepView) => void; locked: boolean; clientName: string; periodLabel: string }) {
  const [confirming, setConfirming] = useState(false);
  const signoff = item.signoff;
  const canSign = Boolean(signoff?.allowed) && !locked && item.status !== "Complete";
  return (
    <li className={`me-step ${STATUS_CLASS[item.status]}`} data-testid={`step-${item.id}`}>
      <div className="me-step-head">
        <span className="me-step-number" aria-hidden="true">{item.status === "Complete" ? "?" : item.number}</span>
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
        {item.action && <button className="secondary-button me-open" onClick={() => onNavigate(item.action!.view)}>{item.action.label} <span>?</span></button>}
        {canSign && signoff && !confirming && <button className="primary-button" disabled={view.busy} onClick={() => setConfirming(true)}>{signoff.label}</button>}
        {signoff?.current && !signoff.stale && item.status === "Complete" && !locked && <button className="text-button" disabled={view.busy} onClick={() => void view.withdraw(item.id)}>Withdraw this review</button>}
      </div>
      {canSign && signoff && confirming && <ReviewConfirmation item={item} view={view} clientName={clientName} periodLabel={periodLabel} onDone={() => setConfirming(false)} />}
      {signoff && !signoff.allowed && item.status !== "Complete" && <p className="muted me-hint">This cannot be accepted as an exception. Fix it first.</p>}
    </li>
  );
}

function HistoryList({ record }: { record: MonthEndRecord }) {
  if (record.history.length === 0) return <p className="muted">Nothing has been recorded for this month yet.</p>;
  return (
    <div className="panel recon-table" data-testid="month-history">
      <div className="recon-row heading history"><span>When</span><span>Who</span><span>What</span><span>Detail</span></div>
      {record.history.map((event, index) => {
        const lines = [
          event.figures ? `Figures: ${event.figures}` : null,
          event.reason ? `Reason: ${event.reason}` : null,
          event.note ? `Note: ${event.note}` : null,
        ].filter((line): line is string => line !== null);
        return (
          <div className="recon-row history" key={`${index}-${event.at}-${event.action}`}>
            <span>{when(event.at)}</span>
            <span>{event.by}</span>
            <span>{EVENT_TEXT[event.action]}{event.step ? ` (${event.step})` : ""}</span>
            <span>
              {lines.length === 0 && !event.exceptions?.length ? "No further detail recorded" : lines.map((line) => <span className="history-line" key={line}>{line}</span>)}
              {event.exceptions && event.exceptions.length > 0 && (
                <span className="history-line">Exceptions recorded: <ul className="history-exceptions">{event.exceptions.map((line) => <li key={line}>{line}</li>)}</ul></span>
              )}
            </span>
          </div>
        );
      })}
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
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  const { checklist, record, status } = view;
  const closed = Boolean(checklist?.closed);
  const done = checklist ? checklist.items.filter((item) => item.id !== "approval" && item.status === "Complete").length : 0;
  const percent = Math.round((done / 9) * 100);
  const counts = checklist ? progressCounts(checklist) : null;
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
            <p className="muted me-progress-note" data-testid="progress-note">Steps 1–9 are the required checks. Step 10 is the final approval, and it opens only when all nine are complete.</p>
            {counts && (
              <ul className="me-counts" data-testid="progress-counts" aria-label="Required checks by status">
                {(["Complete", "In Progress", "Not Started", "Blocked"] as const).map((label) => <li key={label} className={STATUS_CLASS[label]} data-testid={`count-${STATUS_CLASS[label]}`}>{label}: <strong>{counts[label]}</strong></li>)}
              </ul>
            )}
            <label className="me-filter">
              <input type="checkbox" checked={unfinishedOnly} onChange={(event) => setUnfinishedOnly(event.target.checked)} />
              Show unfinished checks
              <span className="muted" data-testid="filter-count"> (showing {unfinishedOnly ? 9 - done : 9} of 9)</span>
            </label>
            <div className="large-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Month-end progress"><span style={{ width: `${percent}%` }} /></div>
          </section>
          {closedWhileChanged && (
            <div className="data-state-message error" role="alert" data-testid="changed-since-closing">
              This month was closed, but it is no longer verified: {checklist.changedSinceClosing.join("; ")}. Reopen it to review again.
            </div>
          )}
          <ol className="me-steps">
            {checklist.items.filter((item) => item.id !== "approval" && (!unfinishedOnly || item.status !== "Complete")).map((item) => <Step key={`${item.id}-${item.signoff?.fingerprint ?? ""}`} item={item} view={view} onNavigate={onNavigate} locked={closed} clientName={clientName} periodLabel={monthLabel(period)} />)}
          </ol>
          {unfinishedOnly && done === 9 && <p className="muted" data-testid="filter-empty">All 9 required checks are complete.</p>}

          {checklist.items.filter((item) => item.id === "approval").map((item) => (
            <section className={`me-step approval ${STATUS_CLASS[item.status]}`} key={item.id} data-testid="step-approval">
              <div className="me-step-head">
                <span className="me-step-number" aria-hidden="true">{item.status === "Complete" ? "✓" : item.number}</span>
                <h3>{item.number}. {item.title}</h3>
                <span className={`me-status ${STATUS_CLASS[item.status]}`} data-testid="status-approval">{item.status}</span>
              </div>
              <p className="me-attention">{item.attention}</p>
              {!closed && !checklist.readyToClose && <p className="me-blocked" data-testid="approval-blocked">Approval is blocked: every one of the nine required checks must be Complete first. Reviewing figures here never overrides an unfinished reconciliation or a missing check.</p>}
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
