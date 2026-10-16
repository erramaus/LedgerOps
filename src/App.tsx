import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { demoDataService } from "./services/demoDataService";
import type {
  Bill,
  Client,
  ClientDocument,
  ClientRequest,
  ClientRequestStatus,
  ClientRequestType,
  Invoice,
  LedgerAccount,
  LedgerBill,
  LedgerInvoice,
  LedgerTransaction,
  ReconciliationAccount,
  ReconciliationTransaction,
  Transaction,
} from "./services/bookkeepingTypes";
import {
  quickBooksService,
  type QuickBooksCompany,
  type QuickBooksStatus,
} from "./services/quickBooksService";
import type { AuthUser } from "./services/authService";
import {
  QUICKBOOKS_CLIENT_ID,
  buildReviewTasks,
  buildWorkTasks,
  countByClient,
  filterTasks,
  isReviewTask,
  scopeRequests,
  sortTasks,
  summarizeTasks,
  taskPriorities,
  taskStatuses,
  taskTypes,
  type ClientRecords,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  type WorkTask,
} from "./services/workQueue";
import {
  DEMO_CATEGORIES,
  adjacentInQueue,
  applyLineChanges,
  categoriesIn,
  categoryLabel,
  filterTransactions,
  getLines,
  isExpenseCategoryAccount,
  isUncategorized,
  matchesReviewFilter,
  reviewFilters,
  validateLineChanges,
  type LineChange,
  type ReviewFilter,
} from "./services/transactionReview";
import { suggestCategories } from "./services/categorySuggestions";
import { bestRuleMatch, previewRule, seededRulesFor, validateRuleInput, type AutomationRule } from "./services/automationRules";
import { appendUniqueEvent, readEvents, readRecurringDecisions, readRules, writeEvents, writeRecurringDecisions, writeRules, type AutomationAuditEvent, type RecurringDecision } from "./services/automationStore";
import { buildAutomationTasks } from "./services/automationReminders";
import { demoRecurringHistory } from "./services/automationDemoData";
import { historyFromTransactions, recurringFromHistory, type RecurringPattern } from "./services/recurringTransactions";
import {
  addDays,
  appendMessage,
  applyReceiptMatch,
  createSubmittedDocument,
  demoAuditEvent,
  draftClientMessageRequest,
  draftRequest,
  fixturesForRequest,
  normalizeDisplayDate,
  normalizeRequest,
  openRequest,
  pendingDocumentCount,
  receiptMatchCandidates,
  receiptReadyForMatch,
  relevantTransactionStatus,
  requestDocumentIds,
  requestHasResponse,
  requestMatchesClient,
  seededDocumentsFor,
  statusLabel,
  type PortalAuditEvent,
} from "./services/clientPortal";
import { ReconcileWorkspace, type ReconAccount } from "./Reconciliation";
import { AccountantTools } from "./AccountantTools";
import { demoReconSources } from "./data/demoReconciliation";
import { DEMO_RECONCILIATION_ACCOUNTS, demoEarlierRegister } from "../shared/demoBooks";
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from "../shared/demoCompanyBooks";
import { additionRegister, mergedLedger, type DemoEntryRecord } from "../shared/demoEntries";
import { journalAccounts, mergeDemoJournals, type DemoJournalEntryInput, type DemoJournalRecord } from "../shared/demoJournalEntries";
import { activePaymentCents, mergeDemoPayments, paymentRegister, type DemoPaymentBook, type DemoPaymentInput, type DocumentPaymentKind } from "../shared/demoPayments";
import { demoClientFigures } from "../shared/demoMonthEnd";
import { DEMO_RESET_CLIENTS } from "../shared/demoReset";
import { formatCents } from "../shared/reconciliation";
import { type DemoWorkpaperInput, type DemoWorkpaperRecord } from "../shared/demoWorkpapers";
import { demoEntryService, entryTransactions } from "./services/demoEntryService";
import { demoJournalService } from "./services/demoJournalService";
import { billsWithPayments, bookForDocument, demoPaymentService, invoicesWithPayments, paymentTransactions } from "./services/demoPaymentService";
import { demoResetService } from "./services/demoResetService";
import { demoWorkpaperService } from "./services/demoWorkpaperService";
import type { EntryTools } from "./MissingTransaction";
import { DocumentPaymentActions } from "./DocumentPaymentActions";
import { companyBills, companyClient, companyInvoices, companyLedgerRegister, companyReconciliationAccounts, companyReconSources, companyRequests, companyTransactions } from "./services/demoCompanyData";
import { MonthEnd } from "./MonthEnd";
import { PeriodPicker } from "./PeriodPicker";
import { Reports } from "./Reports";
import { useMonthEnd } from "./useMonthEnd";
import { toMonthEndItems } from "./services/monthEndData";
import { summarizeOpenItems } from "./services/openItems";
import { completionPercent, type StepView } from "../shared/monthEnd";
import { lastCompleteMonth, periodEnd, type Period } from "../shared/period";

// The demo books run from May to August 2026; August is the month the live demo transactions belong to.
const DEMO_DEFAULT_PERIOD: Period = { year: 2026, month: 8 };

const {
  bills: demoBills,
  clients: baseClients,
  clientRequests,
  demoClient,
  invoices: demoInvoices,
  transactions: demoTransactions,
  navigationItems,
  reconciliationAccounts,
} = demoDataService;

type View =
  | "Dashboard"
  | "Clients"
  | "Inbox"
  | "Bookkeeping Review"
  | "Transactions"
  | "Reconcile"
  | "Receivables"
  | "Payables"
  | "Reports"
  | "Month End"
  | "Client Requests"
  | "Settings";
type TransactionSource = "demo" | "quickbooks";
type AccountSource = "demo" | "quickbooks";
type ReviewSource = "demo" | "quickbooks";
type QuickBooksReviewData = { transactions: LedgerTransaction[]; accounts: LedgerAccount[]; invoices: LedgerInvoice[]; bills: LedgerBill[] };

const seededBaseRequests = clientRequests.map(normalizeRequest);

function companyPortalRequests(company: NonNullable<ReturnType<typeof getAdditionalDemoCompany>>) {
  return companyRequests(company).map((request) =>
    normalizeRequest({
      ...request,
      requestType: request.question.toLowerCase().includes("statement") ? "Statement Request" : "Transaction Question",
      dueDate: addDays(normalizeDisplayDate(request.dateCreated), 4),
      priority: request.question.toLowerCase().includes("statement") ? "High" : "Medium",
      messages: [
        {
          id: `${request.id}-msg-1`,
          sender: "Bookkeeper",
          senderLabel: "LedgerOps Bookkeeper",
          sentAt: `${normalizeDisplayDate(request.dateCreated)}T09:00:00.000Z`,
          message: request.question,
        },
      ],
    }),
  );
}

function clientDocumentsFor(clientId: string, clientName: string) {
  return seededDocumentsFor(clientId, clientName);
}

// Only one demo client has individual records; these pages cannot show anything for the others.
const detailViews: View[] = ["Transactions", "Reconcile", "Receivables", "Payables", "Reports", "Month End", "Client Requests"];
const scopeViews: View[] = ["Dashboard", "Clients", "Inbox", "Bookkeeping Review"];
const NOT_AVAILABLE = "Not available";

const ClientNameContext = createContext("");
function ClientName({ upper }: { upper?: boolean }) {
  const name = useContext(ClientNameContext);
  return <>{upper ? name.toUpperCase() : name}</>;
}

type AuditLogEntry = {
  timestamp: string;
  quickBooksId: string;
  transactionType: string;
  oldCategory: string;
  newCategory: string;
  result: "Success" | "Failed";
};

type MonthEndCompletion = {
  client: string;
  month: string;
  dateCompleted: string;
  checklistStatus: string;
  completedBy: string;
};

