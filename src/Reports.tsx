import { useEffect, useState, type ReactNode } from "react";
import { PeriodPicker } from "./PeriodPicker";
import type { ReportCheck, ReportId, ReportRow, ReportTable } from "../shared/accounting";
import { DEMO_CLIENT_ID, DEMO_RECONCILIATION_ACCOUNTS } from "../shared/demoBooks";
import type { DemoLedger } from "../shared/demoMonthEnd";
import type { Source } from "../shared/monthEnd";
import { reconFactsFor } from "../shared/monthEndFacts";
import { monthLabel, periodKey, previousRangeFor, rangeFor, type Period, type RangeMode } from "../shared/period";
import { formatCents } from "../shared/reconciliation";
import type { LedgerAccount } from "./services/bookkeepingTypes";
import type { Loaded } from "./services/monthEndData";
import { REPORT_DESCRIPTIONS, REPORT_IDS, REPORT_TITLES, loadComparison, loadReport } from "./services/periodReports";
import { quickBooksService } from "./services/quickBooksService";
import { formatPercent, percentChange, plSummary } from "./services/plSummary";
import { reconciliationService } from "./services/reconciliationService";

const MODES: { id: RangeMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
];
const AS_OF: ReportId[] = ["balance-sheet", "trial-balance", "ar-aging", "ap-aging"];
const CHECK_MARK: Record<ReportCheck["status"], string> = { pass: "✓", fail: "✗", unavailable: "?" };

function Cell({ value }: { value: number | null | undefined }) {
  if (value === undefined) return <span />;
  if (value === null) return <span className="report-unavailable" title="This figure is not available">Unavailable</span>;
  return <span className={value < 0 ? "report-negative" : undefined}>{formatCents(value)}</span>;
}

function Table({ table }: { table: ReportTable }) {
  const isHeading = (row: ReportRow) => row.style === "heading";
  return (
    <div className="report-table" role="table" aria-label={table.title} style={{ ["--report-columns" as string]: table.columns.length }}>
      <div className="report-table-row heading" role="row">
        <span role="columnheader">Account</span>
        {table.columns.map((column) => <span role="columnheader" key={column.key}>{column.label}</span>)}
      </div>
      {table.rows.map((row) => (
        <div className={`report-table-row ${row.style}`} role="row" key={row.key} style={{ ["--report-level" as string]: row.level }} data-testid={`row-${row.key}`}>
          <span role="cell" className="report-label">{row.label}</span>
          {table.columns.map((column, index) => (isHeading(row) ? <span key={column.key} /> : <span role="cell" key={column.key}><Cell value={row.cells[index]} /></span>))}
        </div>
      ))}
    </div>
  );
}