function App({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [view, setView] = useState<View>("Dashboard");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [ownTransactions, setTransactions] =
    useState<Transaction[]>(demoTransactions);
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [period, setPeriod] = useState<Period>(DEMO_DEFAULT_PERIOD);
  // Bumped when the user clicks the sidebar item for the page they are already on, meaning "take me back to the start".
  const [homeSignal, setHomeSignal] = useState(0);
  const [requests, setRequests] = useState<ClientRequest[]>([
    ...seededBaseRequests,
    ...baseClients
      .filter((client) => client.id !== demoClient.id)
      .flatMap((client) => {
        const company = getAdditionalDemoCompany(client.id);
        return company ? companyPortalRequests(company) : [];
      }),
  ]);
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(
    null,
  );
  const [documents, setDocuments] = useState<ClientDocument[]>([
    ...clientDocumentsFor(demoClient.id, demoClient.name),
    ...baseClients.filter((client) => client.id !== demoClient.id).flatMap((client) => clientDocumentsFor(client.id, client.name)),
  ]);
  const [portalAudit, setPortalAudit] = useState<PortalAuditEvent[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [transactionSource, setTransactionSource] =
    useState<TransactionSource>("demo");
  const [quickBooksTransactions, setQuickBooksTransactions] = useState<
    LedgerTransaction[]
  >([]);
  const [quickBooksTransactionsLoading, setQuickBooksTransactionsLoading] =
    useState(false);
  const [quickBooksTransactionsError, setQuickBooksTransactionsError] =
    useState<string | null>(null);
  const [quickBooksStatus, setQuickBooksStatus] = useState<QuickBooksStatus>({
    connected: false,
    environment: "sandbox",
  });
  const [quickBooksCompany, setQuickBooksCompany] =
    useState<QuickBooksCompany | null>(null);
  const [accountSource, setAccountSource] = useState<AccountSource>("demo");
  const [quickBooksAccounts, setQuickBooksAccounts] = useState<LedgerAccount[]>(
    [],
  );
  const [quickBooksAccountsLoading, setQuickBooksAccountsLoading] =
    useState(false);
  const [quickBooksAccountsError, setQuickBooksAccountsError] = useState<
    string | null
  >(null);
  const [receivablesSource, setReceivablesSource] =
    useState<AccountSource>("demo");
  const [payablesSource, setPayablesSource] = useState<AccountSource>("demo");
  const [quickBooksInvoices, setQuickBooksInvoices] = useState<LedgerInvoice[]>(
    [],
  );
  const [quickBooksBills, setQuickBooksBills] = useState<LedgerBill[]>([]);
  const [quickBooksReceivablesLoading, setQuickBooksReceivablesLoading] =
    useState<boolean>(false);
  const [quickBooksPayablesLoading, setQuickBooksPayablesLoading] =
    useState(false);
  const [quickBooksReceivablesError, setQuickBooksReceivablesError] = useState<
    string | null
  >(null);
  const [quickBooksPayablesError, setQuickBooksPayablesError] = useState<
    string | null
  >(null);
  const [reviewSource, setReviewSource] = useState<ReviewSource>("demo");
  const [reviewData, setReviewData] = useState<{ transactions: LedgerTransaction[]; accounts: LedgerAccount[]; invoices: LedgerInvoice[]; bills: LedgerBill[] } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [appDataSource, setAppDataSource] = useState<AccountSource>("demo");
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>(() => readRules());
  const [automationEvents, setAutomationEvents] = useState<AutomationAuditEvent[]>(() => readEvents());
  const [recurringDecisions, setRecurringDecisions] = useState<RecurringDecision[]>(() => readRecurringDecisions());
  const [selectedRecurring, setSelectedRecurring] = useState<RecurringPattern | null>(null);
  const [demoResetRevision, setDemoResetRevision] = useState(0);
  const resetDemoState = (clientIds: string[]) => {
    const targets = new Set(clientIds);
    if (targets.has(demoClient.id)) setTransactions(demoTransactions);
    setRequests((current) => [
      ...current.filter((request) => !request.clientId || !targets.has(request.clientId)),
      ...seededBaseRequests.filter((request) => request.clientId && targets.has(request.clientId)),
      ...clientIds.filter((clientId) => clientId !== demoClient.id).flatMap((clientId) => {
        const company = getAdditionalDemoCompany(clientId);
        return company ? companyPortalRequests(company) : [];
      }),
    ]);
    setDocuments((current) => [
      ...current.filter((document) => !targets.has(document.clientId)),
      ...clientIds.flatMap((clientId) => {
        const client = baseClients.find((item) => item.id === clientId);
        return client ? clientDocumentsFor(client.id, client.name) : [];
      }),
    ]);
    setPortalAudit((current) => current.filter((event) => !targets.has(event.clientId)));
    setSelectedTransaction(null);
    setSelectedInvoice(null);
    setSelectedBill(null);
    setSelectedRequest(null);
    setDemoResetRevision((revision) => revision + 1);
  };
  useEffect(() => {
    const receiveReset = (event: StorageEvent) => {
      if (event.key !== "ledgerops-demo-reset" || !event.newValue) return;
      try {
        const clientIds = JSON.parse(event.newValue) as unknown;
        if (Array.isArray(clientIds) && clientIds.every((id) => typeof id === "string")) resetDemoState(clientIds);
      } catch {
        return;
      }
    };
    window.addEventListener("storage", receiveReset);
    return () => window.removeEventListener("storage", receiveReset);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentDate(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    quickBooksService.getStatus().then(setQuickBooksStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    writeRules(automationRules);
  }, [automationRules]);

  useEffect(() => {
    writeEvents(automationEvents);
  }, [automationEvents]);

  useEffect(() => {
    writeRecurringDecisions(recurringDecisions);
  }, [recurringDecisions]);

  // Transactions entered by hand in Demo Mode. The ref always holds the latest list so a reload right after a save sees it.
  const [demoEntries, setDemoEntries] = useState<DemoEntryRecord[]>([]);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const entriesRef = useRef<DemoEntryRecord[]>([]);
  const entryLoadGeneration = useRef(0);
  const applyEntries = (next: DemoEntryRecord[]) => {
    entryLoadGeneration.current += 1;
    entriesRef.current = next;
    setDemoEntries(next);
  };
  useEffect(() => {
    const generation = ++entryLoadGeneration.current;
    const clientId = selectedClient?.id ?? demoClient.id;
    entriesRef.current = [];
    setDemoEntries([]);
    demoEntryService.list(clientId).then((records) => { if (generation === entryLoadGeneration.current) { entriesRef.current = records; setDemoEntries(records); setEntriesError(null); } }, (error: unknown) => { if (generation === entryLoadGeneration.current) setEntriesError(error instanceof Error ? error.message : "Unknown error."); });
  }, [selectedClient?.id, demoResetRevision]);
  const [journalRecords, setJournalRecords] = useState<DemoJournalRecord[]>([]);
  const journalsRef = useRef<DemoJournalRecord[]>([]);
  const journalLoadGeneration = useRef(0);
  useEffect(() => {
    const generation = ++journalLoadGeneration.current;
    const clientId = selectedClient?.id ?? demoClient.id;
    journalsRef.current = [];
    setJournalRecords([]);
    demoJournalService.list(clientId).then((records) => {
      if (generation === journalLoadGeneration.current) {
        journalsRef.current = records;
        setJournalRecords(records);
      }
    }, () => undefined);
  }, [selectedClient?.id, demoResetRevision]);
  const [paymentBooks, setPaymentBooks] = useState<DemoPaymentBook[]>([]);
  const paymentBooksRef = useRef<DemoPaymentBook[]>([]);
  const paymentLoadGeneration = useRef(0);
  useEffect(() => {
    const generation = ++paymentLoadGeneration.current;
    const clientId = selectedClient?.id ?? demoClient.id;
    paymentBooksRef.current = [];
    setPaymentBooks([]);
    demoPaymentService.list(clientId).then((books) => { if (generation === paymentLoadGeneration.current) { paymentBooksRef.current = books; setPaymentBooks(books); } }, () => undefined);
  }, [selectedClient?.id, demoResetRevision]);
  const [workpapers, setWorkpapers] = useState<DemoWorkpaperRecord[]>([]);
  const workpapersRef = useRef<DemoWorkpaperRecord[]>([]);
  const workpaperLoadGeneration = useRef(0);
  useEffect(() => {
    const generation = ++workpaperLoadGeneration.current;
    const clientId = selectedClient?.id ?? demoClient.id;
    workpapersRef.current = [];
    setWorkpapers([]);
    demoWorkpaperService.list(clientId).then((records) => {
      if (generation === workpaperLoadGeneration.current) {
        workpapersRef.current = records;
        setWorkpapers(records);
      }
    }, () => undefined);
  }, [selectedClient?.id, demoResetRevision]);
  const activeDemoCompany = selectedClient ? getAdditionalDemoCompany(selectedClient.id) : undefined;
  const activeDemoClient = activeDemoCompany ? companyClient(activeDemoCompany) : selectedClient?.id === demoClient.id ? demoClient : null;
  const activeDemoClientId = activeDemoCompany?.clientId ?? demoClient.id;
  const baseLedger = activeDemoCompany?.ledger;
  const mergedEntries = useMemo(() => mergedLedger(demoEntries, baseLedger ?? undefined, activeDemoClientId), [demoEntries, baseLedger, activeDemoClientId]);
  const journalLedger = useMemo(() => mergeDemoJournals(journalRecords, mergedEntries, activeDemoClientId), [journalRecords, mergedEntries, activeDemoClientId]);
  const ledger = useMemo(() => mergeDemoPayments(paymentBooks, journalLedger, activeDemoClientId), [paymentBooks, journalLedger, activeDemoClientId]);
  const invoices = useMemo(() => activeDemoCompany ? companyInvoices(activeDemoCompany, paymentBooks) : invoicesWithPayments(demoInvoices, paymentBooks), [activeDemoCompany, paymentBooks]);
  const bills = useMemo(() => activeDemoCompany ? companyBills(activeDemoCompany, paymentBooks) : billsWithPayments(demoBills, paymentBooks), [activeDemoCompany, paymentBooks]);
  const rawTransactions = useMemo(() => activeDemoCompany
    ? [...companyTransactions(activeDemoCompany), ...entryTransactions(demoEntries, activeDemoClientId), ...paymentTransactions(paymentBooks, activeDemoClientId)]
    : [...ownTransactions, ...entryTransactions(demoEntries), ...paymentTransactions(paymentBooks)],
    [activeDemoCompany, activeDemoClientId, ownTransactions, demoEntries, paymentBooks]);
  // Dashboard figures for all five companies are derived from their own ledgers; ABC keeps its original scenario ledger.
  const clients = useMemo(() => {
    return baseClients.map((client) => {
      if (client.id === demoClient.id) {
        const figures = demoClientFigures({ year: 2026, month: 8 }, mergeDemoPayments(paymentBooks, mergeDemoJournals(journalRecords.filter((record) => record.clientId === demoClient.id), mergedLedger(demoEntries), demoClient.id), demoClient.id));
        return { ...client, income: formatCents(figures.incomeCents), expenses: formatCents(figures.expensesCents), profit: formatCents(figures.profitCents), bankBalance: formatCents(figures.bankBalanceCents), accountsReceivable: formatCents(figures.receivableCents), accountsPayable: formatCents(figures.payableCents) };
      }
      const company = getAdditionalDemoCompany(client.id);
      if (!company) return client;
      const companyPaymentBooks = paymentBooks.filter((book) => book.clientId === company.clientId);
      const companyJournals = journalRecords.filter((record) => record.clientId === company.clientId);
      const figures = demoClientFigures({ year: 2026, month: 8 }, mergeDemoPayments(companyPaymentBooks, mergeDemoJournals(companyJournals, mergedLedger(demoEntries.filter((record) => record.clientId === company.clientId), company.ledger, company.clientId), company.clientId), company.clientId));
      return { ...client, income: formatCents(figures.incomeCents), expenses: formatCents(figures.expensesCents), profit: formatCents(figures.profitCents), bankBalance: formatCents(figures.bankBalanceCents), accountsReceivable: formatCents(figures.receivableCents), accountsPayable: formatCents(figures.payableCents) };
    });
  }, [baseClients, demoEntries, journalRecords, paymentBooks]);
  // The books-versus-statement figures behind the work queue include manual entries, so a fixed difference stops being a task.
  const reconciliationAccountsNow = useMemo(
    () => activeDemoCompany ? companyReconciliationAccounts(activeDemoCompany).map((account) => {
      const ledgerId = activeDemoCompany.reconciliationAccounts.find((item) => item.id === account.id)?.ledgerId;
      const rows = ledgerId ? [...additionRegister(demoEntries, ledgerId, activeDemoClientId), ...(ledgerId === "checking" ? paymentRegister(paymentBooks, "checking", activeDemoClientId) : [])] : [];
      const delta = rows.reduce((total, row) => total + (row.direction === "increase" ? row.amountCents : -row.amountCents), 0);
      if (!delta) return account;
      const quickBooksBalance = Math.round(account.quickBooksBalance * 100 + delta) / 100;
      return { ...account, quickBooksBalance, status: Math.round(quickBooksBalance * 100) === Math.round(account.statementBalance * 100) ? "Ready to complete" : "Difference to resolve" };
    }) : reconciliationAccounts.map((account) => {
      const ledgerId = DEMO_RECONCILIATION_ACCOUNTS.find((item) => item.id === account.id)?.ledgerId as "checking" | "card" | undefined;
      const rows = ledgerId ? [...additionRegister(demoEntries, ledgerId), ...(ledgerId === "checking" ? paymentRegister(paymentBooks, "checking") : [])] : [];
      const delta = rows.reduce((total, row) => total + (row.direction === "increase" ? row.amountCents : -row.amountCents), 0);
      if (delta === 0) return account;
      const quickBooksBalance = Math.round(account.quickBooksBalance * 100 + delta) / 100;
      return { ...account, quickBooksBalance, status: Math.round(quickBooksBalance * 100) === Math.round(account.statementBalance * 100) ? "Ready to complete" : "Difference to resolve" };
    }),
    [activeDemoCompany, activeDemoClientId, demoEntries, paymentBooks],
  );

  const sandboxName = quickBooksCompany?.CompanyName || "QuickBooks Sandbox company";
  const todayLabel = () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const automationSource = appDataSource === "quickbooks" ? "quickbooks" : "demo";
  const automationClientId = automationSource === "demo" ? activeDemoClientId : QUICKBOOKS_CLIENT_ID;
  const automationClientName = automationSource === "demo" ? (activeDemoClient?.name ?? demoClient.name) : sandboxName;
  const scopedRules = automationRules.filter((rule) => rule.source === automationSource && rule.clientId === automationClientId);
  const scopedAutomationEvents = automationEvents.filter((event) => event.source === automationSource && event.clientId === automationClientId);
  const scopedRecurringDecisions = recurringDecisions.filter((decision) => decision.source === automationSource && decision.clientId === automationClientId);

  useEffect(() => {
    if (scopedRules.length > 0) return;
    const seeded = seededRulesFor(automationSource, automationClientId);
    if (seeded.length === 0) return;
    setAutomationRules((current) => current.some((rule) => rule.source === automationSource && rule.clientId === automationClientId) ? current : [...current, ...seeded]);
  }, [automationClientId, automationSource, scopedRules.length]);

  const logAutomation = useCallback((event: Omit<AutomationAuditEvent, "id" | "at" | "source" | "clientId">) => {
    const saved = appendUniqueEvent({
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      source: automationSource,
      clientId: automationClientId,
    });
    setAutomationEvents(saved);
  }, [automationClientId, automationSource]);
  const logPortal = useCallback((event: Omit<PortalAuditEvent, "id">) => {
    setPortalAudit((current) => [demoAuditEvent(event), ...current].slice(0, 200));
  }, []);

  const saveRequest = useCallback((nextRequest: ClientRequest) => {
    const normalized = normalizeRequest(nextRequest);
    setRequests((currentRequests) => currentRequests.some((request) => request.id === normalized.id)
      ? currentRequests.map((request) => request.id === normalized.id ? normalized : request)
      : [...currentRequests, normalized]);
    setSelectedRequest(normalized);
  }, []);

  const saveDocument = useCallback((nextDocument: ClientDocument) => {
    setDocuments((current) => current.some((document) => document.id === nextDocument.id)
      ? current.map((document) => document.id === nextDocument.id ? nextDocument : document)
      : [...current, nextDocument]);
  }, []);

  const saveRule = (draft: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "source" | "clientId"> & { id?: string }) => {
    const now = new Date().toISOString();
    setAutomationRules((current) => {
      const nextRule: AutomationRule = {
        source: automationSource,
        clientId: automationClientId,
        id: draft.id ?? `rule-${Date.now()}`,
        createdAt: draft.id ? current.find((rule) => rule.id === draft.id)?.createdAt ?? now : now,
        updatedAt: now,
        ...draft,
      };
      const next = draft.id
        ? current.map((rule) => (rule.id === draft.id ? nextRule : rule))
        : [...current, nextRule];
      return next;
    });
    logAutomation({
      kind: draft.id ? "rule-updated" : "rule-created",
      summary: `${draft.id ? "Updated" : "Created"} rule "${draft.name}".`,
      referenceId: draft.id ?? draft.name,
    });
  };

  const toggleRule = (ruleId: string, enabled: boolean) => {
    setAutomationRules((current) => current.map((rule) => (rule.id === ruleId ? { ...rule, enabled, updatedAt: new Date().toISOString() } : rule)));
    const changed = automationRules.find((rule) => rule.id === ruleId);
    if (changed) {
      logAutomation({
        kind: enabled ? "rule-enabled" : "rule-disabled",
        summary: `${enabled ? "Enabled" : "Disabled"} rule "${changed.name}".`,
        referenceId: ruleId,
      });
    }
  };

  const deleteRule = (ruleId: string) => {
    const doomed = automationRules.find((rule) => rule.id === ruleId);
    setAutomationRules((current) => current.filter((rule) => rule.id !== ruleId));
    if (doomed) logAutomation({ kind: "rule-deleted", summary: `Deleted rule "${doomed.name}".`, referenceId: ruleId });
  };

  const resolveRecurringReminder = (pattern: RecurringPattern, status: "confirmed" | "dismissed") => {
    const decision: RecurringDecision = { reminderId: pattern.id, clientId: pattern.clientId, source: pattern.source, status, at: new Date().toISOString() };
    setRecurringDecisions((current) => [decision, ...current.filter((item) => item.reminderId !== pattern.id)]);
    setSelectedRecurring(null);
    logAutomation({
      kind: status === "confirmed" ? "recurring-confirmed" : "recurring-dismissed",
      summary: `${status === "confirmed" ? "Confirmed" : "Dismissed"} recurring reminder for ${pattern.vendor}.`,
      detail: `${pattern.frequency} · due ${pattern.expectedNextDate}`,
      referenceId: pattern.id,
    });
  };

  // Anything opened for one client must not stay open for another.
  const selectClient = (client: Client | null) => {
    setSelectedClient(client);
    setCompanyOpen(false);
    setSelectedTransaction(null);
    setSelectedInvoice(null);
    setSelectedBill(null);
    setSelectedRequest(null);
    setSelectedRecurring(null);
  };

  const openClient = (client: Client) => {
    selectClient(client);
    setView("Dashboard");
  };

  const openCompany = () => {
    selectClient(null);
    setCompanyOpen(true);
    setView("Dashboard");
  };

  const openTransactions = () => {
    setSelectedTransaction(null);
    setSelectedRecurring(null);
    setView("Transactions");
  };

  const openReconcile = () => {
    setSelectedRecurring(null);
    if (view === "Reconcile") setHomeSignal((count) => count + 1);
    setView("Reconcile");
  };

  const openMonthEnd = () => { setSelectedRecurring(null); setView("Month End"); };

  const openInbox = () => {
    setSelectedRequest(null);
    setSelectedRecurring(null);
    setView("Inbox");
  };

  const openRequests = () => { setSelectedRecurring(null); setView("Client Requests"); };

  const openReceivables = () => {
    setSelectedInvoice(null);
    setSelectedRecurring(null);
    setView("Receivables");
  };
  const openPayables = () => {
    setSelectedBill(null);
    setSelectedRecurring(null);
    setView("Payables");
  };
  const openReports = () => {
    setSelectedRecurring(null);
    if (view === "Reports") setHomeSignal((count) => count + 1);
    setView("Reports");
  };
  const openStepView = (destination: StepView) =>
    destination === "Transactions" ? openTransactions()
      : destination === "Bookkeeping Review" ? setView("Bookkeeping Review")
      : destination === "Reconcile" ? openReconcile()
      : destination === "Receivables" ? openReceivables()
      : destination === "Payables" ? openPayables()
      : destination === "Reports" ? openReports()
      : openRequests();
  const openSettings = () => { setSelectedRecurring(null); setView("Settings"); };

  const changeAppDataSource = async (source: AccountSource) => {
    selectClient(null);
    setAppDataSource(source);
    setPeriod(source === "demo" ? DEMO_DEFAULT_PERIOD : lastCompleteMonth(new Date().toISOString().slice(0, 10)));
    await Promise.all([
      changeTransactionSource(source),
      changeAccountSource(source),
      changeReceivablesSource(source),
      changePayablesSource(source),
      changeReviewSource(source),
    ]);
  };

  const replaceQuickBooksTransaction = (updated: LedgerTransaction) => {
    const swap = (list: LedgerTransaction[]) => list.map((item) => (item.id === updated.id ? updated : item));
    setQuickBooksTransactions(swap);
    setReviewData((current) => (current ? { ...current, transactions: swap(current.transactions) } : current));
    setSelectedTransaction((current) => (current?.id === updated.id ? updated : current));
  };

  const reloadQuickBooksTransactions = async (transaction?: Transaction) => {
    const refreshed = await quickBooksService.getTransactions();
    setQuickBooksTransactions(refreshed);
    setReviewData((current) => (current ? { ...current, transactions: refreshed } : current));
    if (transaction) setSelectedTransaction(refreshed.find((item) => item.id === transaction.id) ?? null);
  };

  // Demo changes only touch local state; QuickBooks changes go through the server's line-level update.
  const applyTransactionChanges = async (transaction: Transaction, changes: LineChange[]): Promise<Transaction> => {
    if (appDataSource === "demo") {
      const updated = applyLineChanges(transaction, changes);
      updateTransaction(updated);
      return updated;
    }
    const quickBooksTransaction = transaction as LedgerTransaction;
    const lines = getLines(transaction);
    const timestamp = new Date().toISOString();
    const entries = changes.map((change) => ({
      timestamp,
      quickBooksId: `${quickBooksTransaction.quickBooksId ?? transaction.id} · line ${change.lineId}`,
      transactionType: quickBooksTransaction.transactionType || "Unknown",
      oldCategory: lines.find((line) => line.id === change.lineId)?.category ?? "Unknown",
      newCategory: change.category,
    }));
    try {
      const check = validateLineChanges(transaction, changes);
      if (!check.ok) throw new Error(check.error);
      if (changes.some((change) => !change.categoryId)) throw new Error("Choose a category from your QuickBooks accounts.");
      const updated = await quickBooksService.updateTransactionLines(
        quickBooksTransaction,
        changes.map((change) => ({ lineId: change.lineId, accountId: change.categoryId! })),
      );
      replaceQuickBooksTransaction(updated);
      setAuditLog((current) => [...entries.map((entry) => ({ ...entry, result: "Success" as const })), ...current]);
      return updated;
    } catch (error) {
      setAuditLog((current) => [...entries.map((entry) => ({ ...entry, result: "Failed" as const })), ...current]);
      throw error;
    }
  };

  const quickBooksCategoryOptions: CategoryOption[] = (quickBooksAccounts.length > 0 ? quickBooksAccounts : reviewData?.accounts ?? [])
    .filter((account) => isExpenseCategoryAccount(account) && !isUncategorized(account.name))
    .map((account) => ({ id: account.quickBooksId, name: account.name }));
  const demoCategoryOptions: CategoryOption[] = [...new Set([...DEMO_CATEGORIES, ...categoriesIn(rawTransactions).filter((name) => !isUncategorized(name) && name !== "Split")])].map((name) => ({ name }));

  const updateTransaction = (updatedTransaction: Transaction) => {
    setTransactions((currentTransactions) =>
      currentTransactions.map((transaction) =>
        transaction.id === updatedTransaction.id
          ? updatedTransaction
          : transaction,
      ),
    );
    setSelectedTransaction(updatedTransaction);
  };

  const createRequest = (transaction: Transaction) => {
    const request = draftRequest({
      client: activeDemoClient?.name ?? demoClient.name,
      clientId: transaction.clientId ?? activeDemoClientId,
      requestType: transaction.status === "Needs Receipt" ? "Missing Receipt" : "Transaction Question",
      question: transaction.status === "Needs Receipt" ? `Please send the receipt for ${transaction.payee}.` : "What was this purchase for?",
      dateCreated: todayLabel(),
      dueDate: addDays(todayIso, 3),
      priority: transaction.status === "Needs Receipt" ? "High" : "Medium",
      relatedTransactionId: transaction.id,
      relatedTransaction: transaction.payee,
      relatedAmount: transaction.amount,
      requestedDocumentType: transaction.status === "Needs Receipt" ? "Receipt" : undefined,
      status: "Waiting for Client",
    });
    saveRequest(request);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: request.clientId ?? activeDemoClientId,
      requestId: request.id,
      kind: "request-sent",
      source: "demo",
      summary: `Sent ${request.requestType.toLowerCase()} request for ${request.relatedTransaction ?? request.client}.`,
    });
    updateTransaction({ ...transaction, status: "Needs Receipt" as const });
  };

  const createQuickBooksRequest = (transaction: LedgerTransaction, question: string) => {
    const request = normalizeRequest({
      id: `request-${transaction.quickBooksId || transaction.id}`,
      client: sandboxName,
      requestType: "Transaction Question",
      dateCreated: todayLabel(),
      dueDate: addDays(todayIso, 3),
      priority: "Medium",
      relatedTransaction: transaction.payee,
      relatedTransactionId: transaction.id,
      relatedAmount: transaction.amount,
      question,
      status: "Waiting for Client",
      quickBooksId: transaction.quickBooksId,
      transactionType: transaction.transactionType,
      payee: transaction.payee,
      transactionDate: transaction.date,
      amount: transaction.amount,
      currentCategory: transaction.category,
    });
    saveRequest(request);
  };

  const updateRequest = (updatedRequest: ClientRequest) => {
    saveRequest(updatedRequest);
  };

  const applyClientResponse = async (request: ClientRequest) => {
    if (!request.quickBooksId || !request.transactionType || !request.responseCategory) throw new Error("This request is not linked to a writable QuickBooks transaction.");
    const transaction = quickBooksTransactions.find((item) => item.quickBooksId === request.quickBooksId);
    if (!transaction) throw new Error("The linked QuickBooks transaction could not be refreshed.");
    if (transaction.readOnlyReason) throw new Error(transaction.readOnlyReason);
    const lines = getLines(transaction);
    if (lines.length !== 1) throw new Error("This transaction has several lines. Open it in Transactions and categorize each line individually.");
    const wanted = request.responseCategory.trim().toLowerCase();
    const option = quickBooksCategoryOptions.find((item) => item.name.toLowerCase() === wanted);
    if (!option?.id) throw new Error(`QuickBooks account "${request.responseCategory}" was not found.`);
    await applyTransactionChanges(transaction, [{ lineId: lines[0].id, category: option.name, categoryId: option.id }]);
    const resolved = appendMessage({ ...request, responseCategory: option.name }, "Bookkeeper", "LedgerOps Bookkeeper", `Applied your answer and updated the QuickBooks Sandbox category to ${option.name}.`, new Date().toISOString(), undefined, "Completed");
    saveRequest(resolved);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: QUICKBOOKS_CLIENT_ID,
      requestId: request.id,
      kind: "request-completed",
      source: "quickbooks",
      summary: `Completed QuickBooks Sandbox request for ${request.relatedTransaction ?? request.client}.`,
    });
  };

  const createPageRequest = (
    question: string,
    relatedTransaction: string,
    relatedAmount: string,
  ) => {
    const request = draftRequest({
      client: activeDemoClient?.name ?? demoClient.name,
      clientId: activeDemoClientId,
      requestType: "Custom Question",
      question,
      dateCreated: todayLabel(),
      dueDate: addDays(todayIso, 5),
      priority: "Medium",
      relatedTransaction,
      relatedAmount,
      status: "Waiting for Client",
    });
    saveRequest(request);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: activeDemoClientId,
      requestId: request.id,
      kind: "request-created",
      source: "demo",
      summary: `Created custom request for ${relatedTransaction}.`,
    });
  };

  const createManagedRequest = (input: {
    clientId: string;
    requestType: ClientRequestType;
    question: string;
    dueDate?: string;
    status: ClientRequestStatus;
    relatedTransactionId?: string;
    relatedTransaction?: string;
    relatedAmount?: string;
  }) => {
    const clientName = baseClients.find((client) => client.id === input.clientId)?.name ?? demoClient.name;
    const request = draftRequest({
      client: clientName,
      clientId: input.clientId,
      requestType: input.requestType,
      question: input.question,
      dateCreated: todayLabel(),
      dueDate: input.dueDate,
      priority: input.requestType === "Missing Receipt" || input.requestType === "Statement Request" ? "High" : "Medium",
      relatedTransactionId: input.relatedTransactionId,
      relatedTransaction: input.relatedTransaction,
      relatedAmount: input.relatedAmount,
      requestedDocumentType: input.requestType === "Missing Receipt" ? "Receipt" : input.requestType === "Statement Request" ? "Bank Statement" : undefined,
      status: input.status,
    });
    saveRequest(request);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: input.clientId,
      requestId: request.id,
      kind: input.status === "Draft" ? "request-created" : "request-sent",
      source: "demo",
      summary: `${input.status === "Draft" ? "Saved" : "Sent"} ${input.requestType.toLowerCase()} request for ${clientName}.`,
    });
  };

  const sendClientMessage = (request: ClientRequest, message: string) => {
    const next = appendMessage(request, "Client", request.client, message, new Date().toISOString(), undefined, "Client Responded");
    saveRequest(next);
    logPortal({
      at: new Date().toISOString(),
      actor: "Client",
      clientId: next.clientId ?? demoClient.id,
      requestId: next.id,
      kind: "client-responded",
      source: next.quickBooksId ? "quickbooks" : "demo",
      summary: `Client responded to ${next.requestType.toLowerCase()} request.`,
    });
  };

  const submitClientDocument = (request: ClientRequest, fixtureId: string, note: string) => {
    const fixture = fixturesForRequest(request).find((item) => item.id === fixtureId);
    if (!fixture) return;
    const at = new Date().toISOString();
    const document = createSubmittedDocument(request, fixture, at);
    saveDocument(document);
    const next = appendMessage(request, "Client", request.client, note || `Uploaded ${fixture.name}.`, at, [document.id], "Client Responded");
    saveRequest({ ...next, documentIds: [...(next.documentIds ?? []), document.id] });
    logPortal({
      at,
      actor: "Client",
      clientId: request.clientId ?? demoClient.id,
      requestId: request.id,
      documentId: document.id,
      kind: "document-submitted",
      source: request.quickBooksId ? "quickbooks" : "demo",
      summary: `Client submitted ${fixture.type.toLowerCase()} for ${request.relatedTransaction ?? request.client}.`,
    });
  };

  const approveRequest = (request: ClientRequest, message: string) => {
    const next = appendMessage(request, "Bookkeeper", "LedgerOps Bookkeeper", message || "Thanks — this request is complete.", new Date().toISOString(), undefined, "Completed");
    saveRequest(next);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: request.clientId ?? demoClient.id,
      requestId: request.id,
      kind: "request-completed",
      source: request.quickBooksId ? "quickbooks" : "demo",
      summary: `Completed ${request.requestType.toLowerCase()} request.`,
    });
  };

  const rejectRequest = (request: ClientRequest, message: string) => {
    const next = appendMessage(request, "Bookkeeper", "LedgerOps Bookkeeper", message || "Please send a little more detail so I can finish this request.", new Date().toISOString(), undefined, "Needs Follow-Up");
    saveRequest(next);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: request.clientId ?? demoClient.id,
      requestId: request.id,
      kind: "request-rejected",
      source: request.quickBooksId ? "quickbooks" : "demo",
      summary: `Requested follow-up for ${request.requestType.toLowerCase()} request.`,
    });
  };

  const matchReceiptDocument = (request: ClientRequest, documentId: string, transactionId: string) => {
    const document = documents.find((item) => item.id === documentId);
    const transaction = transactions.find((item) => item.id === transactionId);
    if (!document || !transaction) return;
    const matched = applyReceiptMatch(document, transaction);
    saveDocument(matched.document);
    updateTransaction(matched.transaction);
    const next = appendMessage(request, "Bookkeeper", "LedgerOps Bookkeeper", `Matched ${document.name} to ${transaction.payee} for ${transaction.amount}.`, new Date().toISOString(), [document.id], "Completed");
    saveRequest(next);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: request.clientId ?? demoClient.id,
      requestId: request.id,
      documentId: document.id,
      kind: "receipt-matched",
      source: "demo",
      summary: `Matched receipt to ${transaction.payee}.`,
    });
  };

  const createClientMessageRequest = (clientId: string, subject: string, message: string) => {
    const clientName = baseClients.find((client) => client.id === clientId)?.name ?? demoClient.name;
    const request = draftClientMessageRequest({ client: clientName, clientId, subject, message, at: new Date().toISOString() });
    saveRequest(request);
    logPortal({
      at: new Date().toISOString(),
      actor: "Client",
      clientId,
      requestId: request.id,
      kind: "message-sent",
      source: "demo",
      summary: `Client sent a new message: ${subject}.`,
    });
  };

  const savePaymentBook = (book: DemoPaymentBook) => {
    paymentLoadGeneration.current += 1;
    const next = [...paymentBooksRef.current.filter((item) => item.id !== book.id), book];
    paymentBooksRef.current = next;
    setPaymentBooks(next);
  };
  const saveJournalRecord = (record: DemoJournalRecord) => {
    journalLoadGeneration.current += 1;
    const next = [...journalsRef.current.filter((item) => item.id !== record.id), record].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    journalsRef.current = next;
    setJournalRecords(next);
  };
  const saveWorkpaperRecord = (record: DemoWorkpaperRecord) => {
    workpaperLoadGeneration.current += 1;
    const next = [...workpapersRef.current.filter((item) => item.id !== record.id), record].sort((left, right) => right.input.period.localeCompare(left.input.period) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    workpapersRef.current = next;
    setWorkpapers(next);
  };
  const createDraftJournal = async (input: DemoJournalEntryInput) => {
    if (appDataSource !== "demo") throw new Error("Journal entries can only be created in Demo Mode.");
    saveJournalRecord(await demoJournalService.create(activeDemoClientId, input));
  };
  const updateDraftJournal = async (record: DemoJournalRecord, input: DemoJournalEntryInput) => {
    if (appDataSource !== "demo") throw new Error("Journal entries can only be edited in Demo Mode.");
    saveJournalRecord(await demoJournalService.edit(record.id, record.version, input));
  };
  const postDraftJournal = async (record: DemoJournalRecord) => {
    if (appDataSource !== "demo") throw new Error("Journal entries can only be posted in Demo Mode.");
    saveJournalRecord(await demoJournalService.post(record.id, record.version));
  };
  const reverseJournal = async (record: DemoJournalRecord, reason: string) => {
    if (appDataSource !== "demo") throw new Error("Journal entries can only be reversed in Demo Mode.");
    const result = await demoJournalService.reverse(record.id, record.version, reason);
    saveJournalRecord(result.record!);
    if (result.reversal) saveJournalRecord(result.reversal);
  };
  const createWorkpaper = async (input: DemoWorkpaperInput) => {
    if (appDataSource !== "demo") throw new Error("Workpapers can only be saved in Demo Mode.");
    saveWorkpaperRecord(await demoWorkpaperService.create(activeDemoClientId, input));
  };
  const updateWorkpaper = async (record: DemoWorkpaperRecord, input: DemoWorkpaperInput) => {
    if (appDataSource !== "demo") throw new Error("Workpapers can only be updated in Demo Mode.");
    saveWorkpaperRecord(await demoWorkpaperService.update(record.id, record.version, input));
  };
  const recordDocumentPayment = async (kind: DocumentPaymentKind, documentId: string, input: DemoPaymentInput) => {
    if (appDataSource !== "demo") throw new Error("QuickBooks payments must be recorded in QuickBooks.");
    const clientId = activeDemoClientId;
    const current = bookForDocument(paymentBooksRef.current, kind, documentId, clientId);
    const next = await demoPaymentService.create(clientId, kind, documentId, current?.version ?? 0, input);
    savePaymentBook(next);
  };
  const reverseDocumentPayment = async (kind: DocumentPaymentKind, documentId: string, paymentId: string, reason: string) => {
    if (appDataSource !== "demo") throw new Error("QuickBooks payments must be reversed in QuickBooks.");
    const current = bookForDocument(paymentBooksRef.current, kind, documentId, activeDemoClientId);
    if (!current) throw new Error("The payment history could not be found.");
    const next = await demoPaymentService.reverse(current.id, paymentId, current.version, reason);
    savePaymentBook(next);
  };

  const changeTransactionSource = async (source: TransactionSource) => {
    setTransactionSource(source);
    setSelectedTransaction(null);
    if (source !== "quickbooks" || quickBooksTransactions.length > 0) return;
    setQuickBooksTransactionsLoading(true);
    setQuickBooksTransactionsError(null);
    try {
      setQuickBooksTransactions(await quickBooksService.getTransactions());
    } catch (error) {
      setQuickBooksTransactionsError(
        error instanceof Error
          ? error.message
          : "Unable to load QuickBooks transactions.",
      );
    } finally {
      setQuickBooksTransactionsLoading(false);
    }
  };

  const changeAccountSource = async (source: AccountSource) => {
    setAccountSource(source);
    if (source !== "quickbooks" || quickBooksAccounts.length > 0) return;
    setQuickBooksAccountsLoading(true);
    setQuickBooksAccountsError(null);
    try {
      setQuickBooksAccounts(await quickBooksService.getAccounts());
    } catch (error) {
      setQuickBooksAccountsError(
        error instanceof Error
          ? error.message
          : "Unable to load QuickBooks accounts.",
      );
    } finally {
      setQuickBooksAccountsLoading(false);
    }
  };

  const changeReceivablesSource = async (source: AccountSource) => {
    setReceivablesSource(source);
    setSelectedInvoice(null);
    if (source !== "quickbooks" || quickBooksInvoices.length > 0) return;
    setQuickBooksReceivablesLoading(true);
    setQuickBooksReceivablesError(null);
    try {
      setQuickBooksInvoices(await quickBooksService.getInvoices());
    } catch (error) {
      setQuickBooksReceivablesError(
        error instanceof Error
          ? error.message
          : "Unable to load QuickBooks invoices.",
      );
    } finally {
      setQuickBooksReceivablesLoading(false);
    }
  };

  const changePayablesSource = async (source: AccountSource) => {
    setPayablesSource(source);
    setSelectedBill(null);
    if (source !== "quickbooks" || quickBooksBills.length > 0) return;
    setQuickBooksPayablesLoading(true);
    setQuickBooksPayablesError(null);
    try {
      setQuickBooksBills(await quickBooksService.getBills());
    } catch (error) {
      setQuickBooksPayablesError(
        error instanceof Error
          ? error.message
          : "Unable to load QuickBooks bills.",
      );
    } finally {
      setQuickBooksPayablesLoading(false);
    }
  };

  const changeReviewSource = async (source: ReviewSource) => {
    setReviewSource(source);
    if (source === "demo" || reviewData) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const [loadedTransactions, loadedAccounts, loadedInvoices, loadedBills] = await Promise.all([
        quickBooksService.getTransactions(),
        quickBooksService.getAccounts(),
        quickBooksService.getInvoices(),
        quickBooksService.getBills(),
      ]);
      setReviewData({ transactions: loadedTransactions, accounts: loadedAccounts, invoices: loadedInvoices, bills: loadedBills });
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Unable to load QuickBooks review data.");
    } finally {
      setReviewLoading(false);
    }
  };

  const source = appDataSource;
  const scopedRequests = useMemo(() => {
    if (source !== "demo" || !activeDemoCompany) return scopeRequests(requests, source).map(normalizeRequest);
    const saved = requests.filter((request) => request.clientId === activeDemoCompany.clientId);
    const byId = new Map(saved.map((request) => [request.id, request]));
    const scenarios = companyPortalRequests(activeDemoCompany).map((request) => byId.get(request.id) ?? request);
    const scenarioIds = new Set(scenarios.map((request) => request.id));
    return [...scenarios, ...saved.filter((request) => !scenarioIds.has(request.id))].map(normalizeRequest);
  }, [requests, source, activeDemoCompany]);
  const scopedDocuments = useMemo(() => {
    if (source !== "demo") return [];
    if (activeDemoCompany) {
      const seeded = clientDocumentsFor(activeDemoCompany.clientId, activeDemoCompany.clientName);
      const saved = documents.filter((document) => document.clientId === activeDemoCompany.clientId);
      const byId = new Map(saved.map((document) => [document.id, document]));
      const scenarios = seeded.map((document) => byId.get(document.id) ?? document);
      const scenarioIds = new Set(scenarios.map((document) => document.id));
      return [...scenarios, ...saved.filter((document) => !scenarioIds.has(document.id))];
    }
    return documents;
  }, [activeDemoCompany, documents, source]);
  const transactions = useMemo(
    () => rawTransactions.map((transaction) => relevantTransactionStatus(transaction, scopedRequests)),
    [rawTransactions, scopedRequests],
  );
  // The client and month are chosen once here, so every workflow keeps showing the same ones.
  const monthEndClient = source === "demo" ? { id: (selectedClient ?? demoClient).id, name: (selectedClient ?? demoClient).name } : { id: QUICKBOOKS_CLIENT_ID, name: sandboxName };
  const todayIso = currentDate.toISOString().slice(0, 10);
  const monthEndView = useMonthEnd({
    enabled: view === "Month End" || (source === "demo" && (view === "Dashboard" || view === "Clients")),
    source,
    client: monthEndClient,
    period,
    today: todayIso,
    demoTransactions: transactions,
    ledger: source === "demo" ? ledger : undefined,
    requests: scopedRequests,
    quickBooksData: reviewData,
    refreshToken: `${view}:${demoResetRevision}`,
  });
  const monthEndItemsNow = toMonthEndItems(monthEndView.checklist);
  // Demo records are scoped to the selected fictional company; unselected clients contribute summary tasks only.
  const queueAvailable = source === "demo" || reviewData !== null;
  const dataClient = activeDemoClient ?? demoClient;
  const records: ClientRecords =
    source === "demo"
      ? { client: { id: dataClient.id, name: dataClient.name }, transactions, invoices, bills, accounts: [], reconciliations: reconciliationAccountsNow, requests: scopedRequests, monthEnd: monthEndItemsNow }
      : { client: { id: QUICKBOOKS_CLIENT_ID, name: sandboxName }, transactions: reviewData?.transactions ?? [], invoices: reviewData?.invoices ?? [], bills: reviewData?.bills ?? [], accounts: reviewData?.accounts ?? [], reconciliations: [], requests: scopedRequests, monthEnd: monthEndItemsNow };
  const recurringHistory = useMemo(() => {
    const visible = historyFromTransactions(records.client.id, automationSource, records.transactions);
    if (automationSource !== "demo") return visible;
    const seeded = demoRecurringHistory.filter((entry) => entry.clientId === records.client.id);
    const known = new Set(visible.map((entry) => `${entry.payee}|${entry.date}|${entry.amountCents}`));
    return [...seeded.filter((entry) => !known.has(`${entry.payee}|${entry.date}|${entry.amountCents}`)), ...visible];
  }, [automationSource, records.client.id, records.transactions]);
  const recurringPatterns = useMemo(
    () => recurringFromHistory(recurringHistory, todayIso).filter((pattern) => !scopedRecurringDecisions.some((decision) => decision.reminderId === pattern.id)),
    [recurringHistory, scopedRecurringDecisions, todayIso],
  );
  const ruleSuggestionMap = useMemo(() => new Map(records.transactions.map((transaction) => [transaction.id, bestRuleMatch(scopedRules, transaction)]).filter((entry): entry is [string, NonNullable<ReturnType<typeof bestRuleMatch>>] => Boolean(entry[1]))), [records.transactions, scopedRules]);
  const baseTasks = queueAvailable ? buildWorkTasks(records, source === "demo" ? clients.filter((client) => client.id !== records.client.id) : []).map((task) => {
    if (task.kind !== "uncategorized" || !task.recordId) return task;
    const match = ruleSuggestionMap.get(task.recordId);
    return match ? { ...task, priority: match.rule.reviewPriority, issue: "Uncategorized transaction with rule suggestion", description: `${task.description} Rule "${match.rule.name}" suggests ${match.rule.category}.`, automationId: match.rule.id, status: "Ready to review" as const } : task;
  }) : [];
  const automationTasks = queueAvailable ? buildAutomationTasks(records.client, ruleSuggestionMap, recurringPatterns) : [];
  const allTasks = sortTasks([...baseTasks, ...automationTasks]);
  const activeClient = source === "demo" && selectedClient ? clients.find((client) => client.id === selectedClient.id) ?? selectedClient : null;
  const visibleTasks = filterTasks(allTasks, { clientId: activeClient?.id });
  const hasDetail = !activeClient || activeClient.id === demoClient.id || ADDITIONAL_DEMO_CLIENT_IDS.includes(activeClient.id);
  const showNoDetail = Boolean(activeClient) && !hasDetail && detailViews.includes(view);
  const scopeName = source === "demo" ? activeClient?.name ?? demoClient.name : sandboxName;
  const clientMonthEnd = (client: Client) => (client.id === demoClient.id || ADDITIONAL_DEMO_CLIENT_IDS.includes(client.id) ? (selectedClient?.id === client.id && monthEndView.checklist ? completionPercent(monthEndView.checklist) : client.monthEnd) : null);
  const openedMonthEnd = source === "demo" ? (selectedClient ? clientMonthEnd(selectedClient) : null) : monthEndView.checklist ? completionPercent(monthEndView.checklist) : null;

  const entryTools: EntryTools | undefined = source === "demo"
    ? {
        clientId: activeDemoClientId,
        chart: ledger.accounts,
        records: demoEntries,
        loadError: entriesError,
        create: async (input, confirmed) => {
          const record = await demoEntryService.create(activeDemoClientId, input, confirmed);
          applyEntries([...entriesRef.current, record]);
        },
        edit: async (record, input, reason, confirmed) => {
          const saved = await demoEntryService.edit(record.id, record.version, input, reason, confirmed);
          applyEntries(entriesRef.current.map((item) => (item.id === saved.id ? saved : item)));
        },
        reverse: async (record, reason) => {
          const saved = await demoEntryService.reverse(record.id, record.version, reason);
          applyEntries(entriesRef.current.map((item) => (item.id === saved.id ? saved : item)));
        },
      }
    : undefined;

  const openTask = (task: WorkTask) => {
    setSelectedRecurring(null);
    if (source === "demo") {
      const owner = clients.find((client) => client.id === task.clientId);
      if (owner && owner.id !== selectedClient?.id) selectClient(owner);
    }
    if (task.kind === "missing-recurring" && task.automationId) {
      const reminder = recurringPatterns.find((pattern) => pattern.id === task.automationId) ?? null;
      setSelectedRecurring(reminder);
      setView("Bookkeeping Review");
      return;
    }
    if (task.requestId) {
      setSelectedRequest(scopedRequests.find((item) => item.id === task.requestId) ?? null);
      setView("Client Requests");
      return;
    }
    // A task about one record opens that record, so the user does not have to find it again.
    if (task.recordId) {
      const transaction = (source === "demo" ? transactions : reviewData?.transactions ?? []).find((item) => item.id === task.recordId);
      const invoice = (source === "demo" ? invoices : reviewData?.invoices ?? []).find((item) => item.id === task.recordId);
      const bill = (source === "demo" ? bills : reviewData?.bills ?? []).find((item) => item.id === task.recordId);
      if (task.destination === "Transactions" && transaction) { setSelectedTransaction(transaction); setView("Transactions"); return; }
      if (task.destination === "Receivables" && invoice) { setSelectedInvoice(invoice); setView("Receivables"); return; }
      if (task.destination === "Payables" && bill) { setSelectedBill(bill); setView("Payables"); return; }
    }
    const open = { Transactions: openTransactions, Receivables: openReceivables, Payables: openPayables, Reconcile: openReconcile, "Month End": openMonthEnd, "Client Requests": openRequests }[task.destination];
    open();
  };

  return (
    <ClientNameContext.Provider value={scopeName}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="brand-dot" /> LedgerOps
        </div>
        <p className="workspace-label">BOOKKEEPING WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          {navigationItems.map((item) => {
            const isActive = item.label === view;
            const isAvailable =
              item.label === "Dashboard" ||
              item.label === "Clients" ||
              item.label === "Inbox" ||
              item.label === "Bookkeeping Review" ||
              item.label === "Transactions" ||
              item.label === "Reconcile" ||
              item.label === "Receivables" ||
              item.label === "Payables" ||
              item.label === "Reports" ||
              item.label === "Month End" ||
              item.label === "Client Requests" ||
              item.label === "Settings";
            return (
              <button
                className={`nav-item ${isActive ? "active" : ""} ${!isAvailable ? "disabled" : ""}`}
                key={item.label}
                onClick={() =>
                  isAvailable &&
                  (item.label === "Inbox"
                    ? openInbox()
                    : item.label === "Bookkeeping Review"
                      ? setView("Bookkeeping Review")
                    : item.label === "Transactions"
                      ? openTransactions()
                      : item.label === "Reconcile"
                        ? openReconcile()
                        : item.label === "Receivables"
                          ? openReceivables()
                          : item.label === "Payables"
                            ? openPayables()
                            : item.label === "Reports"
                              ? openReports()
                              : item.label === "Month End"
                                ? openMonthEnd()
                                : item.label === "Client Requests"
                                  ? openRequests()
                                  : item.label === "Settings"
                                    ? openSettings()
                                    : setView(item.label as View))
                }
                disabled={!isAvailable}
                title={isAvailable ? item.label : "Coming in the next build"}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {!isAvailable && <span className="soon">Soon</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">{(user.name || user.email).trim().slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{user.name || user.email}</strong>
            <button className="sign-out-button" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              {new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              }).format(currentDate)}
            </p>
            <h1>
              {view === "Dashboard"
                ? activeClient
                  ? activeClient.name
                  : companyOpen && source === "quickbooks"
                    ? sandboxName
                    : "Let's get to work!"
                : view}
            </h1>
          </div>
          <div className="global-source-area">
            <ClientSwitcher source={source} clients={clients} selected={activeClient} sandboxName={sandboxName} onSelect={selectClient} />
            <AccountSourceSwitch source={appDataSource} onChange={changeAppDataSource} />
            <span className={`source-badge ${source}`}>{source === "demo" ? "Demo data" : "QuickBooks Sandbox"}</span>
            {appDataSource === "quickbooks" && <div className="global-source-meta"><strong>{quickBooksCompany?.CompanyName || "QuickBooks Sandbox"}</strong><span>Sandbox · Write Enabled · Test Data Only</span></div>}
            {appDataSource === "quickbooks" && !quickBooksStatus.connected && <button className="text-button" onClick={openSettings}>Connect in Settings →</button>}
          </div>
          <button className="help-button" aria-label="Get help">
            ?
          </button>
        </header>

        {scopeViews.includes(view) && <ScopeNotice source={source} client={activeClient} />}

        {showNoDetail && activeClient ? (
          <NoDetailNotice
            client={activeClient}
            monthEnd={clientMonthEnd(activeClient)}
            onOpenDetailed={() => selectClient(demoClient)}
            onBack={() => setView("Dashboard")}
          />
        ) : view === "Dashboard" ? (
          <Dashboard
            client={activeClient}
            companyOpen={source === "quickbooks" && companyOpen}
            companyName={sandboxName}
            source={source}
            available={queueAvailable}
            tasks={visibleTasks}
            clientTaskCounts={countByClient(allTasks)}
            clients={clients}
            monthEndProgress={openedMonthEnd}
            quickBooksAccounts={quickBooksAccounts}
            accountLoading={quickBooksAccountsLoading}
            accountError={quickBooksAccountsError}
            loading={reviewLoading}
            error={reviewError}
            onSourceChange={changeAppDataSource}
            onBack={() => selectClient(null)}
            onOpen={openClient}
            onOpenCompany={openCompany}
            onViewClients={() => setView("Clients")}
            onOpenInbox={openInbox}
            onOpenRequests={openRequests}
            onOpenTask={openTask}
            onTransactions={openTransactions}
            onReconcile={openReconcile}
            onMonthEnd={openMonthEnd}
            onReceivables={openReceivables}
            onPayables={openPayables}
            onReports={openReports}
            documents={scopedDocuments}
          />
        ) : view === "Clients" ? (
          <Clients
            source={source}
            clients={clients}
            tasks={allTasks}
            available={queueAvailable}
            companyName={sandboxName}
            connected={quickBooksStatus.connected}
            monthEndFor={clientMonthEnd}
            onOpen={openClient}
            onOpenCompany={openCompany}
          />
        ) : view === "Bookkeeping Review" ? (
          <BookkeepingReview source={source} tasks={visibleTasks.filter(isReviewTask)} available={queueAvailable} loading={reviewLoading} error={reviewError} selectedRecurring={selectedRecurring} onBackRecurring={() => setSelectedRecurring(null)} onResolveRecurring={resolveRecurringReminder} onSourceChange={changeAppDataSource} onOpenTask={openTask} />
        ) : view === "Inbox" ? (
          <Inbox tasks={visibleTasks} source={source} available={queueAvailable} loading={reviewLoading} error={reviewError} scopeLabel={activeClient?.name ?? (source === "demo" ? "All clients" : sandboxName)} onOpenTask={openTask} />
        ) : view === "Transactions" ? (
          <Transactions
            transactions={transactions}
            quickBooksTransactions={quickBooksTransactions}
            source={appDataSource}
            clientId={activeClient?.id ?? null}
            categoryOptions={appDataSource === "demo" ? demoCategoryOptions : quickBooksCategoryOptions}
            isLoading={quickBooksTransactionsLoading}
            error={quickBooksTransactionsError}
            rules={scopedRules}
            onSourceChange={changeAppDataSource}
            selectedTransaction={selectedTransaction}
            onSelect={setSelectedTransaction}
            onBack={() => setSelectedTransaction(null)}
            onApplyChanges={applyTransactionChanges}
            onReload={reloadQuickBooksTransactions}
            onRequestInformation={createRequest}
            onCreateQuickBooksRequest={createQuickBooksRequest}
            onLogSuggestion={logAutomation}
          />
        ) : view === "Reconcile" ? (
          <Reconcile
            source={appDataSource}
            clientRef={records.client}
            accounts={quickBooksAccounts}
            isLoading={quickBooksAccountsLoading}
            error={quickBooksAccountsError}
            today={currentDate.toISOString().slice(0, 10)}
            period={period}
            homeSignal={homeSignal}
            entryTools={entryTools}
            loadEntries={() => entriesRef.current}
            paymentBooks={appDataSource === "demo" ? paymentBooks : []}
            onPeriodChange={setPeriod}
            onSourceChange={changeAppDataSource}
          />
        ) : view === "Receivables" ? (
          <Receivables
            source={appDataSource}
            clientId={activeDemoCompany?.clientId ?? demoClient.id}
            invoices={invoices}
            quickBooksInvoices={quickBooksInvoices}
            isLoading={quickBooksReceivablesLoading}
            error={quickBooksReceivablesError}
            selectedInvoice={selectedInvoice ? invoices.find((item) => item.id === selectedInvoice.id) ?? selectedInvoice : null}
            paymentBooks={appDataSource === "demo" ? paymentBooks : []}
            paymentDateDefault={periodEnd(period)}
            onSelect={setSelectedInvoice}
            onBack={() => setSelectedInvoice(null)}
            onRecordPayment={recordDocumentPayment}
            onReversePayment={reverseDocumentPayment}
            onAskClient={createPageRequest}
            onSourceChange={changeAppDataSource}
          />
        ) : view === "Payables" ? (
          <Payables
            source={appDataSource}
            clientId={activeDemoCompany?.clientId ?? demoClient.id}
            bills={bills}
            quickBooksBills={quickBooksBills}
            isLoading={quickBooksPayablesLoading}
            error={quickBooksPayablesError}
            selectedBill={selectedBill ? bills.find((item) => item.id === selectedBill.id) ?? selectedBill : null}
            paymentBooks={appDataSource === "demo" ? paymentBooks : []}
            paymentDateDefault={periodEnd(period)}
            onSelect={setSelectedBill}
            onBack={() => setSelectedBill(null)}
            onRecordPayment={recordDocumentPayment}
            onReversePayment={reverseDocumentPayment}
            onAskClient={createPageRequest}
            onSourceChange={changeAppDataSource}
          />
        ) : view === "Reports" ? (
          <Reports
            source={appDataSource}
            clientId={monthEndClient.id}
            clientName={monthEndClient.name}
            period={period}
            today={todayIso}
            quickBooksAccounts={quickBooksAccounts.length > 0 ? quickBooksAccounts : reviewData?.accounts ?? []}
            sourceSwitch={<AccountSourceSwitch source={appDataSource} onChange={changeAppDataSource} />}
            onPeriodChange={setPeriod}
            onOpenReconcile={openReconcile}
            homeSignal={homeSignal}
            ledger={source === "demo" ? ledger : undefined}
            accountantTools={
              <AccountantTools
                source={appDataSource}
                clientName={monthEndClient.name}
                period={period}
                accounts={journalAccounts(activeDemoClientId, ledger.accounts).map((account) => ({ id: account.id, name: account.name, active: true, accountType: account.klass }))}
                journals={journalRecords}
                workpapers={workpapers}
                userDisplay={user.email}
                onCreateJournal={createDraftJournal}
                onUpdateJournal={updateDraftJournal}
                onPostJournal={postDraftJournal}
                onReverseJournal={reverseJournal}
                onCreateWorkpaper={createWorkpaper}
                onUpdateWorkpaper={updateWorkpaper}
              />
            }
          />
        ) : view === "Month End" ? (
          <MonthEnd
            source={appDataSource}
            clientName={monthEndClient.name}
            period={period}
            today={todayIso}
            view={monthEndView}
            onPeriodChange={setPeriod}
            sourceSwitch={<AccountSourceSwitch source={appDataSource} onChange={changeAppDataSource} />}
            onNavigate={openStepView}
          />
        ) : view === "Client Requests" ? (
          <ClientRequests
            source={source}
            clients={baseClients}
            selectedClientId={activeClient?.id ?? demoClient.id}
            requests={scopedRequests}
            documents={scopedDocuments}
            auditEvents={portalAudit.filter((event) => source === "quickbooks" ? event.source === "quickbooks" : event.source === "demo")}
            transactions={transactions}
            selectedRequest={selectedRequest}
            onSelect={setSelectedRequest}
            onBack={() => setSelectedRequest(null)}
            onUpdate={updateRequest}
            onApplyResponse={applyClientResponse}
            onCreateRequest={createManagedRequest}
            onCreateClientMessage={createClientMessageRequest}
            onSendClientMessage={sendClientMessage}
            onSubmitDocument={submitClientDocument}
            onApproveRequest={approveRequest}
            onRejectRequest={rejectRequest}
            onMatchReceipt={matchReceiptDocument}
          />
        ) : (
          <Settings
            quickBooksStatus={quickBooksStatus}
            company={quickBooksCompany}
            onStatusChange={setQuickBooksStatus}
            onCompanyChange={setQuickBooksCompany}
            auditLog={auditLog}
            selectedClientId={automationClientId}
            selectedClientName={automationClientName}
            source={automationSource}
            rules={scopedRules}
            rulePreviewTransactions={records.transactions}
            automationEvents={scopedAutomationEvents}
            recurringPatterns={recurringPatterns}
            categoryOptions={appDataSource === "demo" ? demoCategoryOptions : quickBooksCategoryOptions}
            onSaveRule={saveRule}
            onToggleRule={toggleRule}
            onDeleteRule={deleteRule}
            onReset={(clientIds) => {
              resetDemoState(clientIds);
              localStorage.setItem("ledgerops-demo-reset", JSON.stringify(clientIds));
            }}
          />
        )}
      </main>
    </div>
    </ClientNameContext.Provider>
  );
}

function formatDueDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const taskSlug = (value: string) => value.toLowerCase().replaceAll(" ", "-");

function TaskCardList({ tasks, showClient, onOpenTask }: { tasks: WorkTask[]; showClient: boolean; onOpenTask: (task: WorkTask) => void }) {
  return (
    <div className="review-card-list">
      {tasks.map((task) => (
        <button className="review-card" key={task.id} onClick={() => onOpenTask(task)}>
          <div className="review-card-top">
            <span className="review-type">{showClient ? `${task.client} · ` : ""}{task.issue}</span>
            <span className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</span>
          </div>
          <p>{task.description}</p>
          {task.amount !== undefined && <span className="review-amount">{formatMoney(task.amount)}</span>}
          <div className="review-card-footer">
            <span>{task.suspected ? "Possible issue · " : ""}{task.dueDate ? `Due ${formatDueDate(task.dueDate)} · ` : ""}Next: {task.action}</span>
            <span className="row-arrow">→</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ClientSwitcher({ source, clients, selected, sandboxName, onSelect }: { source: AccountSource; clients: Client[]; selected: Client | null; sandboxName: string; onSelect: (client: Client | null) => void }) {
  if (source === "quickbooks")
    return (
      <label className="client-switcher" title="QuickBooks Sandbox connects one company. Switching clients is not available yet.">
        <span>Client</span>
        <select disabled value="company"><option value="company">{sandboxName}</option></select>
      </label>
    );
  return (
    <label className="client-switcher">
      <span>Client</span>
      <select value={selected?.id ?? ""} onChange={(event) => onSelect(clients.find((client) => client.id === event.target.value) ?? null)}>
        <option value="">All clients</option>
        {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
    </label>
  );
}

function ScopeNotice({ source, client }: { source: AccountSource; client: Client | null }) {
  if (source === "quickbooks")
    return <div className="scope-notice">QuickBooks Sandbox shows one connected company. It is not linked to any demo client, and connecting several companies is not supported yet.</div>;
  if (client && client.id !== demoClient.id && !ADDITIONAL_DEMO_CLIENT_IDS.includes(client.id))
    return <div className="scope-notice">Only {demoClient.name} has detailed demo records. {client.name} shows summary figures only and is not connected to QuickBooks.</div>;
  return null;
}

function NoDetailNotice({ client, monthEnd, onOpenDetailed, onBack }: { client: Client; monthEnd: number | null; onOpenDetailed: () => void; onBack: () => void }) {
  return (
    <div className="page-content">
      <div className="empty-state">
        <h2>No detailed records for {client.name}</h2>
        <p className="muted">Demo data only includes individual transactions, invoices, bills and requests for {demoClient.name}. {client.name} has summary figures only and is not connected to QuickBooks.</p>
        <div className="detail-list">
          <span><small>Items flagged</small><strong>{client.attention}</strong></span>
          <span><small>Reconciliation</small><strong>{client.reconciliation}</strong></span>
          <span><small>Month end</small><strong>{monthEnd === null ? NOT_AVAILABLE : `${monthEnd}%`}</strong></span>
        </div>
        <button className="primary-button" onClick={onOpenDetailed}>Open {demoClient.name}'s records <span>→</span></button>
        <button className="text-button" onClick={onBack}>Back to dashboard</button>
      </div>
    </div>
  );
}

function Dashboard({
  client,
  companyOpen,
  companyName,
  source,
  available,
  tasks,
  clientTaskCounts,
  clients,
  monthEndProgress,
  quickBooksAccounts,
  accountLoading,
  accountError,
  loading,
  error,
  onSourceChange,
  onBack,
  onOpen,
  onOpenCompany,
  onViewClients,
  onOpenInbox,
  onOpenRequests,
  onOpenTask,
  onTransactions,
  onReconcile,
  onMonthEnd,
  onReceivables,
  onPayables,
  onReports,
  documents,
}: {
  client: Client | null;
  companyOpen: boolean;
  companyName: string;
  source: AccountSource;
  available: boolean;
  tasks: WorkTask[];
  clientTaskCounts: Record<string, number>;
  clients: Client[];
  monthEndProgress: number | null;
  quickBooksAccounts: LedgerAccount[];
  accountLoading: boolean;
  accountError: string | null;
  loading: boolean;
  error: string | null;
  onSourceChange: (source: AccountSource) => void;
  onBack: () => void;
  onOpen: (client: Client) => void;
  onOpenCompany: () => void;
  onViewClients: () => void;
  onOpenInbox: () => void;
  onOpenRequests: () => void;
  onOpenTask: (task: WorkTask) => void;
  onTransactions: () => void;
  onReconcile: () => void;
  onMonthEnd: () => void;
  onReceivables: () => void;
  onPayables: () => void;
  onReports: () => void;
  documents: ClientDocument[];
}) {
  if (client || companyOpen)
    return (
      <ClientDashboard
        client={client}
        companyName={companyName}
        source={source}
        available={available}
        tasks={tasks}
        monthEndProgress={monthEndProgress}
        quickBooksAccounts={quickBooksAccounts}
        accountLoading={accountLoading}
        accountError={accountError}
        onSourceChange={onSourceChange}
        onBack={onBack}
        onOpenInbox={onOpenInbox}
        onOpenRequests={onOpenRequests}
        onOpenTask={onOpenTask}
        onTransactions={onTransactions}
        onReconcile={onReconcile}
        onMonthEnd={onMonthEnd}
        onReceivables={onReceivables}
        onPayables={onPayables}
        onReports={onReports}
        documents={documents}
      />
    );

  const summary = summarizeTasks(tasks);
  const value = (count: number) => (available ? `${count}` : NOT_AVAILABLE);
  const clientTotal = source === "demo" ? clients.length : 1;
  const nextUp = tasks.slice(0, 8);

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Here is what needs your attention.</h2>
          <p className="muted">
            Work through these items to keep your clients on track.
          </p>
        </div>
        <button className="primary-button" onClick={onOpenInbox}>
          Open Inbox <span>→</span>
        </button>
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {loading && <div className="data-state-message">Loading QuickBooks Sandbox data...</div>}
      {error && <div className="data-state-message error">{error}</div>}
      {!available && !loading && !error && <div className="data-state-message">{NOT_AVAILABLE}: QuickBooks Sandbox data has not been loaded. Connect in Settings to see real figures.</div>}
      <section className="metrics-grid" aria-label="Bookkeeping overview">
        <MetricCard label="Clients" value={`${clientTotal}`} note={source === "demo" ? "Demo clients" : "Connected company"} tone="green" />
        <MetricCard label="Clients needing attention" value={value(summary.clientsNeedingAttention)} note={available ? `of ${clientTotal}` : "Data not loaded"} tone="red" />
        <MetricCard label="Transactions to review" value={value(summary.transactions)} note="Needs a look" tone="amber" />
        <MetricCard label="Reconciliation issues" value={value(summary.reconciliation)} note="Accounts to check" tone="blue" />
        <MetricCard label="Overdue invoices" value={value(summary.overdueInvoices)} note="Receivables" tone="red" />
        <MetricCard label="Overdue bills" value={value(summary.overdueBills)} note="Payables" tone="red" />
        <MetricCard label="Client questions" value={value(summary.clientQuestions)} note="Open requests" tone="purple" />
        <MetricCard label="Month ends open" value={value(summary.clientsWithMonthEndOpen)} note="Clients not finished" tone="green" />
        <MetricCard label="High priority" value={value(summary.high)} note="Do these first" tone="red" />
      </section>
      <section className="content-grid">
        <div className="panel work-panel">
          <div className="panel-heading">
            <div>
              <h2>Today's work</h2>
              <p className="muted">Start with the most important items.</p>
            </div>
            <span className="count-pill">{available ? `${tasks.length} tasks` : NOT_AVAILABLE}</span>
          </div>
          {available && nextUp.length === 0 && <div className="empty-state"><span>✓</span><h2>You're all caught up.</h2><p className="muted">Nothing needs attention right now.</p></div>}
          <TaskCardList tasks={nextUp} showClient={source === "demo"} onOpenTask={onOpenTask} />
          {tasks.length > nextUp.length && (
            <button className="text-button" onClick={onOpenInbox}>
              See all {tasks.length} tasks in the Inbox <span>→</span>
            </button>
          )}
        </div>
        <div className="panel client-summary">
          <div className="panel-heading">
            <div>
              <h2>Your clients</h2>
              <p className="muted">{source === "demo" ? "Pick a client to focus on." : "The connected QuickBooks company."}</p>
            </div>
          </div>
          {source === "demo" ? (
            clients.map((item) => {
              const open = clientTaskCounts[item.id] ?? 0;
              return (
                <button className="client-card" key={item.id} onClick={() => onOpen(item)}>
                  <div className="company-avatar">{item.initials}</div>
                  <div className="client-info">
                    <strong>{item.name}</strong>
                    <span>{open === 0 ? "Nothing open" : `${open} open`}</span>
                  </div>
                  <span className={`status-dot ${open === 0 ? "green-dot" : "amber-dot"}`} />{" "}
                  <span className="arrow">→</span>
                </button>
              );
            })
          ) : (
            <button className="client-card" onClick={onOpenCompany}>
              <div className="company-avatar">QB</div>
              <div className="client-info">
                <strong>{companyName}</strong>
                <span>{available ? `${tasks.length} open` : NOT_AVAILABLE}</span>
              </div>
              <span className="arrow">→</span>
            </button>
          )}
          <button className="text-button" onClick={onViewClients}>
            View all clients <span>→</span>
          </button>
        </div>
      </section>
    </div>
  );
}


function Clients({
  source,
  clients,
  tasks,
  available,
  companyName,
  connected,
  monthEndFor,
  onOpen,
  onOpenCompany,
}: {
  source: AccountSource;
  clients: Client[];
  tasks: WorkTask[];
  available: boolean;
  companyName: string;
  connected: boolean;
  monthEndFor: (client: Client) => number | null;
  onOpen: (client: Client) => void;
  onOpenCompany: () => void;
}) {
  const counts = countByClient(tasks);
  const companyTaskCount = tasks.reduce((total, task) => total + task.count, 0);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Clients</h2>
          <p className="muted">Keep every company moving forward.</p>
        </div>
        <button className="primary-button" disabled>
          Add client <span>+</span>
        </button>
      </section>
      <div className="client-card-grid">
        {source === "quickbooks" ? (
          <button className="full-client-card" onClick={onOpenCompany}>
            <div className="full-client-header">
              <span className="company-avatar">QB</span>
              <span className="client-card-title">
                <strong>{companyName}</strong>
                <span>QuickBooks Sandbox</span>
              </span>
              <span className={`status-badge ${connected ? "success" : "warning"}`}>
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>
            <div className="client-card-details">
              <span>
                <small>Items needing attention</small>
                <strong className={companyTaskCount ? "attention-number" : "success-text"}>
                  {available ? companyTaskCount : NOT_AVAILABLE}
                </strong>
              </span>
              <span>
                <small>Reconciliation</small>
                <strong>{NOT_AVAILABLE}</strong>
              </span>
            </div>
            <div className="client-card-progress">
              <span>
                <small>Sandbox supports one company at a time</small>
              </span>
              <span className="row-arrow">→</span>
            </div>
          </button>
        ) : (
          clients.map((client) => {
            const open = counts[client.id] ?? 0;
            const monthEnd = monthEndFor(client);
            return (
              <button
                className="full-client-card"
                key={client.id}
                onClick={() => onOpen(client)}
              >
                <div className="full-client-header">
                  <span className="company-avatar">{client.initials}</span>
                  <span className="client-card-title">
                    <strong>{client.name}</strong>
                    <span>{client.month}</span>
                  </span>
                  <span className={`status-badge ${open === 0 ? "success" : "warning"}`}>
                    {open === 0 ? "On track" : "Needs attention"}
                  </span>
                </div>
                <div className="client-card-details">
                  <span>
                    <small>Items needing attention</small>
                    <strong className={open ? "attention-number" : "success-text"}>{open}</strong>
                  </span>
                  <span>
                    <small>Reconciliation</small>
                    <strong>{client.reconciliation}</strong>
                  </span>
                  <span>
                    <small>QuickBooks</small>
                    <strong>Not connected (demo client)</strong>
                  </span>
                </div>
                <div className="client-card-progress">
                  <span>
                    <small>Month-end progress</small>
                    <strong>{monthEnd === null ? NOT_AVAILABLE : `${monthEnd}%`}</strong>
                  </span>
                  <span className="progress-bar">
                    <span style={{ width: `${monthEnd ?? 0}%` }} />
                  </span>
                  <span className="row-arrow">→</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function BookkeepingReview({
  source,
  tasks,
  available,
  loading,
  error,
  selectedRecurring,
  onBackRecurring,
  onResolveRecurring,
  onSourceChange,
  onOpenTask,
}: {
  source: ReviewSource;
  tasks: WorkTask[];
  available: boolean;
  loading: boolean;
  error: string | null;
  selectedRecurring: RecurringPattern | null;
  onBackRecurring: () => void;
  onResolveRecurring: (pattern: RecurringPattern, status: "confirmed" | "dismissed") => void;
  onSourceChange: (source: ReviewSource) => void;
  onOpenTask: (task: WorkTask) => void;
}) {
  const [filter, setFilter] = useState<"All" | TaskType>("All");
  if (selectedRecurring) {
    return (
      <div className="page-content">
        <button className="back-button" onClick={onBackRecurring}>← All review items</button>
        <section className="review-header">
          <div>
            <p className="eyebrow">RECURRING REMINDER</p>
            <h2>{selectedRecurring.vendor}</h2>
            <p className="muted">Expected {selectedRecurring.frequency.toLowerCase()} · next due {formatDueDate(selectedRecurring.expectedNextDate)}</p>
          </div>
          <span className={`inbox-status ${selectedRecurring.missing ? "open" : "resolved"}`}>{selectedRecurring.confidence} confidence</span>
        </section>
        <section className="request-detail-layout">
          <div className="panel request-question">
            <h2>Why LedgerOps flagged this</h2>
            <div className="detail-list">
              <span><small>Typical amount</small><strong>{formatMoney(selectedRecurring.typicalAmountCents / 100)}</strong></span>
              <span><small>Frequency</small><strong>{selectedRecurring.frequency}</strong></span>
              <span><small>Expected next date</small><strong>{formatDueDate(selectedRecurring.expectedNextDate)}</strong></span>
            </div>
            <ul className="reason-list">{selectedRecurring.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div className="panel request-details">
            <h2>Review action</h2>
            <p className="muted">This is a reminder only. No transaction will be created or posted automatically.</p>
            <div className="reset-actions">
              <button className="secondary-button" onClick={() => onResolveRecurring(selectedRecurring, "dismissed")}>Dismiss reminder</button>
              <button className="primary-button" onClick={() => onResolveRecurring(selectedRecurring, "confirmed")}>Confirm pattern</button>
            </div>
          </div>
        </section>
      </div>
    );
  }
  const visibleTasks = filterTasks(tasks, { type: filter });
  const total = (list: WorkTask[]) => list.reduce((sum, task) => sum + task.count, 0);
  const count = (priority: TaskPriority) => total(tasks.filter((task) => task.priority === priority));
  const figure = (value: number) => (available ? `${value}` : NOT_AVAILABLE);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Bookkeeping Review</h2>
          <p className="muted">Checks that suggest items may need attention. Items marked "Possible issue" are suggestions, not confirmed errors.</p>
        </div>
        <span className="attention-summary"><strong>{figure(total(tasks))}</strong> items found</span>
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {loading && <div className="data-state-message">Loading QuickBooks Sandbox review data...</div>}
      {error && <div className="data-state-message error">{error}</div>}
      {!available && !loading && !error && <div className="data-state-message">{NOT_AVAILABLE}: QuickBooks Sandbox data has not been loaded.</div>}
      <div className="review-summary-grid">
        <SummaryCard value={figure(total(tasks))} label="Needs Attention" tone="red" />
        <SummaryCard value={figure(count("High"))} label="High Priority" tone="red" />
        <SummaryCard value={figure(count("Medium"))} label="Medium Priority" tone="amber" />
        <SummaryCard value={figure(count("Low"))} label="Low Priority" tone="green" />
      </div>
      <div className="filter-row">
        {(["All", "Transactions", "Receivables", "Payables", "Reconciliation"] as const).map((option) => (
          <button className={`filter-button ${filter === option ? "active" : ""}`} key={option} onClick={() => setFilter(option)}>
            {option}
            <span>{total(filterTasks(tasks, { type: option }))}</span>
          </button>
        ))}
      </div>
      {available && visibleTasks.length === 0 ? (
        <div className="empty-state"><span>✓</span><h2>You're all caught up.</h2><p className="muted">No review items were found.</p></div>
      ) : (
        <TaskCardList tasks={visibleTasks} showClient={source === "demo"} onOpenTask={onOpenTask} />
      )}
    </div>
  );
}

const inboxTypeFilters = ["All", ...taskTypes] as const;

function Inbox({
  tasks,
  source,
  available,
  loading,
  error,
  scopeLabel,
  onOpenTask,
}: {
  tasks: WorkTask[];
  source: AccountSource;
  available: boolean;
  loading: boolean;
  error: string | null;
  scopeLabel: string;
  onOpenTask: (task: WorkTask) => void;
}) {
  const [type, setType] = useState<TaskType | "All">("All");
  const [priority, setPriority] = useState<TaskPriority | "All">("All");
  const [status, setStatus] = useState<TaskStatus | "All">("All");
  const visibleTasks = filterTasks(tasks, { type, priority, status });
  const total = (list: WorkTask[]) => list.reduce((sum, task) => sum + task.count, 0);
  const typeCount = (option: TaskType) => total(filterTasks(tasks, { type: option, priority, status }));
  const figure = (value: number) => (available ? `${value}` : NOT_AVAILABLE);

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Bookkeeping Inbox</h2>
          <p className="muted">
            Everything that needs your attention, in one place. Showing: {scopeLabel}.
          </p>
        </div>
        <span className="attention-summary">
          <strong>{figure(total(tasks))}</strong> items need attention
        </span>
      </section>
      {loading && <div className="data-state-message">Loading QuickBooks Sandbox data...</div>}
      {error && <div className="data-state-message error">{error}</div>}
      {!available && !loading && !error && <div className="data-state-message">{NOT_AVAILABLE}: QuickBooks Sandbox data has not been loaded. Connect in Settings to see real tasks.</div>}
      <div className="inbox-summary-grid">
        <SummaryCard value={figure(total(filterTasks(tasks, { type: "Transactions" })))} label="Transactions to review" tone="red" />
        <SummaryCard value={figure(total(filterTasks(tasks, { type: "Receivables" })))} label="Receivables to check" tone="amber" />
        <SummaryCard value={figure(total(filterTasks(tasks, { type: "Payables" })))} label="Payables to check" tone="purple" />
        <SummaryCard value={figure(total(filterTasks(tasks, { type: "Reconciliation" })))} label="Reconciliation issues" tone="blue" />
        <SummaryCard value={figure(total(filterTasks(tasks, { type: "Client Requests" })))} label="Client questions" tone="red" />
      </div>
      <div className="filter-row" aria-label="Inbox filters">
        {inboxTypeFilters.map((option) => (
          <button
            className={`filter-button ${type === option ? "active" : ""}`}
            key={option}
            onClick={() => setType(option)}
          >
            {option}
            <span>{option === "All" ? total(filterTasks(tasks, { priority, status })) : typeCount(option)}</span>
          </button>
        ))}
      </div>
      <div className="queue-filters">
        <label>
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | "All")}>
            <option value="All">All priorities</option>
            {taskPriorities.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | "All")}>
            <option value="All">All statuses</option>
            {taskStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>
      {visibleTasks.length === 0 ? (
        available ? (
          <div className="empty-state">
            <span>✓</span>
            <h2>You're all caught up.</h2>
            <p className="muted">{tasks.length === 0 ? "There is nothing waiting for your attention." : "No tasks match these filters."}</p>
          </div>
        ) : null
      ) : (
        <div className="panel inbox-panel">
          <div className="inbox-heading">
            <span>Client</span>
            <span>Type</span>
            <span>Task</span>
            <span>Priority</span>
            <span>Due</span>
            <span>Status</span>
            <span />
          </div>
          {visibleTasks.map((task) => (
            <button
              className="inbox-row"
              key={task.id}
              onClick={() => onOpenTask(task)}
              title={`Next: ${task.action}`}
            >
              <strong>{task.client}</strong>
              <span className="inbox-type">{task.type}</span>
              <span>{task.suspected ? "Possible issue: " : ""}{task.description}</span>
              <span className={`priority-badge ${task.priority.toLowerCase()}`}>
                {task.priority}
              </span>
              <span>{task.dueDate ? formatDueDate(task.dueDate) : "—"}</span>
              <span className={`inbox-status ${taskSlug(task.status)}`}>
                {task.status}
              </span>
              <span className="row-arrow">→</span>
            </button>
          ))}
        </div>
      )}
      {source === "demo" && available && <p className="muted">Items from demo clients without detailed records are summary counts only.</p>}
    </div>
  );
}

function SummaryCard({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <div className={`summary-card ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ClientRequests({
  source,
  clients,
  selectedClientId,
  requests,
  documents,
  auditEvents,
  transactions,
  selectedRequest,
  onSelect,
  onBack,
  onUpdate,
  onApplyResponse,
  onCreateRequest,
  onCreateClientMessage,
  onSendClientMessage,
  onSubmitDocument,
  onApproveRequest,
  onRejectRequest,
  onMatchReceipt,
}: {
  source: AccountSource;
  clients: Client[];
  selectedClientId: string;
  requests: ClientRequest[];
  documents: ClientDocument[];
  auditEvents: PortalAuditEvent[];
  transactions: Transaction[];
  selectedRequest: ClientRequest | null;
  onSelect: (request: ClientRequest) => void;
  onBack: () => void;
  onUpdate: (request: ClientRequest) => void;
  onApplyResponse: (request: ClientRequest) => Promise<void>;
  onCreateRequest: (input: {
    clientId: string;
    requestType: ClientRequestType;
    question: string;
    dueDate?: string;
    status: ClientRequestStatus;
    relatedTransactionId?: string;
    relatedTransaction?: string;
    relatedAmount?: string;
  }) => void;
  onCreateClientMessage: (clientId: string, subject: string, message: string) => void;
  onSendClientMessage: (request: ClientRequest, message: string) => void;
  onSubmitDocument: (request: ClientRequest, fixtureId: string, note: string) => void;
  onApproveRequest: (request: ClientRequest, message: string) => void;
  onRejectRequest: (request: ClientRequest, message: string) => void;
  onMatchReceipt: (request: ClientRequest, documentId: string, transactionId: string) => void;
}) {
  const [filter, setFilter] = useState<ClientRequest["status"] | "All">("All");
  const [mode, setMode] = useState<"bookkeeper" | "client">("bookkeeper");
  const [portalClientId, setPortalClientId] = useState(selectedClientId);
  const [draftClientId, setDraftClientId] = useState(selectedClientId);
  const [draftType, setDraftType] = useState<ClientRequestType>("Custom Question");
  const [draftQuestion, setDraftQuestion] = useState("");
  const [draftDueDate, setDraftDueDate] = useState(addDays(normalizeDisplayDate(new Date().toISOString().slice(0, 10)), 3));
  const [draftRelatedTransaction, setDraftRelatedTransaction] = useState("");
  const [draftRelatedAmount, setDraftRelatedAmount] = useState("");
  const [portalSubject, setPortalSubject] = useState("");
  const [portalMessage, setPortalMessage] = useState("");

  useEffect(() => {
    setPortalClientId(selectedClientId);
    setDraftClientId(selectedClientId);
  }, [selectedClientId]);

  const portalRequests = requests.filter((request) => requestMatchesClient(request, portalClientId));
  const portalDocuments = documents.filter((document) => document.clientId === portalClientId);
  const visibleRequests = mode === "client"
    ? portalRequests.filter((request) => filter === "All" ? true : request.status === filter)
    : (filter === "All" ? requests : requests.filter((request) => request.status === filter));
  const outstanding = portalRequests.filter((request) => openRequest(request)).length;
  const completed = portalRequests.length - outstanding;

  if (selectedRequest)
    return (
      <ClientRequestDetail
        source={source}
        role={mode}
        request={selectedRequest}
        documents={documents.filter((document) => document.requestId === selectedRequest.id || requestDocumentIds(selectedRequest, documents).includes(document.id))}
        transactions={transactions}
        onBack={onBack}
        onUpdate={onUpdate}
        onApplyResponse={onApplyResponse}
        onSendClientMessage={onSendClientMessage}
        onSubmitDocument={onSubmitDocument}
        onApproveRequest={onApproveRequest}
        onRejectRequest={onRejectRequest}
        onMatchReceipt={onMatchReceipt}
      />
    );
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Client Requests</h2>
          <p className="muted">
            {mode === "bookkeeper"
              ? <>Questions, follow-ups, and uploaded demo documents for {source === "demo" ? <ClientName /> : "the connected company"}.</>
              : "Demo-only simulated client portal. This is not a secure external login."}
          </p>
        </div>
        <span className="attention-summary">
          <strong>{mode === "client" ? outstanding : requests.filter((request) => openRequest(request)).length}</strong> active requests
        </span>
      </section>
      {source === "demo" && (
        <div className="filter-row" aria-label="Client request modes">
          <button className={`filter-button ${mode === "bookkeeper" ? "active" : ""}`} onClick={() => setMode("bookkeeper")}>Bookkeeper View<span>Internal</span></button>
          <button className={`filter-button ${mode === "client" ? "active" : ""}`} onClick={() => setMode("client")}>Simulated Client View<span>Demo</span></button>
        </div>
      )}
      {mode === "client" && source === "demo" && (
        <div className="panel portal-panel">
          <div className="portal-header">
            <div>
              <h2>Simulated Client Portal</h2>
              <p className="muted">Use this demo view to reply, submit safe fixture documents, and send messages without exposing data publicly.</p>
            </div>
            <label>
              Client
              <select value={portalClientId} onChange={(event) => setPortalClientId(event.target.value)}>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
          </div>
          <div className="portal-stats">
            <div className="summary-card red"><strong>{outstanding}</strong><span>Outstanding requests</span></div>
            <div className="summary-card green"><strong>{completed}</strong><span>Completed requests</span></div>
            <div className="summary-card blue"><strong>{portalDocuments.length}</strong><span>Demo documents</span></div>
          </div>
          <div className="portal-compose">
            <label>
              Message subject
              <input value={portalSubject} onChange={(event) => setPortalSubject(event.target.value)} placeholder="Question about August bank statement" />
            </label>
            <label>
              Message
              <textarea value={portalMessage} onChange={(event) => setPortalMessage(event.target.value)} placeholder="Type a message to your bookkeeper." />
            </label>
            <div className="reset-actions">
              <button className="primary-button" onClick={() => {
                if (!portalSubject.trim() || !portalMessage.trim()) return;
                onCreateClientMessage(portalClientId, portalSubject.trim(), portalMessage.trim());
                setPortalSubject("");
                setPortalMessage("");
              }}>Send message to bookkeeper <span>→</span></button>
            </div>
          </div>
        </div>
      )}
      {mode === "bookkeeper" && source === "demo" && (
        <div className="panel portal-panel">
          <div className="panel-heading">
            <div>
              <h2>Create request</h2>
              <p className="muted">Reuse the existing request workflow for receipts, statements, invoices, and custom questions.</p>
            </div>
          </div>
          <div className="queue-filters">
            <label>
              Client
              <select value={draftClientId} onChange={(event) => setDraftClientId(event.target.value)}>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label>
              Request type
              <select value={draftType} onChange={(event) => setDraftType(event.target.value as ClientRequestType)}>
                {(["Missing Receipt", "Transaction Question", "Statement Request", "Invoice Request", "Custom Question"] as const).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Due date
              <input type="date" value={draftDueDate} onChange={(event) => setDraftDueDate(event.target.value)} />
            </label>
          </div>
          <div className="queue-filters">
            <label>
              Related transaction or document
              <input value={draftRelatedTransaction} onChange={(event) => setDraftRelatedTransaction(event.target.value)} placeholder="Home Depot" />
            </label>
            <label>
              Amount
              <input value={draftRelatedAmount} onChange={(event) => setDraftRelatedAmount(event.target.value)} placeholder="$341.22" />
            </label>
          </div>
          <label className="portal-compose">
            Request
            <textarea value={draftQuestion} onChange={(event) => setDraftQuestion(event.target.value)} placeholder="Please upload the receipt for this purchase." />
          </label>
          <div className="reset-actions">
            <button className="secondary-button" onClick={() => {
              if (!draftQuestion.trim()) return;
              onCreateRequest({ clientId: draftClientId, requestType: draftType, question: draftQuestion.trim(), dueDate: draftDueDate || undefined, status: "Draft", relatedTransaction: draftRelatedTransaction || undefined, relatedAmount: draftRelatedAmount || undefined });
              setDraftQuestion("");
            }}>Save draft</button>
            <button className="primary-button" onClick={() => {
              if (!draftQuestion.trim()) return;
              onCreateRequest({ clientId: draftClientId, requestType: draftType, question: draftQuestion.trim(), dueDate: draftDueDate || undefined, status: "Waiting for Client", relatedTransaction: draftRelatedTransaction || undefined, relatedAmount: draftRelatedAmount || undefined });
              setDraftQuestion("");
            }}>Send request <span>→</span></button>
          </div>
        </div>
      )}
      <div className="filter-row">{(["All", "Draft", "Sent", "Waiting for Client", "Client Responded", "Needs Follow-Up", "Completed"] as const).map((option) => <button className={`filter-button ${filter === option ? "active" : ""}`} key={option} onClick={() => setFilter(option)}>{option}<span>{option === "All" ? visibleRequests.length : (mode === "client" ? portalRequests : requests).filter((request) => request.status === option).length}</span></button>)}</div>
      <div className="request-documents-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{mode === "client" ? "Your demo documents" : "Recent documents"}</h2>
              <p className="muted">Metadata only — no real documents are stored here.</p>
            </div>
          </div>
          <div className="audit-log-list">
            {(mode === "client" ? portalDocuments : documents).slice(0, 6).map((document) => (
              <div className="audit-log-row" key={document.id}>
                <strong>{document.name}</strong>
                <span>{document.type} · {document.date}</span>
                <span>{document.reviewStatus}{document.matchStatus ? ` · ${document.matchStatus}` : ""}</span>
              </div>
            ))}
            {(mode === "client" ? portalDocuments : documents).length === 0 && <p className="muted">No demo documents yet.</p>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Demo activity history</h2>
              <p className="muted">Temporary browser-session activity only.</p>
            </div>
          </div>
          <div className="audit-log-list">
            {auditEvents.slice(0, 8).map((event) => (
              <div className="audit-log-row" key={event.id}>
                <strong>{event.summary}</strong>
                <span>{event.actor} · {new Date(event.at).toLocaleString()}</span>
                {event.detail && <span>{event.detail}</span>}
              </div>
            ))}
            {auditEvents.length === 0 && <p className="muted">No demo client portal activity recorded yet.</p>}
          </div>
        </section>
      </div>
      {visibleRequests.length === 0 ? (
        <div className="empty-state">
          <span>✓</span>
          <h2>You're all caught up.</h2>
          <p className="muted">{mode === "client" ? "There are no requests for this simulated client right now." : "All client questions have been resolved."}</p>
        </div>
      ) : (
        <div className="request-card-grid">
          {visibleRequests.map((request) => (
            <button
              className="request-card"
              key={request.id}
              onClick={() => onSelect(request)}
            >
              <div className="request-card-top">
                <span className="company-avatar">{request.client.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{request.client}</strong>
                  <small>{request.requestType} · Created {request.dateCreated}</small>
                </span>
                <span
                  className={`inbox-status ${statusLabel(request.status)}`}
                >
                  {request.status}
                </span>
              </div>
              <div className="request-card-related">
                <strong>{request.relatedTransaction}</strong>
                <span>{request.relatedAmount}{request.dueDate ? ` · due ${formatDueDate(request.dueDate)}` : ""}</span>
              </div>
              <p>{request.question}</p>
              <small className="muted">{requestHasResponse(request) ? "Client has responded." : "Waiting for a response."} {requestDocumentIds(request, documents).length > 0 ? `${requestDocumentIds(request, documents).length} document(s) attached.` : ""}</small>
              <span className="row-arrow">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientRequestDetail({
  source,
  role,
  request,
  documents,
  transactions,
  onBack,
  onUpdate,
  onApplyResponse,
  onSendClientMessage,
  onSubmitDocument,
  onApproveRequest,
  onRejectRequest,
  onMatchReceipt,
}: {
  source: AccountSource;
  role: "bookkeeper" | "client";
  request: ClientRequest;
  documents: ClientDocument[];
  transactions: Transaction[];
  onBack: () => void;
  onUpdate: (request: ClientRequest) => void;
  onApplyResponse: (request: ClientRequest) => Promise<void>;
  onSendClientMessage: (request: ClientRequest, message: string) => void;
  onSubmitDocument: (request: ClientRequest, fixtureId: string, note: string) => void;
  onApproveRequest: (request: ClientRequest, message: string) => void;
  onRejectRequest: (request: ClientRequest, message: string) => void;
  onMatchReceipt: (request: ClientRequest, documentId: string, transactionId: string) => void;
}) {
  const answers = ["Materials", "Equipment", "Office Supplies", "Utilities", "Meals", "Travel", "Other"];
  const [applyConfirmation, setApplyConfirmation] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [fixtureId, setFixtureId] = useState(fixturesForRequest(request)[0]?.id ?? "fixture-other");
  const requestDocuments = documents;
  const responseCategory = request.responseCategory || request.answer;
  const suggestedAccount = responseCategory === "Materials" ? "Job Materials" : responseCategory;
  const receiptDocuments = requestDocuments.filter(receiptReadyForMatch);
  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All requests
      </button>
      <section className="review-header">
        <div>
          <p className="eyebrow">{role === "client" ? "SIMULATED CLIENT PORTAL" : "CLIENT REQUEST"} · <ClientName upper /></p>
          <h2>{request.relatedTransaction}</h2>
          <p className="muted">
            {request.requestType} · Created {request.dateCreated}{request.relatedAmount ? ` · ${request.relatedAmount}` : ""}{request.dueDate ? ` · due ${formatDueDate(request.dueDate)}` : ""}
          </p>
        </div>
        <span
          className={`inbox-status ${statusLabel(request.status)}`}
        >
          {request.status}
        </span>
      </section>
      <section className="request-detail-layout">
        <div className="panel request-question">
          <h2>Question for the client</h2>
          <p className="request-question-text">{request.question}</p>
          <p className="muted">{request.client}</p>
          <div className="message-thread">
            {(request.messages ?? []).map((item) => (
              <div className={`message-bubble ${item.sender === "Client" ? "client" : "bookkeeper"}`} key={item.id}>
                <strong>{item.senderLabel}</strong>
                <small>{new Date(item.sentAt).toLocaleString()}</small>
                <p>{item.message}</p>
                {item.documentIds?.length ? <span>{item.documentIds.length} attached demo document(s)</span> : null}
              </div>
            ))}
          </div>
          {request.answer ? (
            <div className="answer-box">
              <small>Latest client answer</small>
              <strong>{request.answer}</strong>
            </div>
          ) : null}
          {request.quickBooksId && responseCategory && <div className="suggestion-box"><small>Suggested QuickBooks Change</small><strong>Current: {request.currentCategory || "Uncategorized Expense"}</strong><span>Change to: {suggestedAccount}</span></div>}
          {source === "demo" && request.status !== "Completed" && (
            <>
              <div className="answer-options">
                <p className="muted">Quick response suggestions:</p>
                {answers.map((answer) => (
                  <button
                    className="category-button"
                    key={answer}
                    onClick={() => {
                      onUpdate({ ...request, status: "Client Responded", answer, responseCategory: answer });
                      onSendClientMessage({ ...request, responseCategory: answer }, answer);
                    }}
                  >
                    {answer}
                    <span>→</span>
                  </button>
                ))}
              </div>
              {role === "client" && (
              <div className="portal-compose">
                <label>
                  Reply
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type your answer or question." />
                </label>
                <div className="reset-actions">
                  <button className="primary-button" onClick={() => { if (!message.trim()) return; onSendClientMessage(request, message.trim()); setMessage(""); }}>Send response <span>→</span></button>
                </div>
              </div>
              )}
              {role === "client" && (
              <div className="portal-compose">
                <label>
                  Simulated document
                  <select value={fixtureId} onChange={(event) => setFixtureId(event.target.value)}>
                    {fixturesForRequest(request).map((fixture) => <option key={fixture.id} value={fixture.id}>{fixture.label}</option>)}
                  </select>
                </label>
                <label>
                  Note to bookkeeper
                  <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Uploading this statement for review." />
                </label>
                <div className="reset-actions">
                  <button className="secondary-button" onClick={() => { onSubmitDocument(request, fixtureId, reviewNote.trim()); setReviewNote(""); }}>Upload simulated document</button>
                </div>
              </div>
              )}
            </>
          )}
        </div>
        <div className="panel request-details">
          <h2>Request details</h2>
          <div className="detail-list">
            <span>
              <small>Client</small>
              <strong>{request.client}</strong>
            </span>
            <span>
              <small>Date created</small>
              <strong>{request.dateCreated}</strong>
            </span>
            <span>
              <small>Related transaction</small>
              <strong>{request.relatedTransaction || "None"}</strong>
            </span>
            <span>
              <small>Status</small>
              <strong>{request.status}</strong>
            </span>
            <span>
              <small>Documents</small>
              <strong>{requestDocuments.length}</strong>
            </span>
          </div>
          {requestDocuments.length > 0 && (
            <div className="audit-log-list">
              {requestDocuments.map((document) => (
                <div className="audit-log-row" key={document.id}>
                  <strong>{document.name}</strong>
                  <span>{document.type} · {document.reviewStatus}{document.matchStatus ? ` · ${document.matchStatus}` : ""}</span>
                  <span>{document.notes || "Demo fixture metadata only."}</span>
                </div>
              ))}
            </div>
          )}
          {receiptDocuments.map((document) => {
            const candidates = receiptMatchCandidates(document, transactions).slice(0, 3);
            return (
              <div className="confirmation-box" key={document.id}>
                <strong>Receipt matching</strong>
                <span>{document.name} · {document.amount || "No amount"} · {document.date}</span>
                {candidates.length === 0 ? <span>No likely matches found yet.</span> : candidates.map((candidate) => (
                  <button className="text-button" key={candidate.transactionId} onClick={() => onMatchReceipt(request, document.id, candidate.transactionId)}>
                    Match to {candidate.payee} · {candidate.amount} · {candidate.date}
                  </button>
                ))}
              </div>
            );
          })}
          {role === "bookkeeper" && request.quickBooksId && responseCategory && request.status === "Client Responded" && <><button className="primary-button resolve-button" onClick={() => setApplyConfirmation(true)}>Approve & Apply Response <span>→</span></button>{applyError && <div className="data-state-message error">{applyError}</div>}{applyConfirmation && <div className="confirmation-box"><strong>You are about to update this transaction in QuickBooks Sandbox.</strong><span>Transaction: {request.payee}</span><span>Amount: {request.amount}</span><span>Current category: {request.currentCategory}</span><span>New category: {suggestedAccount}</span><div><button className="secondary-button" onClick={() => setApplyConfirmation(false)}>Cancel</button><button className="primary-button" disabled={applying} onClick={async () => { setApplying(true); setApplyError(null); try { await onApplyResponse({ ...request, responseCategory: suggestedAccount }); setApplyConfirmation(false); } catch (error) { setApplyError(error instanceof Error ? error.message : "Unable to apply response."); } finally { setApplying(false); } }}>{applying ? "Updating..." : "Confirm Update"}</button></div></div>}</>}
          {role === "bookkeeper" && !request.quickBooksId && request.answer && request.status !== "Completed" && (
            <button
              className="primary-button resolve-button"
              onClick={() => onApproveRequest(request, reviewNote.trim() || "Thanks — this request is complete.")}
            >
              Mark Resolved <span>✓</span>
            </button>
          )}
          {role === "bookkeeper" && source === "demo" && request.status !== "Completed" && (
            <div className="portal-compose">
              <label>
                Review note
                <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Approved — thanks." />
              </label>
              <div className="reset-actions">
                <button className="secondary-button" onClick={() => onRejectRequest(request, reviewNote.trim())}>Needs follow-up</button>
                <button className="primary-button" onClick={() => onApproveRequest(request, reviewNote.trim())}>Approve & complete <span>✓</span></button>
              </div>
            </div>
          )}
          {request.status === "Completed" && (
            <div className="resolved-note">✓ This request is resolved.</div>
          )}
        </div>
      </section>
    </div>
  );
}

const invoiceFilters = ["All", "Open", "Overdue", "Partially Paid", "Paid"] as const;
const billFilters = [
  "All",
  "Open",
  "Due Soon",
  "Overdue",
  "Partially Paid",
  "Needs Review",
  "Paid",
] as const;

function Receivables({
  source,
  clientId,
  invoices,
  quickBooksInvoices,
  isLoading,
  error,
  selectedInvoice,
  paymentBooks,
  paymentDateDefault,
  onSelect,
  onBack,
  onRecordPayment,
  onReversePayment,
  onAskClient,
  onSourceChange,
}: {
  source: AccountSource;
  clientId: string;
  invoices: Invoice[];
  quickBooksInvoices: LedgerInvoice[];
  isLoading: boolean;
  error: string | null;
  selectedInvoice: Invoice | null;
  paymentBooks: DemoPaymentBook[];
  paymentDateDefault: string;
  onSelect: (invoice: Invoice) => void;
  onBack: () => void;
  onRecordPayment: (kind: DocumentPaymentKind, documentId: string, input: DemoPaymentInput) => Promise<void>;
  onReversePayment: (kind: DocumentPaymentKind, documentId: string, paymentId: string, reason: string) => Promise<void>;
  onAskClient: (question: string, transaction: string, amount: string) => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  const [filter, setFilter] = useState<(typeof invoiceFilters)[number]>("All");
  const displayedInvoices = source === "demo" ? invoices : quickBooksInvoices;
  if (selectedInvoice)
    return (
      <InvoiceDetail
        clientId={clientId}
        invoice={selectedInvoice}
        book={bookForDocument(paymentBooks, 'invoice', selectedInvoice.id, clientId)}
        originalPaidCents={Math.round(selectedInvoice.amountPaid * 100) - activePaymentCents(bookForDocument(paymentBooks, 'invoice', selectedInvoice.id, clientId))}
        dateDefault={paymentDateDefault}
        readOnly={source === "quickbooks"}
        onBack={onBack}
        onRecordPayment={(input) => onRecordPayment('invoice', selectedInvoice.id, input)}
        onReversePayment={(payment, reason) => onReversePayment('invoice', selectedInvoice.id, payment.id, reason)}
        onAskClient={onAskClient}
      />
    );
  const aging = summarizeOpenItems(displayedInvoices, new Date().toISOString().slice(0, 10));
  const filtered =
    filter === "All"
      ? displayedInvoices
      : displayedInvoices.filter((invoice) => invoice.status === filter);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Accounts Receivable</h2>
          <p className="muted"><ClientName /> · Money customers owe you. Balances are as of today; Reports show the balance at the end of the month you choose.</p>
        </div>
        <span className="count-pill">{displayedInvoices.length} invoices</span>
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {isLoading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox invoices...
        </div>
      )}
      {error && <div className="data-state-message error">{error}</div>}
      <div className="finance-summary-grid">
        <SummaryCard
          value={formatMoney(aging.totalCents / 100)}
          label="Total Outstanding"
          tone="red"
        />
        <SummaryCard value={formatMoney(aging.currentCents / 100)} label="Current (not yet due)" tone="green" />
        <SummaryCard
          value={formatMoney(aging.days1to30Cents / 100)}
          label="1-30 Days Overdue"
          tone="amber"
        />
        <SummaryCard
          value={formatMoney(aging.days31to60Cents / 100)}
          label="31-60 Days Overdue"
          tone="blue"
        />
        <SummaryCard
          value={formatMoney(aging.over60Cents / 100)}
          label="60+ Days Overdue"
          tone="purple"
        />
      </div>
      {aging.unreadable > 0 && <div className="data-state-message">{aging.unreadable} open invoice{aging.unreadable === 1 ? " has" : "s have"} no readable due date, so {aging.unreadable === 1 ? "it is" : "they are"} counted in the total but in no aging column.</div>}
      <div className="filter-row">
        {invoiceFilters.map((option) => (
          <button
            className={`filter-button ${filter === option ? "active" : ""}`}
            key={option}
            onClick={() => setFilter(option)}
          >
            {option}
            <span>
              {option === "All"
                ? displayedInvoices.length
                : displayedInvoices.filter(
                    (invoice) => invoice.status === option,
                  ).length}
            </span>
          </button>
        ))}
      </div>
      <div className="panel finance-list-panel">
        <div className="finance-list-heading">
          <span>Customer</span>
          <span>Invoice</span>
          <span>Invoice date</span>
          <span>Due date</span>
          <span>Original</span>
          <span>Remaining</span>
          <span>Status</span>
          <span />
        </div>
        {filtered.map((invoice) => (
          <button
            className="finance-list-row"
            key={invoice.id}
            onClick={() => onSelect(invoice)}
          >
            <strong>{invoice.customer}</strong>
            <span>{invoice.number}</span>
            <span>{invoice.invoiceDate}</span>
            <span>{invoice.dueDate}</span>
            <span>{formatMoney(invoice.amount)}</span>
            <strong>{formatMoney(invoice.amount - invoice.amountPaid)}</strong>
            <span
              className={`inbox-status ${invoice.status.toLowerCase().replaceAll(" ", "-")}`}
            >
              {invoice.status}
            </span>
            <span className="row-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InvoiceDetail({
  clientId,
  invoice,
  book,
  originalPaidCents,
  dateDefault,
  readOnly,
  onBack,
  onRecordPayment,
  onReversePayment,
  onAskClient,
}: {
  clientId: string;
  invoice: Invoice;
  book: DemoPaymentBook | undefined;
  originalPaidCents: number;
  dateDefault: string;
  readOnly: boolean;
  onBack: () => void;
  onRecordPayment: (input: DemoPaymentInput) => Promise<void>;
  onReversePayment: (payment: NonNullable<DemoPaymentBook['payments'][number]>, reason: string) => Promise<void>;
  onAskClient: (question: string, transaction: string, amount: string) => void;
}) {
  const remaining = invoice.amount - invoice.amountPaid;
  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All invoices
      </button>
      <section className="review-header">
        <div>
          <p className="eyebrow">ACCOUNTS RECEIVABLE · <ClientName upper /></p>
          <h2>{invoice.customer}</h2>
          <p className="muted">
            {invoice.number} · Due {invoice.dueDate}
          </p>
        </div>
        <span
          className={`inbox-status ${invoice.status.toLowerCase().replaceAll(" ", "-")}`}
        >
          {invoice.status}
        </span>
      </section>
      <section className="finance-detail-layout">
        <div className="panel">
          <h2>Invoice details</h2>
          <div className="detail-list">
            <span>
              <small>Customer</small>
              <strong>{invoice.customer}</strong>
            </span>
            <span>
              <small>Invoice number</small>
              <strong>{invoice.number}</strong>
            </span>
            <span>
              <small>Invoice date</small>
              <strong>{invoice.invoiceDate}</strong>
            </span>
            <span>
              <small>Due date</small>
              <strong>{invoice.dueDate}</strong>
            </span>
            <span>
              <small>Amount</small>
              <strong>{formatMoney(invoice.amount)}</strong>
            </span>
            <span>
              <small>Amount paid</small>
              <strong>{formatMoney(invoice.amountPaid)}</strong>
            </span>
            <span>
              <small>Amount remaining</small>
              <strong>{formatMoney(remaining)}</strong>
            </span>
            <span>
              <small>Status</small>
              <strong>{invoice.status}</strong>
            </span>
          </div>
        </div>
        <div className="panel finance-actions">
          <DocumentPaymentActions kind="invoice" clientId={clientId} book={book} originalPaidCents={originalPaidCents} amountCents={Math.round(invoice.amount * 100)} dateDefault={dateDefault} readOnly={readOnly} onRecord={onRecordPayment} onReverse={onReversePayment} />
          {!readOnly && (
            <button
              className="secondary-button"
              onClick={() =>
                onAskClient(
                  "When can we expect payment for this invoice?",
                  invoice.number,
                  formatMoney(remaining),
                )
              }
            >
              Ask Client About Invoice <span>→</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Payables({
  source,
  clientId,
  bills,
  quickBooksBills,
  isLoading,
  error,
  selectedBill,
  paymentBooks,
  paymentDateDefault,
  onSelect,
  onBack,
  onRecordPayment,
  onReversePayment,
  onAskClient,
  onSourceChange,
}: {
  source: AccountSource;
  clientId: string;
  bills: Bill[];
  quickBooksBills: LedgerBill[];
  isLoading: boolean;
  error: string | null;
  selectedBill: Bill | null;
  paymentBooks: DemoPaymentBook[];
  paymentDateDefault: string;
  onSelect: (bill: Bill) => void;
  onBack: () => void;
  onRecordPayment: (kind: DocumentPaymentKind, documentId: string, input: DemoPaymentInput) => Promise<void>;
  onReversePayment: (kind: DocumentPaymentKind, documentId: string, paymentId: string, reason: string) => Promise<void>;
  onAskClient: (question: string, transaction: string, amount: string) => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  const [filter, setFilter] = useState<(typeof billFilters)[number]>("All");
  const displayedBills = source === "demo" ? bills : quickBooksBills;
  if (selectedBill)
    return (
      <BillDetail
        clientId={clientId}
        bill={selectedBill}
        book={bookForDocument(paymentBooks, 'bill', selectedBill.id, clientId)}
        originalPaidCents={Math.round(selectedBill.amountPaid * 100) - activePaymentCents(bookForDocument(paymentBooks, 'bill', selectedBill.id, clientId))}
        dateDefault={paymentDateDefault}
        readOnly={source === "quickbooks"}
        onBack={onBack}
        onRecordPayment={(input) => onRecordPayment('bill', selectedBill.id, input)}
        onReversePayment={(payment, reason) => onReversePayment('bill', selectedBill.id, payment.id, reason)}
        onAskClient={onAskClient}
      />
    );
  const aging = summarizeOpenItems(displayedBills, new Date().toISOString().slice(0, 10));
  const filtered =
    filter === "All"
      ? displayedBills
      : displayedBills.filter((bill) => bill.status === filter);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Accounts Payable</h2>
          <p className="muted">
            <ClientName /> · Bills your company needs to pay. Balances are as of today; Reports show the balance at the end of the month you choose.
          </p>
        </div>
        <span className="count-pill">{displayedBills.length} bills</span>
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {isLoading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox bills...
        </div>
      )}
      {error && <div className="data-state-message error">{error}</div>}
      <div className="finance-summary-grid">
        <SummaryCard
          value={formatMoney(aging.totalCents / 100)}
          label="Total Bills Due"
          tone="red"
        />
        <SummaryCard
          value={formatMoney(aging.dueWithin7DaysCents / 100)}
          label="Due Within 7 Days"
          tone="amber"
        />
        <SummaryCard value={formatMoney((aging.days1to30Cents + aging.days31to60Cents + aging.over60Cents) / 100)} label="Overdue" tone="purple" />
        <SummaryCard
          value={formatMoney(aging.paidCents / 100)}
          label="Paid So Far"
          tone="green"
        />
      </div>
      {aging.unreadable > 0 && <div className="data-state-message">{aging.unreadable} open bill{aging.unreadable === 1 ? " has" : "s have"} no readable due date, so {aging.unreadable === 1 ? "it is" : "they are"} counted in the total but not in the overdue or due-soon figures.</div>}
      <div className="filter-row">
        {billFilters.map((option) => (
          <button
            className={`filter-button ${filter === option ? "active" : ""}`}
            key={option}
            onClick={() => setFilter(option)}
          >
            {option}
            <span>
              {option === "All"
                ? displayedBills.length
                : displayedBills.filter((bill) => bill.status === option)
                    .length}
            </span>
          </button>
        ))}
      </div>
      <div className="panel finance-list-panel">
        <div className="finance-list-heading">
          <span>Vendor</span>
          <span>Bill</span>
          <span>Bill date</span>
          <span>Due date</span>
          <span>Amount</span>
          <span>Remaining</span>
          <span>Status</span>
          <span />
        </div>
        {filtered.map((bill) => (
          <button
            className="finance-list-row"
            key={bill.id}
            onClick={() => onSelect(bill)}
          >
            <strong>{bill.vendor}</strong>
            <span>{bill.number}</span>
            <span>{bill.billDate}</span>
            <span>{bill.dueDate}</span>
            <span>{formatMoney(bill.amount)}</span>
            <strong>{formatMoney(bill.amount - bill.amountPaid)}</strong>
            <span
              className={`inbox-status ${bill.status.toLowerCase().replaceAll(" ", "-")}`}
            >
              {bill.status}
            </span>
            <span className="row-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BillDetail({
  clientId,
  bill,
  book,
  originalPaidCents,
  dateDefault,
  readOnly,
  onBack,
  onRecordPayment,
  onReversePayment,
  onAskClient,
}: {
  clientId: string;
  bill: Bill;
  book: DemoPaymentBook | undefined;
  originalPaidCents: number;
  dateDefault: string;
  readOnly: boolean;
  onBack: () => void;
  onRecordPayment: (input: DemoPaymentInput) => Promise<void>;
  onReversePayment: (payment: DemoPaymentBook['payments'][number], reason: string) => Promise<void>;
  onAskClient: (question: string, transaction: string, amount: string) => void;
}) {
  const remaining = bill.amount - bill.amountPaid;
  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All bills
      </button>
      <section className="review-header">
        <div>
          <p className="eyebrow">ACCOUNTS PAYABLE · <ClientName upper /></p>
          <h2>{bill.vendor}</h2>
          <p className="muted">
            {bill.number} · Due {bill.dueDate}
          </p>
        </div>
        <span
          className={`inbox-status ${bill.status.toLowerCase().replaceAll(" ", "-")}`}
        >
          {bill.status}
        </span>
      </section>
      <section className="finance-detail-layout">
        <div className="panel">
          <h2>Bill details</h2>
          <div className="detail-list">
            <span>
              <small>Vendor</small>
              <strong>{bill.vendor}</strong>
            </span>
            <span>
              <small>Bill number</small>
              <strong>{bill.number}</strong>
            </span>
            <span>
              <small>Bill date</small>
              <strong>{bill.billDate}</strong>
            </span>
            <span>
              <small>Due date</small>
              <strong>{bill.dueDate}</strong>
            </span>
            <span>
              <small>Amount</small>
              <strong>{formatMoney(bill.amount)}</strong>
            </span>
            <span>
              <small>Amount paid</small>
              <strong>{formatMoney(bill.amountPaid)}</strong>
            </span>
            <span>
              <small>Amount remaining</small>
              <strong>{formatMoney(remaining)}</strong>
            </span>
            <span>
              <small>Category</small>
              <strong>{bill.category}</strong>
            </span>
            <span>
              <small>Status</small>
              <strong>{bill.status}</strong>
            </span>
          </div>
        </div>
        <div className="panel finance-actions">
          <DocumentPaymentActions kind="bill" clientId={clientId} book={book} originalPaidCents={originalPaidCents} amountCents={Math.round(bill.amount * 100)} dateDefault={dateDefault} readOnly={readOnly} onRecord={onRecordPayment} onReverse={onReversePayment} />
          {!readOnly && (
            <button
              className="secondary-button"
              onClick={() =>
                onAskClient(
                  "Can you clarify this bill?",
                  bill.number,
                  formatMoney(remaining),
                )
              }
            >
              Ask Client <span>→</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

const transactionFilters = [
  "All",
  "Needs Review",
  "Categorized",
  "Matched",
  "Needs Receipt",
] as const;
type CategoryOption = { id?: string; name: string };

function Transactions({
  transactions,
  quickBooksTransactions,
  source,
  clientId,
  categoryOptions,
  isLoading,
  error,
  rules,
  onSourceChange,
  selectedTransaction,
  onSelect,
  onBack,
  onApplyChanges,
  onReload,
  onRequestInformation,
  onCreateQuickBooksRequest,
  onLogSuggestion,
}: {
  transactions: Transaction[];
  quickBooksTransactions: LedgerTransaction[];
  source: TransactionSource;
  clientId: string | null;
  categoryOptions: CategoryOption[];
  isLoading: boolean;
  error: string | null;
  rules: AutomationRule[];
  onSourceChange: (source: TransactionSource) => void;
  selectedTransaction: Transaction | null;
  onSelect: (transaction: Transaction) => void;
  onBack: () => void;
  onApplyChanges: (transaction: Transaction, changes: LineChange[]) => Promise<Transaction>;
  onReload: (transaction: Transaction) => Promise<void>;
  onRequestInformation: (transaction: Transaction) => void;
  onCreateQuickBooksRequest: (transaction: LedgerTransaction, question: string) => void;
  onLogSuggestion: (event: Omit<AutomationAuditEvent, "id" | "at" | "source" | "clientId">) => void;
}) {
  const [filter, setFilter] =
    useState<(typeof transactionFilters)[number]>("All");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("Needs Review");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const everything = source === "demo" ? transactions : quickBooksTransactions;
  // Search, category and client narrow both the list and the review queue; status only narrows the list.
  const scoped = filterTransactions(everything, { clientId, category, search });
  const reviewQueue = scoped.filter((transaction) => matchesReviewFilter(transaction, reviewFilter));

  if (selectedTransaction) {
    const current = everything.find((item) => item.id === selectedTransaction.id) ?? selectedTransaction;
    return (
      <TransactionReview
        key={current.id}
        transaction={current}
        source={source}
        rules={rules}
        categoryOptions={categoryOptions}
        history={everything}
        ordered={scoped}
        queue={reviewQueue}
        onBack={onBack}
        onSelect={onSelect}
        onApplyChanges={onApplyChanges}
        onReload={onReload}
        onRequestInformation={onRequestInformation}
        onCreateQuickBooksRequest={onCreateQuickBooksRequest}
        onLogSuggestion={onLogSuggestion}
      />
    );
  }

  const filteredTransactions = filterTransactions(scoped, { status: filter });
  const attentionCount = scoped.filter(
    (transaction) =>
      transaction.status === "Needs Review" ||
      transaction.status === "Needs Receipt",
  ).length;

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Transactions</h2>
          <p className="muted">
            Review <ClientName />'s recent activity one item at a time.
          </p>
        </div>
        <span className="attention-summary">
          <strong>{attentionCount}</strong> need attention
        </span>
      </section>
      <div className="data-source-switch" aria-label="Transaction data source">
        <span>Data source</span>
        <button
          className={source === "demo" ? "active" : ""}
          onClick={() => onSourceChange("demo")}
        >
          Demo Data
        </button>
        <button
          className={source === "quickbooks" ? "active" : ""}
          onClick={() => onSourceChange("quickbooks")}
        >
          QuickBooks Sandbox
        </button>
      </div>
      {isLoading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox transactions...
        </div>
      )}
      {error && <div className="data-state-message error">{error}</div>}
      <div className="queue-filters">
        <label>
          Search
          <input type="search" value={search} placeholder="Vendor or description" aria-label="Search transactions" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          Category
          <select value={category} aria-label="Filter by category" onChange={(event) => setCategory(event.target.value)}>
            <option value="All">All categories</option>
            {categoriesIn(everything).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <button className="primary-button" disabled={reviewQueue.length === 0} onClick={() => onSelect(reviewQueue[0])}>
          Review next ({reviewQueue.length}) <span>→</span>
        </button>
      </div>
      <div className="filter-row" aria-label="Transaction filters">
        {transactionFilters.map((filterOption) => (
          <button
            className={`filter-button ${filter === filterOption ? "active" : ""}`}
            key={filterOption}
            onClick={() => setFilter(filterOption)}
          >
            {filterOption}
            <span>{filterTransactions(scoped, { status: filterOption }).length}</span>
          </button>
        ))}
      </div>
      <div className="filter-row" aria-label="Review queue filters">
        {reviewFilters.map((option) => (
          <button className={`filter-button ${reviewFilter === option ? "active" : ""}`} key={option} onClick={() => setReviewFilter(option)}>
            {option}
            <span>{scoped.filter((transaction) => matchesReviewFilter(transaction, option)).length}</span>
          </button>
        ))}
      </div>
      <div className="panel transaction-panel">
        <div className="transaction-heading">
          <span>Date</span>
          <span>Payee</span>
          <span>Description</span>
          <span>Amount</span>
          <span>Category</span>
          <span>Status</span>
          <span />
        </div>
        {filteredTransactions.length === 0 && <p className="muted">No transactions match these filters.</p>}
        {filteredTransactions.map((transaction) => (
          <button
            className="transaction-row"
            key={transaction.id}
            onClick={() => onSelect(transaction)}
          >
            <span>{transaction.date}</span>
            <strong>{transaction.payee}</strong>
            <span>{transaction.description}</span>
            <strong>{transaction.amount}</strong>
            <span>{categoryLabel(transaction)}</span>
            <span
              className={`transaction-status ${statusClass(transaction.status)}`}
            >
              {transaction.status}
            </span>
            <span className="row-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TransactionReview({
  transaction,
  source,
  rules,
  categoryOptions,
  history,
  ordered,
  queue,
  onBack,
  onSelect,
  onApplyChanges,
  onReload,
  onRequestInformation,
  onCreateQuickBooksRequest,
  onLogSuggestion,
}: {
  transaction: LedgerTransaction;
  source: TransactionSource;
  rules: AutomationRule[];
  categoryOptions: CategoryOption[];
  history: Transaction[];
  ordered: Transaction[];
  queue: Transaction[];
  onBack: () => void;
  onSelect: (transaction: Transaction) => void;
  onApplyChanges: (transaction: Transaction, changes: LineChange[]) => Promise<Transaction>;
  onReload: (transaction: Transaction) => Promise<void>;
  onRequestInformation: (transaction: Transaction) => void;
  onCreateQuickBooksRequest: (transaction: LedgerTransaction, question: string) => void;
  onLogSuggestion: (event: Omit<AutomationAuditEvent, "id" | "at" | "source" | "clientId">) => void;
}) {
  const isQuickBooks = source === "quickbooks";
  const lines = getLines(transaction);
  const readOnlyReason = transaction.readOnlyReason;
  const suggestions = suggestCategories(transaction, history);
  const ruleMatch = lines.length === 1 ? bestRuleMatch(rules, transaction) : null;
  const [staged, setStaged] = useState<Record<string, string>>({});
  const [question, setQuestion] = useState("What was this purchase for?");
  const [showRequestComposer, setShowRequestComposer] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<{ message: string; code?: string } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [dismissedRule, setDismissedRule] = useState(false);
  const loggedSuggestionRef = useRef<string | null>(null);

  const optionFor = (name: string) => categoryOptions.find((option) => option.name === name);
  const changes: LineChange[] = lines.flatMap((line) => {
    const name = staged[line.id];
    return name && name !== line.category ? [{ lineId: line.id, category: name, categoryId: optionFor(name)?.id }] : [];
  });
  const validation = changes.length > 0 ? validateLineChanges(transaction, changes) : null;
  const next = adjacentInQueue(ordered, queue, transaction.id, "next");
  const previous = adjacentInQueue(ordered, queue, transaction.id, "previous");
  const completedCount = Math.max(0, ordered.length - queue.length);
  const usable = lines.filter((line) => suggestions[line.id] && !staged[line.id] && optionFor(suggestions[line.id].category));
  const ruleSuggestionId = ruleMatch ? `${transaction.id}:${ruleMatch.rule.id}` : null;
  const ruleSuggestionName = ruleMatch?.rule.name;
  const ruleSuggestionCategory = ruleMatch?.rule.category;
  const ruleSuggestionMemo = ruleMatch?.rule.memo;
  useEffect(() => {
    setDismissedRule(false);
    if (ruleSuggestionId && ruleSuggestionName && ruleSuggestionCategory) {
      if (loggedSuggestionRef.current === ruleSuggestionId) return;
      loggedSuggestionRef.current = ruleSuggestionId;
      onLogSuggestion({
        kind: "suggestion-generated",
        summary: `Generated rule suggestion "${ruleSuggestionName}" for ${transaction.payee}.`,
        detail: `Suggested ${ruleSuggestionCategory}${ruleSuggestionMemo ? ` with memo "${ruleSuggestionMemo}"` : ""}.`,
        referenceId: ruleSuggestionId,
      });
    }
  }, [onLogSuggestion, ruleSuggestionCategory, ruleSuggestionId, ruleSuggestionMemo, ruleSuggestionName, transaction.payee]);
  const stage = (lineId: string, name: string) => {
    setStaged((current) => {
      const rest = { ...current };
      if (name) rest[lineId] = name;
      else delete rest[lineId];
      return rest;
    });
    setUpdateError(null);
    setSavedCount(0);
    setShowConfirmation(false);
  };
  const requestInformation = () => (isQuickBooks ? setShowRequestComposer(true) : onRequestInformation(transaction));
  const confirmUpdate = async () => {
    setUpdating(true);
    setUpdateError(null);
    try {
      await onApplyChanges(transaction, changes);
      if (ruleMatch && changes.some((change) => change.category === ruleMatch.rule.category)) {
        onLogSuggestion({
          kind: "suggestion-accepted",
          summary: `Accepted rule suggestion "${ruleMatch.rule.name}".`,
          detail: `Suggested ${ruleMatch.rule.category} for ${transaction.payee}.`,
          referenceId: `${transaction.id}:${ruleMatch.rule.id}:accepted`,
        });
      }
      setStaged({});
      setShowConfirmation(false);
      setSavedCount(changes.length);
    } catch (error) {
      setUpdateError({ message: error instanceof Error ? error.message : "The update could not be completed.", code: (error as { code?: string }).code });
    } finally {
      setUpdating(false);
    }
  };
  const needsReload = isQuickBooks && updateError && ["STALE", "VERIFY_FAILED", "UNAVAILABLE"].includes(updateError.code ?? "");
  const dismissRuleSuggestion = () => {
    if (!ruleMatch) return;
    setDismissedRule(true);
    onLogSuggestion({
      kind: "suggestion-rejected",
      summary: `Rejected rule suggestion "${ruleMatch.rule.name}".`,
      detail: `Kept reviewing ${transaction.payee} manually.`,
      referenceId: `${transaction.id}:${ruleMatch.rule.id}:rejected`,
    });
  };

  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All transactions
      </button>
      <section className="review-header">
        <div>
          <p className="eyebrow">TRANSACTION REVIEW</p>
          <h2>{transaction.payee}</h2>
          <p className="muted">
            {transaction.date} · {transaction.amount}
          </p>
        </div>
        <span
          className={`transaction-status ${statusClass(transaction.status)}`}
        >
          {transaction.status}
        </span>
      </section>
      <div className="review-progress-bar"><strong>{queue.length} transactions need review</strong><span>Progress: {completedCount} of {ordered.length} completed</span><div><span style={{ width: `${ordered.length ? (completedCount / ordered.length) * 100 : 0}%` }} /></div></div>
      <div className="review-navigation">
        <button className="secondary-button" disabled={!previous} onClick={() => previous && onSelect(previous)}>Previous</button>
        <button className="secondary-button" disabled={!next} onClick={() => next && onSelect(next)}>Next</button>
        <button className="secondary-button" disabled={!next} onClick={() => next && onSelect(next)}>Skip</button>
      </div>
      <section className="review-layout">
        <div className="panel review-details">
          <h2>Transaction details</h2>
          <div className="detail-list">
            <span>
              <small>Date</small>
              <strong>{transaction.date}</strong>
            </span>
            <span>
              <small>Vendor / payee</small>
              <strong>{transaction.payee}</strong>
            </span>
            <span>
              <small>Amount</small>
              <strong>{transaction.amount}</strong>
            </span>
            <span>
              <small>Account (paid from)</small>
              <strong>{transaction.account || NOT_AVAILABLE}</strong>
            </span>
            <span>
              <small>Category</small>
              <strong>{categoryLabel(transaction)}</strong>
            </span>
            <span>
              <small>Description / memo</small>
              <strong>{transaction.description}</strong>
            </span>
            <span>
              <small>Lines</small>
              <strong>{lines.length}</strong>
            </span>
            <span>
              <small>Review status</small>
              <strong>{transaction.status}</strong>
            </span>
          </div>
        </div>
        <div className="panel review-choice">
          <h2>{lines.length > 1 ? "Split transaction lines" : "Transaction line"}</h2>
          <p className="muted">{isQuickBooks ? "QuickBooks Sandbox · Write Enabled · Test Data Only" : "Demo data · changes stay in this browser session"}</p>
          {readOnlyReason && <p className="data-state-message" role="status">Read-only: {readOnlyReason}</p>}
          <div className="line-list">
            {lines.map((line, index) => {
              const suggestion = suggestions[line.id];
              const stagedName = staged[line.id];
              const suggestionOption = suggestion ? optionFor(suggestion.category) : undefined;
              return (
                <div className="line-card" key={line.id} data-testid="transaction-line">
                  <div className="line-card-head">
                    <strong>{lines.length > 1 ? `Line ${index + 1}: ` : ""}{line.description || "No description"}</strong>
                    <strong>{formatMoney(line.amount)}</strong>
                  </div>
                  <div className="line-card-body">
                    <span><small>Confirmed category</small><strong>{isUncategorized(line.category) ? "Needs a category" : line.category}</strong></span>
                    {stagedName && <span><small>Staged change (not saved)</small><strong>{stagedName}</strong></span>}
                  </div>
                  {ruleMatch && !readOnlyReason && !dismissedRule && !stagedName && (
                    <div className="suggestion-box" data-testid="rule-suggestion">
                      <small>Rule matched, not applied</small>
                      <strong>{ruleMatch.rule.category}</strong>
                      <span>Rule: {ruleMatch.rule.name}</span>
                      <span>Review priority: {ruleMatch.rule.reviewPriority}</span>
                      {ruleMatch.rule.memo && <span>Suggested memo: {ruleMatch.rule.memo}</span>}
                      <ul className="reason-list">{ruleMatch.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                      <div className="reset-actions">
                        <button className="secondary-button" disabled={!optionFor(ruleMatch.rule.category)} onClick={() => stage(line.id, ruleMatch.rule.category)}>
                          {optionFor(ruleMatch.rule.category) ? "Use rule suggestion" : "Category unavailable"}
                        </button>
                        <button className="text-button" onClick={dismissRuleSuggestion}>Dismiss</button>
                      </div>
                    </div>
                  )}
                  {suggestion && !readOnlyReason && !stagedName && (
                    <div className="suggestion-box">
                      <small>Suggested, not applied</small>
                      <strong>{suggestion.category}</strong>
                      <span>Confidence: {suggestion.confidence}</span>
                      <ul className="reason-list">{suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                      <button className="secondary-button" disabled={!suggestionOption} onClick={() => stage(line.id, suggestion.category)}>
                        {suggestionOption ? "Use suggestion" : "Account not available"}
                      </button>
                    </div>
                  )}
                  {!readOnlyReason && (
                    <label className="line-picker">
                      Change category
                      <select aria-label={`Category for ${line.description || `line ${index + 1}`}`} value={stagedName ?? ""} onChange={(event) => stage(line.id, event.target.value)}>
                        <option value="">Keep current</option>
                        {categoryOptions.map((option) => <option key={option.id ?? option.name} value={option.name}>{option.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {!readOnlyReason && (
            <>
              {usable.length > 1 && (
                <button className="secondary-button" onClick={() => usable.forEach((line) => stage(line.id, suggestions[line.id].category))}>
                  Stage all {usable.length} suggestions <span>✓</span>
                </button>
              )}
              {changes.length > 0 && (
                <div className="change-preview">
                  <strong>Change preview</strong>
                  {changes.map((change) => {
                    const line = lines.find((item) => item.id === change.lineId)!;
                    return <span key={change.lineId}>{line.description || "Line"}: {line.category} → {change.category}</span>;
                  })}
                  <span>Transaction total stays {transaction.amount}</span>
                </div>
              )}
              {validation && !validation.ok && <div className="data-state-message error" role="alert">{validation.error}</div>}
              {savedCount > 0 && <div className="data-state-message" role="status">{isQuickBooks ? "Updated in QuickBooks Sandbox" : "Saved (demo data only)"} · {savedCount} {savedCount === 1 ? "line" : "lines"}</div>}
              {updateError && (
                <div className="data-state-message error" role="alert">
                  {updateError.message}
                  {needsReload && <button className="secondary-button" onClick={() => void onReload(transaction)}>Reload from QuickBooks</button>}
                </div>
              )}
              <button className="primary-button" disabled={!validation?.ok || updating} onClick={() => setShowConfirmation(true)}>
                Review {changes.length || ""} {changes.length === 1 ? "change" : "changes"} <span>→</span>
              </button>
              {showConfirmation && validation?.ok && (
                <div className="confirmation-box">
                  <strong>{isQuickBooks ? "You are about to update this transaction in QuickBooks Sandbox." : "Save these changes to the demo transaction?"}</strong>
                  <span>Transaction: {transaction.payee} · {transaction.amount}</span>
                  {changes.map((change) => {
                    const line = lines.find((item) => item.id === change.lineId)!;
                    return <span key={change.lineId}>{line.description || "Line"} ({formatMoney(line.amount)}): {line.category} → {change.category}</span>;
                  })}
                  <span>Other lines will not change.</span>
                  <div>
                    <button className="secondary-button" onClick={() => setShowConfirmation(false)}>Cancel</button>
                    <button className="primary-button" disabled={updating} onClick={confirmUpdate}>{updating ? "Updating..." : isQuickBooks ? "Confirm update" : "Confirm (demo)"}</button>
                  </div>
                </div>
              )}
            </>
          )}
          {savedCount > 0 && next && <button className="primary-button" onClick={() => onSelect(next)}>Open next transaction needing review <span>→</span></button>}
          {showRequestComposer && <div className="confirmation-box"><strong>Ask the client</strong><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><div><button className="secondary-button" onClick={() => setShowRequestComposer(false)}>Cancel</button><button className="primary-button" onClick={() => { onCreateQuickBooksRequest(transaction, question); setShowRequestComposer(false); }}>Save Request</button></div></div>}
          <button className="secondary-button" onClick={requestInformation}>
            Request More Information <span>→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function statusClass(status: Transaction["status"]) {
  return status.toLowerCase().replaceAll(" ", "-");
}

function Settings({
  quickBooksStatus,
  company,
  onStatusChange,
  onCompanyChange,
  auditLog,
  selectedClientId,
  selectedClientName,
  source,
  rules,
  rulePreviewTransactions,
  automationEvents,
  recurringPatterns,
  categoryOptions,
  onSaveRule,
  onToggleRule,
  onDeleteRule,
  onReset,
}: {
  quickBooksStatus: QuickBooksStatus;
  company: QuickBooksCompany | null;
  onStatusChange: (status: QuickBooksStatus) => void;
  onCompanyChange: (company: QuickBooksCompany) => void;
  auditLog: AuditLogEntry[];
  selectedClientId: string;
  selectedClientName: string;
  source: "demo" | "quickbooks";
  rules: AutomationRule[];
  rulePreviewTransactions: Transaction[];
  automationEvents: AutomationAuditEvent[];
  recurringPatterns: RecurringPattern[];
  categoryOptions: CategoryOption[];
  onSaveRule: (draft: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "source" | "clientId"> & { id?: string }) => void;
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onDeleteRule: (ruleId: string) => void;
  onReset: (clientIds: string[]) => void;
}) {
  type RuleDraft = Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "source" | "clientId"> & { id?: string };
  type RuleFormState = {
    name: string;
    enabled: boolean;
    priority: number;
    payeeContains: string;
    descriptionContains: string;
    minAmount: string;
    maxAmount: string;
    transactionKind: "Any" | "Expense" | "Deposit";
    category: string;
    memo: string;
    reviewPriority: TaskPriority;
  };

  const [error, setError] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [resetTarget, setResetTarget] = useState(selectedClientId ?? DEMO_RESET_CLIENTS[0].id);
  const [resetReview, setResetReview] = useState<string[] | null>(null);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormState>({
    name: "",
    enabled: true,
    priority: 1,
    payeeContains: "",
    descriptionContains: "",
    minAmount: "",
    maxAmount: "",
    transactionKind: "Any" as const,
    category: "",
    memo: "",
    reviewPriority: "Medium" as TaskPriority,
  });
  const [ruleErrors, setRuleErrors] = useState<Partial<Record<"name" | "criteria" | "amount" | "category" | "priority", string>>>({});

  useEffect(() => {
    quickBooksService
      .getStatus()
      .then(onStatusChange)
      .catch(() =>
        setError("Start the backend server to check QuickBooks status."),
      );
  }, [onStatusChange]);

  const reviewReset = () => {
    setResetReview(resetTarget === "all" ? DEMO_RESET_CLIENTS.map((client) => client.id) : [resetTarget]);
    setResetConfirmed(false);
    setResetError(null);
    setResetSuccess(null);
  };

  const confirmReset = async () => {
    if (!resetReview || !resetConfirmed) return;
    setResetLoading(true);
    setResetError(null);
    setResetSuccess(null);
    try {
      await demoResetService.reset(resetReview);
      const names = DEMO_RESET_CLIENTS.filter((client) => resetReview.includes(client.id)).map((client) => client.name);
      onReset(resetReview);
      setResetReview(null);
      setResetSuccess(`Demo data restored for ${names.join(", ")}.`);
    } catch (resetFailure) {
      setResetError(resetFailure instanceof Error ? resetFailure.message : "Demo data could not be reset. No changes were kept.");
    } finally {
      setResetLoading(false);
    }
  };

  const loadCompany = async () => {
    setLoadingCompany(true);
    setError(null);
    try {
      onCompanyChange(await quickBooksService.getCompany());
    } catch (companyError) {
      setError(
        companyError instanceof Error
          ? companyError.message
          : "Unable to load company information.",
      );
    } finally {
      setLoadingCompany(false);
    }
  };

  const resetRuleForm = () => {
    setEditingRuleId(null);
    setRuleErrors({});
    setRuleForm({
      name: "",
      enabled: true,
      priority: Math.max(1, rules.length + 1),
      payeeContains: "",
      descriptionContains: "",
      minAmount: "",
      maxAmount: "",
      transactionKind: "Any",
      category: categoryOptions[0]?.name ?? "",
      memo: "",
      reviewPriority: "Medium",
    });
  };
  const effectiveCategory = ruleForm.category || categoryOptions[0]?.name || "";

  const editRule = (rule: AutomationRule) => {
    setEditingRuleId(rule.id);
    setRuleErrors({});
    setRuleForm({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      payeeContains: rule.payeeContains ?? "",
      descriptionContains: rule.descriptionContains ?? "",
      minAmount: rule.minAmountCents !== undefined ? (rule.minAmountCents / 100).toFixed(2) : "",
      maxAmount: rule.maxAmountCents !== undefined ? (rule.maxAmountCents / 100).toFixed(2) : "",
      transactionKind: rule.transactionKind,
      category: rule.category,
      memo: rule.memo ?? "",
      reviewPriority: rule.reviewPriority,
    });
  };

  const currentDraft: RuleDraft = {
    id: editingRuleId ?? undefined,
    name: ruleForm.name.trim(),
    enabled: ruleForm.enabled,
    priority: Number(ruleForm.priority),
    payeeContains: ruleForm.payeeContains.trim() || undefined,
    descriptionContains: ruleForm.descriptionContains.trim() || undefined,
    minAmountCents: ruleForm.minAmount ? Math.round(Number(ruleForm.minAmount) * 100) : undefined,
    maxAmountCents: ruleForm.maxAmount ? Math.round(Number(ruleForm.maxAmount) * 100) : undefined,
    transactionKind: ruleForm.transactionKind,
    category: effectiveCategory,
    memo: ruleForm.memo.trim() || undefined,
    reviewPriority: ruleForm.reviewPriority,
  };
  const previewMatches = currentDraft.name
    ? previewRule({
        source,
        clientId: selectedClientId,
        createdAt: "preview",
        updatedAt: "preview",
        ...currentDraft,
        id: editingRuleId ?? "preview",
      }, rulePreviewTransactions)
    : [];

  const submitRule = () => {
    const errors = validateRuleInput({ source, clientId: selectedClientId, createdAt: "", updatedAt: "", ...currentDraft, id: editingRuleId ?? "draft" });
    setRuleErrors(errors);
    if (Object.keys(errors).length > 0) return;
    onSaveRule(currentDraft);
    resetRuleForm();
  };

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
    [rules],
  );

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Settings</h2>
          <p className="muted">
            Connect LedgerOps to a QuickBooks Online sandbox.
          </p>
        </div>
      </section>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-card-heading">
            <div className="account-icon">QB</div>
            <div>
              <h2>QuickBooks Online</h2>
              <p className="muted">Sandbox connection</p>
            </div>
          </div>
          <div className="settings-status">
            <span>Status</span>
            <strong
              className={
                quickBooksStatus.connected ? "connected" : "not-connected"
              }
            >
              {quickBooksStatus.connected ? "Connected" : "Not Connected"}
            </strong>
          </div>
          {!quickBooksStatus.connected ? (
            <button
              className="primary-button"
              onClick={() =>
                quickBooksService.connect().catch((connectError: unknown) =>
                  setError(
                    connectError instanceof Error
                      ? connectError.message
                      : "Unable to start the QuickBooks connection.",
                  ),
                )
              }
            >
              Connect QuickBooks <span>→</span>
            </button>
          ) : (
            <button
              className="secondary-button"
              onClick={loadCompany}
              disabled={loadingCompany}
            >
              {loadingCompany ? "Loading company info..." : "Load Company Info"}{" "}
              <span>→</span>
            </button>
          )}
          {error && <p className="settings-error">{error}</p>}
          {company && (
            <div className="company-info">
              <h3>Company information</h3>
              <div className="detail-list">
                <span>
                  <small>Company Name</small>
                  <strong>{company.CompanyName || "Not provided"}</strong>
                </span>
                <span>
                  <small>Legal Name</small>
                  <strong>{company.LegalName || "Not provided"}</strong>
                </span>
                <span>
                  <small>Country</small>
                  <strong>{company.Country || "Not provided"}</strong>
                </span>
                <span>
                  <small>Fiscal Year Start Month</small>
                  <strong>
                    {company.FiscalYearStartMonth || "Not provided"}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </section>
        <section className="panel settings-card automation-rules-card">
          <h2>Automation Rules</h2>
          <p className="muted">Create reusable suggestions for {selectedClientName}. Rules never post accounting changes automatically.</p>
          <div className="detail-list">
            <span><small>Scope</small><strong>{selectedClientName}</strong></span>
            <span><small>Data source</small><strong>{source === "demo" ? "Demo data" : "QuickBooks Sandbox"}</strong></span>
          </div>
          <div className="queue-filters">
            <label>
              Rule name
              <input value={ruleForm.name} onChange={(event) => setRuleForm({ ...ruleForm, name: event.target.value })} placeholder="Home Depot materials" />
            </label>
            <label>
              Priority
              <input type="number" min={1} value={ruleForm.priority} onChange={(event) => setRuleForm({ ...ruleForm, priority: Number(event.target.value) || 1 })} />
            </label>
            <label>
              Transaction kind
              <select value={ruleForm.transactionKind} onChange={(event) => setRuleForm({ ...ruleForm, transactionKind: event.target.value as "Any" | "Expense" | "Deposit" })}>
                <option value="Any">Any</option>
                <option value="Expense">Expense</option>
                <option value="Deposit">Deposit</option>
              </select>
            </label>
            <label>
              Review priority
              <select value={ruleForm.reviewPriority} onChange={(event) => setRuleForm({ ...ruleForm, reviewPriority: event.target.value as TaskPriority })}>
                {taskPriorities.map((priority, index) => <option key={`${priority}-${index}`} value={priority}>{priority}</option>)}
              </select>
            </label>
          </div>
          <div className="queue-filters">
            <label>
              Vendor / payee contains
              <input value={ruleForm.payeeContains} onChange={(event) => setRuleForm({ ...ruleForm, payeeContains: event.target.value })} placeholder="Home Depot" />
            </label>
            <label>
              Description or memo contains
              <input value={ruleForm.descriptionContains} onChange={(event) => setRuleForm({ ...ruleForm, descriptionContains: event.target.value })} placeholder="materials" />
            </label>
            <label>
              Minimum amount
              <input value={ruleForm.minAmount} onChange={(event) => setRuleForm({ ...ruleForm, minAmount: event.target.value })} placeholder="0.00" />
            </label>
            <label>
              Maximum amount
              <input value={ruleForm.maxAmount} onChange={(event) => setRuleForm({ ...ruleForm, maxAmount: event.target.value })} placeholder="999.99" />
            </label>
          </div>
          <div className="queue-filters">
            <label>
              Suggested category
              <select value={effectiveCategory} onChange={(event) => setRuleForm({ ...ruleForm, category: event.target.value })}>
                {categoryOptions.map((option, index) => <option key={`${option.id ?? option.name}-${index}`} value={option.name}>{option.name}</option>)}
              </select>
            </label>
            <label>
              Optional memo
              <input value={ruleForm.memo} onChange={(event) => setRuleForm({ ...ruleForm, memo: event.target.value })} placeholder="Job materials purchase" />
            </label>
            <label>
              <span>Enabled</span>
              <input type="checkbox" checked={ruleForm.enabled} onChange={(event) => setRuleForm({ ...ruleForm, enabled: event.target.checked })} />
            </label>
          </div>
          {(ruleErrors.name || ruleErrors.criteria || ruleErrors.amount || ruleErrors.category || ruleErrors.priority) && <p className="settings-error" role="alert">{ruleErrors.name || ruleErrors.criteria || ruleErrors.amount || ruleErrors.category || ruleErrors.priority}</p>}
          <div className="reset-actions">
            <button className="secondary-button" onClick={resetRuleForm}>{editingRuleId ? "Cancel edit" : "Clear rule"}</button>
            <button className="primary-button" onClick={submitRule}>{editingRuleId ? "Save rule" : "Create rule"}</button>
          </div>
          <div className="panel automation-preview-panel" data-testid="rule-preview">
            <h3>Preview matches</h3>
            {previewMatches.length === 0 ? <p className="muted">No current transactions match this rule yet.</p> : <div className="audit-log-list">{previewMatches.slice(0, 5).map((match, index) => <div className="audit-log-row" key={`${match.transactionId}-${index}`}><strong>{match.payee}</strong><span>{match.date} · {match.amount}</span><span>{match.reasons[0]}</span></div>)}</div>}
          </div>
          <div className="audit-log-list" data-testid="rules-list">
            {sortedRules.length === 0 ? <p className="muted">No rules saved for this client yet.</p> : sortedRules.map((rule, index) => {
              const matches = previewRule(rule, rulePreviewTransactions);
              return <div className="audit-log-row" key={`${rule.id}-${index}`} data-testid="rule-row"><strong>{rule.name}</strong><span>{rule.enabled ? "Enabled" : "Disabled"} · Priority {rule.priority} · {rule.reviewPriority}</span><span>{rule.category}{rule.memo ? ` · Memo: ${rule.memo}` : ""}</span><span>{matches.length} current match{matches.length === 1 ? "" : "es"}</span><div className="reset-actions"><button className="text-button" onClick={() => editRule(rule)}>Edit</button><button className="text-button" onClick={() => onToggleRule(rule.id, !rule.enabled)}>{rule.enabled ? "Disable" : "Enable"}</button><button className="text-button" onClick={() => onDeleteRule(rule.id)}>Delete</button></div></div>;
            })}
          </div>
        </section>
        <section className="panel settings-card demo-reset-card">
          <h2>Reset Demo Data</h2>
          <p className="muted">Restore the original demo books for one company or all five.</p>
          <label className="reset-target-label">
            <span>Company</span>
            <select value={resetTarget} onChange={(event) => { setResetTarget(event.target.value); setResetReview(null); setResetSuccess(null); }}>
              {DEMO_RESET_CLIENTS.map((client, index) => <option key={`${client.id}-${index}`} value={client.id}>{client.name}</option>)}
              <option value="all">All five demo companies</option>
            </select>
          </label>
          {!resetReview ? <button className="secondary-button" onClick={reviewReset}>Review reset</button> : (
            <div className="reset-confirmation" role="group" aria-label="Confirm demo data reset">
              <strong>Reset {DEMO_RESET_CLIENTS.filter((client) => resetReview.includes(client.id)).map((client) => client.name).join(", ")}?</strong>
              <p>This permanently removes manual transactions, invoice and bill payments, reconciliation changes, Month End sign-offs, and client request changes for the listed companies. Original demo data will be restored. QuickBooks data, authentication, and sessions are not affected.</p>
              <label><input type="checkbox" checked={resetConfirmed} onChange={(event) => setResetConfirmed(event.target.checked)} /> I understand these demo changes will be deleted.</label>
              <div className="reset-actions">
                <button className="text-button" disabled={resetLoading} onClick={() => setResetReview(null)}>Cancel</button>
                <button className="danger-button" disabled={!resetConfirmed || resetLoading} onClick={confirmReset}>{resetLoading ? "Resetting..." : "Reset demo data"}</button>
              </div>
            </div>
          )}
          {resetError && <p className="settings-error" role="alert">{resetError}</p>}
          {resetSuccess && <p className="reset-success" role="status">{resetSuccess}</p>}
        </section>
        <section className="panel settings-card audit-log-card">
          <h2>Audit Log</h2>
          <p className="muted">Local test record of QuickBooks Sandbox write attempts.</p>
          {auditLog.length === 0 ? <p className="muted">No QuickBooks updates attempted.</p> : <div className="audit-log-list">{auditLog.map((entry, index) => <div className="audit-log-row" key={`${entry.timestamp}-${index}`}><strong>{entry.result}</strong><span>{entry.transactionType} · {entry.quickBooksId}</span><span>{entry.oldCategory} → {entry.newCategory}</span><small>{new Date(entry.timestamp).toLocaleString()}</small></div>)}</div>}
        </section>
        <section className="panel settings-card audit-log-card">
          <h2>Automation Activity</h2>
          <p className="muted">Tracks rule changes and automation suggestions without marking any accounting change as posted.</p>
          {automationEvents.length === 0 ? <p className="muted">No automation activity recorded yet.</p> : <div className="audit-log-list">{automationEvents.map((event, index) => <div className="audit-log-row" key={`${event.id}-${index}`}><strong>{event.summary}</strong><span>{event.kind}</span>{event.detail && <span>{event.detail}</span>}<small>{new Date(event.at).toLocaleString()}</small></div>)}</div>}
        </section>
        <section className="panel settings-card audit-log-card">
          <h2>Recurring activity</h2>
          <p className="muted">Expected recurring transactions are reminders only and never create entries automatically.</p>
          {recurringPatterns.length === 0 ? <p className="muted">No recurring reminders are currently open.</p> : <div className="audit-log-list">{recurringPatterns.slice(0, 8).map((pattern, index) => <div className="audit-log-row" key={`${pattern.id}-${index}`}><strong>{pattern.vendor}</strong><span>{pattern.frequency} · typical {formatMoney(pattern.typicalAmountCents / 100)}</span><span>Expected next date {formatDueDate(pattern.expectedNextDate)} · {pattern.confidence} confidence</span></div>)}</div>}
        </section>
      </div>
    </div>
  );
}

function Reconcile({
  source,
  clientRef,
  accounts,
  isLoading,
  error,
  today,
  period,
  homeSignal,
  entryTools,
  loadEntries,
  paymentBooks,
  onPeriodChange,
  onSourceChange,
}: {
  source: AccountSource;
  clientRef: { id: string; name: string };
  accounts: LedgerAccount[];
  isLoading: boolean;
  error: string | null;
  today: string;
  period: Period;
  homeSignal: number;
  entryTools?: EntryTools;
  loadEntries: () => DemoEntryRecord[];
  paymentBooks: DemoPaymentBook[];
  onPeriodChange: (period: Period) => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  const company = source === "demo" ? getAdditionalDemoCompany(clientRef.id) : undefined;
  const companyStatements = company ? companyReconSources(company, period) : [];
  const options: ReconAccount[] =
    source === "demo"
      ? company
        ? company.reconciliationAccounts.map((account) => {
            const statement = companyStatements.find((item) => item.accountId === account.id);
            return { id: account.id, name: account.name, kind: account.kind, lastReconciled: statement?.lastReconciled, ...(statement ? { defaults: { periodStart: statement.periodStart, periodEnd: statement.periodEnd, statementDate: statement.statementDate, beginningCents: statement.beginningCents, endingCents: statement.endingCents, statementLines: statement.statementLines } } : {}) };
          })
        : demoReconSources.map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            lastReconciled: item.lastReconciled,
            defaults: { periodStart: item.periodStart, periodEnd: item.periodEnd, statementDate: item.statementDate, beginningCents: item.beginningCents, endingCents: item.endingCents, statementLines: item.statementLines },
          }))
      : accounts
          .filter((account) => account.active && account.quickBooksId && (account.accountType === "Bank" || account.accountType === "Credit Card"))
          .map((account) => ({ id: account.quickBooksId!, name: account.name, kind: account.accountType === "Bank" ? ("bank" as const) : ("credit_card" as const), detail: `QuickBooks balance today ${formatMoney(account.currentBalance)}` }));
  const loadAccountData = async (accountId: string, through: string) => {
    if (source === "quickbooks") return quickBooksService.getReconciliationData(accountId, through);
    if (company) {
      const account = company.reconciliationAccounts.find((candidate) => candidate.id === accountId);
      if (!account) throw new Error("That demo account was not found for this company.");
      const earlier = companyLedgerRegister(company, account.ledgerId, through);
      const entered = additionRegister(loadEntries(), account.ledgerId, company.clientId).filter((transaction) => transaction.date <= through);
      const payments = account.ledgerId === "checking" ? paymentRegister(paymentBooks, "checking", company.clientId).filter((transaction) => transaction.date <= through) : [];
      return { transactions: [...earlier, ...entered, ...payments], completeness: { complete: true, reasons: [] } };
    }
    const item = demoReconSources.find((candidate) => candidate.id === accountId);
    if (!item) throw new Error("That demo account was not found.");
    const ledgerId = DEMO_RECONCILIATION_ACCOUNTS.find((account) => account.id === accountId)?.ledgerId as "checking" | "card" | undefined;
    const earlier = ledgerId ? demoEarlierRegister(ledgerId).filter((transaction) => transaction.date <= through) : [];
    const entered = ledgerId ? additionRegister(loadEntries(), ledgerId).filter((transaction) => transaction.date <= through) : [];
    const payments = ledgerId === "checking" ? paymentRegister(paymentBooks, "checking").filter((transaction) => transaction.date <= through) : [];
    return { transactions: [...earlier, ...item.transactions.filter((transaction) => transaction.date <= through), ...entered, ...payments], completeness: { complete: true, reasons: [] } };
  };

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Reconcile</h2>
          <p className="muted">Make sure each account matches its statement.</p>
        </div>
        <PeriodPicker period={period} today={today} onChange={onPeriodChange} />
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {isLoading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox accounts...
        </div>
      )}
      {error && <div className="data-state-message error">{error}</div>}
      <ReconcileWorkspace key={`${source}:${clientRef.id}`} source={source} client={clientRef} accounts={options} loadAccountData={loadAccountData} today={today} period={period} homeSignal={homeSignal} entryTools={entryTools} />
    </div>
  );
}

function AccountSourceSwitch({
  source,
  onChange,
}: {
  source: AccountSource;
  onChange: (source: AccountSource) => void;
}) {
  return (
    <div className="data-source-switch" aria-label="Account data source">
      <span>Data source</span>
      <button
        className={source === "demo" ? "active" : ""}
        onClick={() => onChange("demo")}
      >
        Demo Data
      </button>
      <button
        className={source === "quickbooks" ? "active" : ""}
        onClick={() => onChange("quickbooks")}
      >
        QuickBooks Sandbox
      </button>
    </div>
  );
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function quickBooksBalance(accounts: LedgerAccount[], accountType: string) {
  return accounts
    .filter((account) => account.active && account.accountType === accountType)
    .reduce((total, account) => total + account.currentBalance, 0);
}

function ClientDashboard({
  client,
  companyName,
  source,
  available,
  tasks,
  monthEndProgress,
  quickBooksAccounts,
  accountLoading,
  accountError,
  onSourceChange,
  onBack,
  onOpenInbox,
  onOpenRequests,
  onOpenTask,
  onTransactions,
  onReconcile,
  onMonthEnd,
  onReceivables,
  onPayables,
  onReports,
  documents,
}: {
  client: Client | null;
  companyName: string;
  source: AccountSource;
  available: boolean;
  tasks: WorkTask[];
  monthEndProgress: number | null;
  quickBooksAccounts: LedgerAccount[];
  accountLoading: boolean;
  accountError: string | null;
  onSourceChange: (source: AccountSource) => void;
  onBack: () => void;
  onOpenInbox: () => void;
  onOpenRequests: () => void;
  onOpenTask: (task: WorkTask) => void;
  onTransactions: () => void;
  onReconcile: () => void;
  onMonthEnd: () => void;
  onReceivables: () => void;
  onPayables: () => void;
  onReports: () => void;
  documents: ClientDocument[];
}) {
  const isDemo = source === "demo";
  // Demo clients other than the one with full records only have summary counts.
  const hasRecords = !isDemo || client?.id === demoClient.id || Boolean(client && ADDITIONAL_DEMO_CLIENT_IDS.includes(client.id));
  const summary = summarizeTasks(tasks);
  const kindCount = (kind: WorkTask["kind"]) => tasks.filter((task) => task.kind === kind).reduce((sum, task) => sum + task.count, 0);
  const balances = quickBooksAccounts.length > 0;
  const money = (type: string) => (balances ? formatMoney(quickBooksBalance(quickBooksAccounts, type)) : NOT_AVAILABLE);
  const bankBalance = isDemo ? client!.bankBalance : money("Bank");
  const accountsReceivable = isDemo ? client!.accountsReceivable : money("Accounts Receivable");
  const accountsPayable = isDemo ? client!.accountsPayable : money("Accounts Payable");
  const status = (value: number, available_: boolean, unit: string) => (!available_ ? NOT_AVAILABLE : value === 0 ? "None" : `${value} ${unit}`);
  const toneFor = (value: number, text: string) => (text === NOT_AVAILABLE ? "amber" : value === 0 ? "green" : "red");
  const transactionsOpen = summary.transactions;
  const reconciliationOpen = summary.reconciliation;
  const questionsOpen = summary.clientQuestions;
  const uncategorized = kindCount("uncategorized");
  const receipts = kindCount("needs-receipt");
  const hasHigh = summary.high > 0;
  const name = client?.name ?? companyName;
  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All clients
      </button>
      <section className="client-hero">
        <div>
          <span className={`status-badge ${!available ? "warning" : tasks.length === 0 ? "success" : "warning"}`}>
            {!available ? NOT_AVAILABLE : tasks.length === 0 ? "On track" : hasHigh ? "Needs attention" : "Some items open"}
          </span>
          <h2>{name}</h2>
          <p className="muted">{isDemo ? `Books for ${client!.month}` : "QuickBooks Sandbox company"}</p>
        </div>
        <button className="primary-button" onClick={onTransactions}>
          Review transactions <span>→</span>
        </button>
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {accountLoading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox account balances...
        </div>
      )}
      {accountError && (
        <div className="data-state-message error">{accountError}</div>
      )}
      <section className="metrics-grid finance-grid">
        <MetricCard
          label="Income"
          value={isDemo ? client!.income : NOT_AVAILABLE}
          note={isDemo ? "This month (demo)" : "See Reports"}
          tone="green"
        />
        <MetricCard
          label="Expenses"
          value={isDemo ? client!.expenses : NOT_AVAILABLE}
          note={isDemo ? "This month (demo)" : "See Reports"}
          tone="amber"
        />
        <MetricCard
          label="Profit"
          value={isDemo ? client!.profit : NOT_AVAILABLE}
          note={isDemo ? "This month (demo)" : "See Reports"}
          tone="blue"
        />
        <MetricCard
          label="Bank balance"
          value={bankBalance}
          note={isDemo ? "Demo balance" : "QuickBooks balance"}
          tone="purple"
        />
        <MetricCard
          label="Accounts receivable"
          value={accountsReceivable}
          note={isDemo ? "To collect (demo)" : "QuickBooks balance"}
          tone="green"
        />
        <MetricCard
          label="Accounts payable"
          value={accountsPayable}
          note={isDemo ? "To pay (demo)" : "QuickBooks balance"}
          tone="red"
        />
      </section>
      <section className="content-grid">
        <div className="panel work-panel">
          <div className="panel-heading">
            <div>
              <h2>Next up for {name}</h2>
              <p className="muted">The most important items first.</p>
            </div>
            <span className="count-pill">{available ? `${tasks.length} tasks` : NOT_AVAILABLE}</span>
          </div>
          {available && tasks.length === 0 && <div className="empty-state"><span>✓</span><h2>You're all caught up.</h2><p className="muted">Nothing needs attention for this client.</p></div>}
          <TaskCardList tasks={tasks.slice(0, 5)} showClient={false} onOpenTask={onOpenTask} />
          {tasks.length > 5 && (
            <button className="text-button" onClick={onOpenInbox}>
              See all {tasks.length} tasks in the Inbox <span>→</span>
            </button>
          )}
        </div>
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Bookkeeping status</h2>
              <p className="muted">A short list of what is left to do.</p>
            </div>
          </div>
          <div className="status-list">
            {(() => {
              const rows = [
                { label: "Transactions needing review", count: transactionsOpen, text: status(transactionsOpen, available, "to review") },
                { label: "Uncategorized transactions", count: uncategorized, text: status(uncategorized, available && hasRecords, "found") },
                { label: "Reconciliation", count: reconciliationOpen, text: status(reconciliationOpen, available, "to check") },
                { label: "Possible missing receipts", count: receipts, text: status(receipts, available && hasRecords, "flagged") },
                { label: "Client questions", count: questionsOpen, text: status(questionsOpen, available, "open") },
              ];
              return rows.map((row) => <StatusRow key={row.label} label={row.label} value={row.text} tone={toneFor(row.count, row.text)} />);
            })()}
            <StatusRow label="Month-end progress" value={monthEndProgress === null ? NOT_AVAILABLE : `${monthEndProgress}%`} tone="blue" />
          </div>
          <div className="action-grid">
            <button onClick={onTransactions}>
              Review transactions <span>→</span>
            </button>
            <button onClick={onReconcile}>
              Reconcile accounts <span>→</span>
            </button>
            <button onClick={onPayables}>
              Review bills <span>→</span>
            </button>
            <button onClick={onReceivables}>
              Review invoices <span>→</span>
            </button>
            <button onClick={onMonthEnd}>
              Month end <span>→</span>
            </button>
            <button onClick={onReports}>
              Reports <span>→</span>
            </button>
          </div>
        </div>
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Documents</h2>
              <p className="muted">Recent client portal documents and review status.</p>
            </div>
            <span className="count-pill">{documents.length} docs</span>
          </div>
          {documents.length === 0 ? <p className="muted">No demo documents are recorded for this client yet.</p> : <div className="audit-log-list">{documents.slice(0, 4).map((document) => <div className="audit-log-row" key={document.id}><strong>{document.name}</strong><span>{document.type} · {document.reviewStatus}</span><span>{document.matchStatus ? `Receipt match: ${document.matchStatus}` : document.notes || "Demo fixture metadata only."}</span></div>)}</div>}
          <div className="reset-actions">
            <button className="secondary-button" onClick={onOpenRequests}>Open requests and documents <span>→</span></button>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="metric-note">{note}</span>
    </div>
  );
}
function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="status-row">
      <span className={`status-check ${tone}`}>
        {tone === "green" ? "✓" : "!"}
      </span>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <span className="row-arrow">→</span>
    </div>
  );
}

export default App;