function Checks({ checks, sourceNote }: { checks: ReportCheck[]; sourceNote: string }) {
  const failed = checks.filter((check) => check.status === "fail");
  const unavailable = checks.filter((check) => check.status === "unavailable");
  const verified = failed.length === 0 && unavailable.length === 0;
  return (
    <section className={`report-checks ${failed.length > 0 ? "fail" : verified ? "pass" : "unavailable"}`} data-testid="report-checks">
      <strong>
        {failed.length > 0 ? `Not verified: ${failed.length} check${failed.length === 1 ? "" : "s"} failed` : unavailable.length > 0 ? `Partly verified: ${unavailable.length} check${unavailable.length === 1 ? " is" : "s are"} unavailable` : "Calculations verified — accounting review still required"}
      </strong>
      {verified && <p className="muted">Arithmetic verified: all {checks.length} checks passed. This confirms the report is mathematically consistent, not that the transactions behind it are correct or complete.</p>}
      <p className="muted">{sourceNote} These checks test only that the report adds up. They do not prove that the books are right.</p>
      <ul className="report-check-list">
        {checks.map((check) => (
          <li key={check.id} className={check.status}>
            <span aria-hidden="true">{CHECK_MARK[check.status]}</span> <strong>{check.label}.</strong> {check.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfitLossSummary({ table, absentMeansZero, compared }: { table: ReportTable; absentMeansZero: boolean; compared: boolean }) {
  const metrics = plSummary(table, absentMeansZero);
  const show = (value: number | null | undefined) => (value === null || value === undefined ? <span className="report-unavailable" title="This figure is not available">Not available</span> : <span className={value < 0 ? "report-negative" : undefined}>{formatCents(value)}</span>);
  return (
    <section className="pl-summary" aria-label="Profit and Loss summary" data-testid="pl-summary">
      {metrics.map((metric) => {
        const [now, then, change] = metric.cells;
        const percent = compared ? percentChange(now ?? null, then ?? null) : null;
        return (
          <div className={`pl-summary-card ${metric.id === "net-income" ? "primary" : ""}`} key={metric.id} data-testid={`pl-summary-${metric.id}`}>
            <span className="pl-summary-label">{metric.label}</span>
            <strong className="pl-summary-value">{show(now)}</strong>
            {compared && (
              <dl className="pl-summary-compare">
                <div><dt>Previous period</dt><dd data-testid={`pl-previous-${metric.id}`}>{show(then)}</dd></div>
                <div><dt>Change</dt><dd data-testid={`pl-change-${metric.id}`}>{show(change)}</dd></div>
                <div><dt>% change</dt><dd data-testid={`pl-percent-${metric.id}`}>{percent === null ? <span className="report-unavailable" title="A percentage is only shown when the previous figure is above zero">Not available</span> : formatPercent(percent)}</dd></div>
              </dl>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function Reports({
  source,
  clientId,
  clientName,
  period,
  today,
  quickBooksAccounts,
  sourceSwitch,
  onPeriodChange,
  onOpenReconcile,
  homeSignal,
  ledger,
  accountantTools,
  needsClient = false,
  clientChoices = [],
  onSelectClient,
}: {
  source: Source;
  clientId: string;
  clientName: string;
  period: Period;
  today: string;
  quickBooksAccounts: LedgerAccount[];
  sourceSwitch: ReactNode;
  onPeriodChange: (period: Period) => void;
  onOpenReconcile: () => void;
  /** Changes when the user clicks Reports in the sidebar while already here. */
  homeSignal?: number;
  /** Demo data only: the base demo books plus manually entered transactions. */
  ledger?: DemoLedger;
  accountantTools?: ReactNode;
  /** Demo "All clients": every report belongs to exactly one company, so one must be chosen first. */
  needsClient?: boolean;
  clientChoices?: { id: string; name: string }[];
  onSelectClient?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<ReportId | null>(null);
  useEffect(() => {
    if (homeSignal) setSelected(null);
  }, [homeSignal]);
  const [mode, setMode] = useState<RangeMode>("month");
  const [compare, setCompare] = useState(false);
  const [report, setReport] = useState<Loaded<ReportTable> | null>(null);
  const [comparison, setComparison] = useState<Loaded<ReportTable> | null>(null);
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const range = rangeFor(period, mode);
  const previous = previousRangeFor(period, mode);
  const key = periodKey(period);

  useEffect(() => {
    if (!selected || needsClient) return;
    let cancelled = false;
    setLoading(true);
    setReport(null);
    setComparison(null);
    const load = async () => {
      const [main, other] = await Promise.all([loadReport(source, selected, range, ledger), compare ? loadComparison(source, selected, range, previous, ledger) : Promise.resolve(null)]);
      const found: string[] = [];
      const wanted = source === "demo" ? (ledger?.reconAccounts ?? (clientId === DEMO_CLIENT_ID ? DEMO_RECONCILIATION_ACCOUNTS : [])).map((account) => ({ id: account.id, name: account.name, kind: account.kind })) : quickBooksAccounts.filter((account) => account.active && account.quickBooksId && (account.accountType === "Bank" || account.accountType === "Credit Card")).map((account) => ({ id: account.quickBooksId!, name: account.name, kind: account.accountType === "Bank" ? ("bank" as const) : ("credit_card" as const) }));
      if (main.ok && wanted.length > 0) {
        try {
          const saved = await reconciliationService.list(source, clientId);
          const facts = reconFactsFor(wanted, saved.records, key);
          const open = facts.filter((fact) => !(fact.record?.status === "completed" && (fact.record.differenceCents ?? 0) === 0));
          if (open.length > 0) found.push(`Unreconciled accounts at ${range.end}: ${open.map((fact) => fact.name).join(", ")}. Figures that depend on these balances may change when they are reconciled.`);
        } catch {
          found.push("Saved reconciliations could not be loaded, so it is unknown whether the bank and card accounts are reconciled.");
        }
      }
      if (source === "quickbooks") {
        try {
          const completeness = await quickBooksService.getListCompleteness();
          const incomplete = [completeness.transactions, completeness.invoices, completeness.bills, completeness.accounts].filter((item) => !item.complete);
          if (incomplete.length > 0) found.push(`Incomplete synchronization: ${incomplete.flatMap((item) => item.reasons).join(" ")} The report itself comes from QuickBooks, but other pages and checks may not show every record.`);
        } catch (error) {
          found.push(`It could not be confirmed that every QuickBooks record is loaded: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      if (cancelled) return;
      setReport(main);
      setComparison(other);
      setWarnings(found);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, source, clientId, key, mode, compare, quickBooksAccounts, ledger]);

  const sourceLabel = source === "demo" ? "Demo data" : "QuickBooks Sandbox (read only)";
  const header = (
    <section className="welcome-row">
      <div>
        <h2>Reports</h2>
        <p className="muted">Financial reports for {needsClient ? "one company at a time" : clientName}. Every figure is calculated from {source === "demo" ? "the demo books" : "QuickBooks"}, never typed in.</p>
        <p className="reports-scope" data-testid="reports-scope">
          <span>Client: <strong>{needsClient ? "None selected (All clients)" : clientName}</strong></span>
          <span>Period: <strong>{monthLabel(period)}</strong></span>
          <span>Data source: <strong>{sourceLabel}</strong></span>
        </p>
      </div>
      <PeriodPicker period={period} today={today} onChange={onPeriodChange} />
    </section>
  );

  if (needsClient) {
    return (
      <div className="page-content">
        {header}
        {sourceSwitch}
        <section className="panel reports-client-gate" data-testid="reports-client-gate">
          <h3>Choose a client to open reports</h3>
          <p className="muted">All clients is selected. Each financial report covers a single company, and LedgerOps does not combine companies' books into one report. Pick a company to continue.</p>
          <div className="reset-actions">
            {clientChoices.map((choice) => (
              <button key={choice.id} type="button" className="secondary-button" onClick={() => onSelectClient?.(choice.id)}>Open reports for {choice.name}</button>
            ))}
          </div>
        </section>
        <div className="report-card-grid" aria-label="Financial reports (choose a client first)">
          {REPORT_IDS.map((id) => (
            <button className="report-card" key={id} disabled data-testid={`open-${id}`}>
              <span className="report-icon">▥</span>
              <span className="report-card-copy">
                <strong>{REPORT_TITLES[id]}</strong>
                <small>{AS_OF.includes(id) ? `As of ${monthLabel(period)} end` : monthLabel(period)} · {sourceLabel}</small>
                <span>{REPORT_DESCRIPTIONS[id]}</span>
              </span>
              <span className="report-open">Choose a client first</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // One persistent slot keeps the journal/workpaper drafts alive while a report is open.
  const toolsSlot = <div className="page-content reports-tools" hidden={selected !== null}>{accountantTools}</div>;

  if (!selected) {
    return (
      <>
      <div className="page-content" style={{ paddingBottom: 0 }}>
        {header}
        {sourceSwitch}
        <div className="report-card-grid">
          {REPORT_IDS.map((id) => (
            <button className="report-card" key={id} onClick={() => setSelected(id)} data-testid={`open-${id}`}>
              <span className="report-icon">▥</span>
              <span className="report-card-copy">
                <strong>{REPORT_TITLES[id]}</strong>
                <small>{AS_OF.includes(id) ? `As of ${monthLabel(period)} end` : monthLabel(period)} · {sourceLabel}</small>
                <span>{REPORT_DESCRIPTIONS[id]}</span>
              </span>
              <span className="report-open">Open report →</span>
            </button>
          ))}
        </div>
      </div>
      {toolsSlot}
      </>
    );
  }

  const asOf = AS_OF.includes(selected);
  const shown = compare && comparison?.ok ? comparison.value : report?.ok ? report.value : null;
  const notFinal = warnings.length > 0 || (shown?.checks.some((check) => check.status !== "pass") ?? false);
  const basis = report?.ok ? report.value.meta?.basis : undefined;
  return (
    <>
    <div className="page-content report-detail-page">
      <div className="report-detail-toolbar">
        <button className="back-button" onClick={() => setSelected(null)}>← All reports</button>
        <span className="read-only-label">{sourceLabel}</span>
        <button className="secondary-button print-button" onClick={() => window.print()} disabled={!shown}>Print report <span>⎙</span></button>
      </div>
      <div className="report-controls">
        <PeriodPicker period={period} today={today} onChange={onPeriodChange} />
        {!asOf && (
          <div className="period-selector" role="group" aria-label="Report range">
            {MODES.map((option) => <button key={option.id} className={mode === option.id ? "active" : ""} onClick={() => setMode(option.id)}>{option.label}</button>)}
          </div>
        )}
        {selected !== "general-ledger" && (
          <label className="recon-check">
            <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} /> Compare with the previous period ({asOf ? previous.end : previous.label})
          </label>
        )}
      </div>
      <section className="print-header print-only" data-testid="print-header" aria-hidden="true">
        <strong>{clientName}</strong>
        <span>{REPORT_TITLES[selected]} · {asOf ? `As of ${range.end}` : `${range.label} (${range.start} to ${range.end})`}</span>
        <span>Accounting basis: {basis ?? "Not stated by the data source"} · Source: {sourceLabel}</span>
        <span>Report generated {today}{notFinal && shown ? " · DRAFT — not final" : ""}</span>
      </section>
      <section className="report-detail-heading">
        <div>
          <p className="eyebrow">{clientName.toUpperCase()}</p>
          <h2>{REPORT_TITLES[selected]}</h2>
          <dl className="report-facts" data-testid="report-facts">
            <div><dt>Period</dt><dd>{asOf ? `As of ${range.end}` : `${range.label} (${range.start} to ${range.end})`}</dd></div>
            <div><dt>Data source</dt><dd>{sourceLabel}</dd></div>
            <div><dt>Basis</dt><dd>{basis ?? "Not stated by the data source"}</dd></div>
            {report?.ok && report.value.meta?.generatedAt && <div><dt>Generated by QuickBooks</dt><dd>{report.value.meta.generatedAt}</dd></div>}
          </dl>
        </div>
      </section>
      {loading && <div className="data-state-message">Loading {REPORT_TITLES[selected]}...</div>}
      {report && !report.ok && (
        <div className="data-state-message error" role="alert" data-testid="report-unavailable">
          <strong>{REPORT_TITLES[selected]} is not available.</strong> {report.reason} No figures are shown rather than guessing them.
        </div>
      )}
      {compare && comparison && !comparison.ok && report?.ok && (
        <div className="data-state-message" role="status" data-testid="comparison-unavailable">Previous-period comparison: Not available. No comparison is shown. {comparison.reason}</div>
      )}
      {warnings.length > 0 && (
        <ul className="report-warnings" data-testid="report-warnings">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          {warnings.some((warning) => warning.startsWith("Unreconciled")) && <li className="no-print"><button className="text-button" onClick={onOpenReconcile}>Open Reconcile for {clientName} →</button></li>}
        </ul>
      )}
      {shown && notFinal && (
        <div className="report-draft-banner" role="status" data-testid="report-draft-banner">
          <strong>Draft — not final.</strong> {warnings.length > 0 ? "Required reviews are incomplete (see the warnings above), so these figures may still change." : "Not every check passed, so these figures should not be relied on yet."}
        </div>
      )}
      {shown && (
        <>
          {selected === "profit-loss" && <ProfitLossSummary table={shown} absentMeansZero={source === "demo"} compared={compare && comparison?.ok === true} />}
          <Checks checks={shown.checks} sourceNote={source === "demo" ? "Calculated from the demo books." : "The figures are QuickBooks' own; LedgerOps re-adds them."} />
          <div className="report-paper"><Table table={shown} /></div>
        </>
      )}
    </div>
    {toolsSlot}
    </>
  );
}
