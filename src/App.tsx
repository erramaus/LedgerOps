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
  buildSummaryTasks,
  countByClient,
  filterTasks,
  isReviewTask,
  scopeRequests,
  sortTasks,
  summarizeTasks,
  taskButtonLabel,
  taskPriorities,
  taskStatuses,
  taskTypes,
  type ClientRecords,
  monthEndPercent,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  type WorkTask,
} from "./services/workQueue";
import { describeDue } from "./services/dueDates";
import {
  ALL_CLIENTS,
  REQUEST_TYPES,
  draftIsDirty,
  draftMessage,
  emptyRequestDraft,
  emptyRequestFilters,
  filterRequests,
  hasActiveRequestFilters,
  nextStep,
  requestCounts,
  requestDocuments,
  requestDue,
  sortRequests,
  suggestedMessage,
  type RequestDraft,
  type RequestFilters,
  type RequestStatusFilter,
} from "./services/requestsView";
import { cleanDescription, dueLabel, filterByReadiness, isWaiting, localIsoDate, searchTasks, type Readiness } from "./services/inboxView";
import {
  buildFindingRows, decisionKey, explainFinding, filterFindingRows, findingTypeLabel, findingTypeOf, findingTypes, isAccountingFinding, isDismissalCurrent,
  latestDecisions, readReviewDecisions, reviewStatuses, rowType, sourceFingerprint, summarizeFindings, writeReviewDecisions,
  type FindingFilters, type FindingRow, type ReviewDecision,
} from "./services/reviewFindings";
import { attentionStatus, monthEndStatus, nextTaskFor, periodNotice } from "./services/clientStatus";
import {
  DEMO_CATEGORIES,
  adjacentInQueue,
  applyLineChanges,
  categoriesIn,
  categoryLabel,
  clientIdsIn,
  describeDateRange,
  filterTransactions,
  getLines,
  hasDateRange,
  isExpenseCategoryAccount,
  isUncategorized,
  matchesReason,
  monthRange,
  needsAttention,
  needsReceipt,
  nextActionable,
  categorizationStatus,
  reasonFilters,
  statusFilters,
  reviewReasons,
  validateLineChanges,
  type DateRange,
  type LineChange,
  type ReasonFilter,
  type StatusFilter,
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
import { ReconcileClientPicker, ReconcileWorkspace, type ReconAccount } from "./Reconciliation";
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
import { reconciliationService } from "./services/reconciliationService";
import {
  SETTINGS_SECTIONS,
  classifyConnection,
  describeStorage,
  ruleFormFromRule,
  ruleFormHasUnsavedWork,
  type ConnectionSummary,
  type RuleForm,
  type SettingsSection,
  type StorageSummary,
} from "./services/settingsStatus";
import { demoWorkpaperService } from "./services/demoWorkpaperService";
import type { EntryTools } from "./MissingTransaction";
import { DocumentPaymentActions } from "./DocumentPaymentActions";
import { companyBills, companyClient, companyInvoices, companyLedgerRegister, companyMonthEndItems, companyReconciliationAccounts, companyReconSources, companyRequests, companyTransactions } from "./services/demoCompanyData";
import type { MonthEndItem } from "./data/demoData";
import { unusualAmountsByClient } from "./services/unusualAmounts";
import { MonthEnd } from "./MonthEnd";
import { PeriodPicker } from "./PeriodPicker";
import { Reports } from "./Reports";
import { useMonthEnd } from "./useMonthEnd";
import { loadedDemoClientIds, useClientsMonthEnd, type ClientMonthEndContext } from "./useClientsMonthEnd";
import { toMonthEndItems } from "./services/monthEndData";
import { summarizeOpenItems } from "./services/openItems";
import { agingFilters, emptyReceivableFilters, filterCounts, filterRows, formatLongDate, hasActiveFilters, invoiceDue, isOverdue, paymentFilters, paymentStatus, type AgingFilter, type ReceivableFilters, type ReceivableRow } from "./services/receivablesView";
import { billDue, billFilterCounts, billPaymentFilters, dueFilters, emptyBillFilters, filterBills, hasActiveBillFilters, isDueSoon, needsReview as billNeedsReview, reviewFilters, type BillFilters, type BillRow, type DueFilter } from "./services/payablesView";
import { completionPercent, type StepView } from "../shared/monthEnd";
import { lastCompleteMonth, monthLabel, periodEnd, type Period } from "../shared/period";

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

function App({ user, onSignOut, devBypass = false }: { user: AuthUser; onSignOut: () => void; devBypass?: boolean }) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [view, setView] = useState<View>("Dashboard");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [ownTransactions, setTransactions] =
    useState<Transaction[]>(demoTransactions);
  // Edits to the other demo companies' generated transactions, keyed by client and transaction id.
  const [companyEdits, setCompanyEdits] = useState<Record<string, Transaction>>({});
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
  // Kept here, not in the Client Requests page, so an unsaved request survives opening a request or visiting another tab.
  const [requestDraft, setRequestDraft] = useState<RequestDraft>(emptyRequestDraft);
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
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecision[]>(() => readReviewDecisions());
  const [reviewDecisionsSaved, setReviewDecisionsSaved] = useState(true);
  const [demoResetRevision, setDemoResetRevision] = useState(0);
  const resetDemoState = (clientIds: string[]) => {
    const targets = new Set(clientIds);
    if (targets.has(demoClient.id)) setTransactions(demoTransactions);
    setCompanyEdits((current) => Object.fromEntries(Object.entries(current).filter(([, edited]) => !edited.clientId || !targets.has(edited.clientId))));
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
    setReviewDecisions((current) => current.filter((decision) => !(decision.source === "demo" && targets.has(decision.clientId))));
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

  useEffect(() => {
    setReviewDecisionsSaved(writeReviewDecisions(reviewDecisions));
  }, [reviewDecisions]);

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
    entriesRef.current = [];
    setDemoEntries([]);
    Promise.all(loadedDemoClientIds(selectedClient?.id, appDataSource).map((id) => demoEntryService.list(id))).then((lists) => { const records = lists.flat(); if (generation === entryLoadGeneration.current) { entriesRef.current = records; setDemoEntries(records); setEntriesError(null); } }, (error: unknown) => { if (generation === entryLoadGeneration.current) setEntriesError(error instanceof Error ? error.message : "Unknown error."); });
  }, [selectedClient?.id, appDataSource, demoResetRevision]);
  const [journalRecords, setJournalRecords] = useState<DemoJournalRecord[]>([]);
  const journalsRef = useRef<DemoJournalRecord[]>([]);
  const journalLoadGeneration = useRef(0);
  useEffect(() => {
    const generation = ++journalLoadGeneration.current;
    journalsRef.current = [];
    setJournalRecords([]);
    Promise.all(loadedDemoClientIds(selectedClient?.id, appDataSource).map((id) => demoJournalService.list(id))).then((lists) => {
      const records = lists.flat();
      if (generation === journalLoadGeneration.current) {
        journalsRef.current = records;
        setJournalRecords(records);
      }
    }, () => undefined);
  }, [selectedClient?.id, appDataSource, demoResetRevision]);
  const [paymentBooks, setPaymentBooks] = useState<DemoPaymentBook[]>([]);
  const paymentBooksRef = useRef<DemoPaymentBook[]>([]);
  const paymentLoadGeneration = useRef(0);
  useEffect(() => {
    const generation = ++paymentLoadGeneration.current;
    paymentBooksRef.current = [];
    setPaymentBooks([]);
    Promise.all(loadedDemoClientIds(selectedClient?.id, appDataSource).map((id) => demoPaymentService.list(id))).then((lists) => { const books = lists.flat(); if (generation === paymentLoadGeneration.current) { paymentBooksRef.current = books; setPaymentBooks(books); } }, () => undefined);
  }, [selectedClient?.id, appDataSource, demoResetRevision]);
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
  // "All clients" lists every demo company's invoices, each tagged with its client so a payment is always recorded against the right books.
  const allClientInvoiceRows = useMemo<ReceivableRow[]>(() => [
    ...invoicesWithPayments(demoInvoices, paymentBooks).map((invoice) => ({ invoice, clientId: demoClient.id, clientName: demoClient.name })),
    ...ADDITIONAL_DEMO_CLIENT_IDS.flatMap((id) => {
      const company = getAdditionalDemoCompany(id);
      return company ? companyInvoices(company, paymentBooks).map((invoice) => ({ invoice, clientId: id, clientName: company.clientName })) : [];
    }),
  ], [paymentBooks]);
  const bills = useMemo(() => activeDemoCompany ? companyBills(activeDemoCompany, paymentBooks) : billsWithPayments(demoBills, paymentBooks), [activeDemoCompany, paymentBooks]);
  const allClientBillRows = useMemo<BillRow[]>(() => [
    ...billsWithPayments(demoBills, paymentBooks).map((bill) => ({ bill, clientId: demoClient.id, clientName: demoClient.name })),
    ...ADDITIONAL_DEMO_CLIENT_IDS.flatMap((id) => {
      const company = getAdditionalDemoCompany(id);
      return company ? companyBills(company, paymentBooks).map((bill) => ({ bill, clientId: id, clientName: company.clientName })) : [];
    }),
  ], [paymentBooks]);
  const withCompanyEdits = (company: NonNullable<typeof activeDemoCompany>) => companyTransactions(company).map((transaction) => companyEdits[`${company.clientId}/${transaction.id}`] ?? transaction);
  const rawTransactions = useMemo(() => activeDemoCompany
    ? [...withCompanyEdits(activeDemoCompany), ...entryTransactions(demoEntries, activeDemoClientId), ...paymentTransactions(paymentBooks, activeDemoClientId)]
    : [...ownTransactions, ...entryTransactions(demoEntries), ...paymentTransactions(paymentBooks)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDemoCompany, activeDemoClientId, ownTransactions, demoEntries, paymentBooks, companyEdits]);
  // "All clients" lists every demo company that has detailed records, each row tagged with its client.
  const allClientTransactions = useMemo(() => {
    const entriesOf = (clientId: string) => demoEntries.filter((record) => (record.clientId ?? demoClient.id) === clientId);
    return [
      ...[...ownTransactions, ...entryTransactions(entriesOf(demoClient.id), demoClient.id), ...paymentTransactions(paymentBooks, demoClient.id)].map((transaction) => ({ ...transaction, clientId: transaction.clientId ?? demoClient.id })),
      ...ADDITIONAL_DEMO_CLIENT_IDS.flatMap((clientId) => {
        const company = getAdditionalDemoCompany(clientId);
        return company ? [...withCompanyEdits(company), ...entryTransactions(entriesOf(clientId), clientId), ...paymentTransactions(paymentBooks, clientId)] : [];
      }),
    ];
  }, // eslint-disable-next-line react-hooks/exhaustive-deps
  [ownTransactions, demoEntries, paymentBooks, companyEdits]);
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
  const companyReconciliationsNow = (company: NonNullable<typeof activeDemoCompany>) => companyReconciliationAccounts(company).map((account) => {
    const ledgerId = company.reconciliationAccounts.find((item) => item.id === account.id)?.ledgerId;
    const rows = ledgerId ? [...additionRegister(demoEntries, ledgerId, company.clientId), ...(ledgerId === "checking" ? paymentRegister(paymentBooks, "checking", company.clientId) : [])] : [];
    const delta = rows.reduce((total, row) => total + (row.direction === "increase" ? row.amountCents : -row.amountCents), 0);
    if (!delta) return account;
    const quickBooksBalance = Math.round(account.quickBooksBalance * 100 + delta) / 100;
    return { ...account, quickBooksBalance, status: Math.round(quickBooksBalance * 100) === Math.round(account.statementBalance * 100) ? "Ready to complete" : "Difference to resolve" };
  });
  const abcReconciliationsNow = () => reconciliationAccounts.map((account) => {
    const ledgerId = DEMO_RECONCILIATION_ACCOUNTS.find((item) => item.id === account.id)?.ledgerId as "checking" | "card" | undefined;
    const rows = ledgerId ? [...additionRegister(demoEntries, ledgerId), ...(ledgerId === "checking" ? paymentRegister(paymentBooks, "checking") : [])] : [];
    const delta = rows.reduce((total, row) => total + (row.direction === "increase" ? row.amountCents : -row.amountCents), 0);
    if (delta === 0) return account;
    const quickBooksBalance = Math.round(account.quickBooksBalance * 100 + delta) / 100;
    return { ...account, quickBooksBalance, status: Math.round(quickBooksBalance * 100) === Math.round(account.statementBalance * 100) ? "Ready to complete" : "Difference to resolve" };
  });
  const reconciliationAccountsNow = useMemo(
    () => activeDemoCompany ? companyReconciliationsNow(activeDemoCompany) : abcReconciliationsNow(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Opening an invoice from All clients first selects its client, so the detail, payments and ledger use that client's books.
  const openInvoiceRow = (row: ReceivableRow) => {
    if (appDataSource === "demo" && !activeClient) {
      const owner = clients.find((client) => client.id === row.clientId);
      if (owner) selectClient(owner);
    }
    setSelectedInvoice(row.invoice);
  };
  const openPayables = () => {
    setSelectedBill(null);
    setSelectedRecurring(null);
    setView("Payables");
  };
  // Opening a bill from All clients first selects its client, so the detail, payments and ledger use that client's books.
  const openBillRow = (row: BillRow) => {
    if (appDataSource === "demo" && !activeClient) {
      const owner = clients.find((client) => client.id === row.clientId);
      if (owner) selectClient(owner);
    }
    setSelectedBill(row.bill);
  };
  const openReports = () => {
    setSelectedRecurring(null);
    if (view === "Reports") setHomeSignal((count) => count + 1);
    setView("Reports");
  };
  // Month End shows one client's books even while "All clients" is selected. Opening a workflow from it must open that same client.
  const keepMonthEndClient = () => {
    if (appDataSource !== "demo" || activeClient) return;
    const owner = clients.find((client) => client.id === monthEndClient.id);
    if (owner) selectClient(owner);
  };
  const openStepView = (destination: StepView) => {
    keepMonthEndClient();
    return destination === "Transactions" ? openTransactions()
      : destination === "Bookkeeping Review" ? setView("Bookkeeping Review")
      : destination === "Reconcile" ? openReconcile()
      : destination === "Receivables" ? openReceivables()
      : destination === "Payables" ? openPayables()
      : destination === "Reports" ? openReports()
      : openRequests();
  };
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
    const owner = updatedTransaction.clientId;
    if (owner && owner !== demoClient.id && getAdditionalDemoCompany(owner)) {
      setCompanyEdits((current) => ({ ...current, [`${owner}/${updatedTransaction.id}`]: updatedTransaction }));
    } else {
      setTransactions((currentTransactions) =>
        currentTransactions.map((transaction) =>
          transaction.id === updatedTransaction.id
            ? updatedTransaction
            : transaction,
        ),
      );
    }
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
    // Created from All clients: continue in that client's workspace so every tab stays on the same client.
    if (!selectedClient) {
      const owner = clients.find((client) => client.id === input.clientId);
      if (owner) {
        selectClient(owner);
        setSelectedRequest(request);
      }
    }
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

  // Opening a request from All clients first selects its client, so the detail, the other tabs and the books agree.
  const openRequestRow = (request: ClientRequest) => {
    if (source === "demo" && !selectedClient) {
      const owner = clients.find((client) => client.id === request.clientId);
      if (owner) {
        selectClient(owner);
        setSelectedRequest(request);
        return;
      }
    }
    setSelectedRequest(request);
  };

  // An empty message sends a saved draft as it is; otherwise the message is added to the thread.
  const sendFollowUp = (request: ClientRequest, message: string) => {
    const text = message.trim();
    const next = text
      ? appendMessage(request, "Bookkeeper", "LedgerOps Bookkeeper", text, new Date().toISOString(), undefined, "Waiting for Client")
      : { ...request, status: "Waiting for Client" as const };
    saveRequest(next);
    logPortal({
      at: new Date().toISOString(),
      actor: "Bookkeeper",
      clientId: request.clientId ?? demoClient.id,
      requestId: request.id,
      kind: "request-sent",
      source: request.quickBooksId ? "quickbooks" : "demo",
      summary: text ? `Sent a follow-up on the ${request.requestType.toLowerCase()} request.` : `Sent ${request.requestType.toLowerCase()} request for ${request.client}.`,
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
    if (source !== "demo") return scopeRequests(requests, source).map(normalizeRequest);
    // The ABC Plumbing books (also the working set behind All clients) only see ABC's own requests.
    if (!activeDemoCompany) return scopeRequests(requests, source).filter((request) => request.clientId === demoClient.id).map(normalizeRequest);
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
  // The Client Requests page: every demo company's requests under All clients, one company's when a client is selected.
  const allDemoRequests = useMemo(() => scopeRequests(requests, "demo").map(normalizeRequest), [requests]);
  const transactions = useMemo(
    () => rawTransactions.map((transaction) => relevantTransactionStatus(transaction, scopedRequests)),
    [rawTransactions, scopedRequests],
  );
  const tabTransactions = useMemo(
    () => selectedClient ? transactions : allClientTransactions.map((transaction) => relevantTransactionStatus(transaction, requests)),
    [selectedClient, transactions, allClientTransactions, requests],
  );
  const clientNameById = useMemo(() => Object.fromEntries(baseClients.map((client) => [client.id, client.name])), [baseClients]);
  // The client and month are chosen once here, so every workflow keeps showing the same ones.
  const monthEndClient = source === "demo" ? { id: (selectedClient ?? demoClient).id, name: (selectedClient ?? demoClient).name } : { id: QUICKBOOKS_CLIENT_ID, name: sandboxName };
  const todayIso = localIsoDate(currentDate);
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
      ? { client: { id: dataClient.id, name: dataClient.name }, transactions, invoices, bills, accounts: [], reconciliations: reconciliationAccountsNow, requests: scopedRequests, monthEnd: monthEndItemsNow, today: todayIso }
      : { client: { id: QUICKBOOKS_CLIENT_ID, name: sandboxName }, transactions: reviewData?.transactions ?? [], invoices: reviewData?.invoices ?? [], bills: reviewData?.bills ?? [], accounts: reviewData?.accounts ?? [], reconciliations: [], requests: scopedRequests, monthEnd: monthEndItemsNow, today: todayIso };
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
  // Under All clients every demo company contributes its own item-level tasks, built from the same records its tabs show.
  const otherClientBase = useMemo<ClientRecords[]>(() => {
    if (source !== "demo") return [];
    return [demoClient.id, ...ADDITIONAL_DEMO_CLIENT_IDS].filter((id) => id !== dataClient.id).flatMap((id) => {
      const company = getAdditionalDemoCompany(id);
      const name = company?.clientName ?? demoClient.name;
      const clientRequests = allDemoRequests.filter((request) => request.clientId === id);
      const clientTransactions = allClientTransactions.filter((transaction) => transaction.clientId === id).map((transaction) => relevantTransactionStatus(transaction, clientRequests));
      return [{
        client: { id, name },
        transactions: clientTransactions,
        invoices: company ? companyInvoices(company, paymentBooks) : invoicesWithPayments(demoInvoices, paymentBooks),
        bills: company ? companyBills(company, paymentBooks) : billsWithPayments(demoBills, paymentBooks),
        accounts: [],
        reconciliations: company ? companyReconciliationsNow(company) : abcReconciliationsNow(),
        requests: clientRequests,
        monthEnd: company ? companyMonthEndItems(company, { year: 2026, month: 8 }) as MonthEndItem[] : [],
        today: todayIso,
      }];
    });
  }, // eslint-disable-next-line react-hooks/exhaustive-deps
  [source, dataClient.id, allDemoRequests, allClientTransactions, paymentBooks, demoEntries, todayIso]);
  // Each other company's month-end checks come from its own stored reconciliations and sign-offs. Until they load (or if they cannot be read) the static, never-complete list stands in.
  const otherClientContexts = useMemo<ClientMonthEndContext[]>(() => otherClientBase.map((item) => {
    const company = getAdditionalDemoCompany(item.client.id);
    return { id: item.client.id, name: item.client.name, ledger: mergeDemoPayments(paymentBooks, mergeDemoJournals(journalRecords, mergedLedger(demoEntries, company?.ledger, item.client.id), item.client.id), item.client.id), transactions: item.transactions, requests: item.requests };
  }), [otherClientBase, paymentBooks, journalRecords, demoEntries]);
  const otherClientMonthEnd = useClientsMonthEnd({ enabled: source === "demo" && !selectedClient && ["Dashboard", "Clients", "Inbox", "Bookkeeping Review"].includes(view), contexts: otherClientContexts, period, today: todayIso, refreshToken: `${view}:${demoResetRevision}` });
  const otherClientRecords = useMemo<ClientRecords[]>(() => otherClientBase.map((item) => {
    const stored = otherClientMonthEnd[item.client.id];
    return stored ? { ...item, monthEnd: stored } : item;
  }), [otherClientBase, otherClientMonthEnd]);
  const otherClientTasks = otherClientRecords.flatMap((client) => {
    const detailed = buildWorkTasks(client);
    // Until ABC Plumbing's stored month-end state is read, its summary figure stands in rather than implying it is finished.
    if (client.client.id !== demoClient.id || otherClientMonthEnd[client.client.id]) return detailed;
    const summary = clients.find((item) => item.id === client.client.id);
    return [...detailed, ...(summary ? buildSummaryTasks([summary]).filter((task) => task.kind === "summary-month-end") : [])];
  });
  const baseTasks = queueAvailable ? [...buildWorkTasks(records), ...otherClientTasks].map((task) => {
    if (task.kind !== "uncategorized" || !task.recordId) return task;
    const match = ruleSuggestionMap.get(task.recordId);
    return match ? { ...task, priority: match.rule.reviewPriority, issue: "Uncategorized transaction with rule suggestion", description: `${task.description} Rule "${match.rule.name}" suggests ${match.rule.category}.`, automationId: match.rule.id, status: "Ready to review" as const } : task;
  }) : [];
  const automationTasks = queueAvailable ? buildAutomationTasks(records.client, ruleSuggestionMap, recurringPatterns) : [];
  const allTasksUnfiltered = sortTasks([...baseTasks, ...automationTasks]);
  // A dismissed finding leaves every screen's queue until its source record changes.
  const latestReviewDecisions = latestDecisions(reviewDecisions);
  const sourceRecords = { transactions: records.transactions, invoices: records.invoices, bills: records.bills };
  // Each finding is fingerprinted against its own client's records, never another company's.
  const sourceRecordsFor = (task: WorkTask) => {
    const owner = task.clientId === records.client.id ? records : otherClientRecords.find((item) => item.client.id === task.clientId) ?? records;
    return owner === records ? sourceRecords : { transactions: owner.transactions, invoices: owner.invoices, bills: owner.bills };
  };
  const isDismissedFinding = (task: WorkTask) =>
    isAccountingFinding(task) && isDismissalCurrent(latestReviewDecisions.get(decisionKey(source, task.id)), sourceFingerprint(task, sourceRecordsFor(task)));
  const allTasks = allTasksUnfiltered.filter((task) => !isDismissedFinding(task));
  const dismissedFindings = filterTasks(allTasksUnfiltered.filter(isDismissedFinding), { clientId: source === "demo" && selectedClient ? selectedClient.id : null });
  const recordReviewDecision = (task: WorkTask, status: ReviewDecision["status"], reason?: string) => {
    const decision: ReviewDecision = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source,
      clientId: task.clientId,
      clientName: task.client,
      findingId: task.id,
      findingType: findingTypeOf(task),
      issue: task.issue,
      description: task.description,
      priority: task.priority,
      status,
      reason,
      actor: "Bookkeeper",
      at: new Date().toISOString(),
      fingerprint: sourceFingerprint(task, sourceRecordsFor(task)),
    };
    setReviewDecisions((current) => [decision, ...current]);
  };
  const reviewFinding = (task: WorkTask) => {
    if (latestReviewDecisions.get(decisionKey(source, task.id))?.status !== "reviewing" || isDismissedFinding(task)) recordReviewDecision(task, "reviewing");
    openTask(task);
  };
  const activeClient = source === "demo" && selectedClient ? clients.find((client) => client.id === selectedClient.id) ?? selectedClient : null;
  const visibleTasks = filterTasks(allTasks, { clientId: activeClient?.id });
  const hasDetail = !activeClient || activeClient.id === demoClient.id || ADDITIONAL_DEMO_CLIENT_IDS.includes(activeClient.id);
  const showNoDetail = Boolean(activeClient) && !hasDetail && detailViews.includes(view);
  const scopeName = source === "demo" ? activeClient?.name ?? demoClient.name : sandboxName;
  const clientMonthEnd = (client: Client) => {
    if (client.id !== demoClient.id && !ADDITIONAL_DEMO_CLIENT_IDS.includes(client.id)) return null;
    if (selectedClient?.id === client.id && monthEndView.checklist) return completionPercent(monthEndView.checklist);
    const stored = otherClientMonthEnd[client.id];
    return stored ? monthEndPercent(stored) : client.monthEnd;
  };
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
      setSelectedRequest((source === "demo" ? allDemoRequests : scopedRequests).find((item) => item.id === task.requestId) ?? null);
      setView("Client Requests");
      return;
    }
    // A task about one record opens that record, so the user does not have to find it again.
    if (task.recordId) {
      // The owner's records are read directly: the client selection above has not rendered yet.
      const owner = source === "demo" ? (task.clientId === records.client.id ? records : otherClientRecords.find((item) => item.client.id === task.clientId) ?? records) : null;
      const transaction = (owner ? owner.transactions : reviewData?.transactions ?? []).find((item) => item.id === task.recordId);
      const invoice = (owner ? owner.invoices : reviewData?.invoices ?? []).find((item) => item.id === task.recordId);
      const bill = (owner ? owner.bills : reviewData?.bills ?? []).find((item) => item.id === task.recordId);
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
            today={todayIso}
          />
        ) : view === "Clients" ? (
          <Clients
            source={source}
            clients={clients}
            tasks={allTasks}
            available={queueAvailable}
            companyName={sandboxName}
            connected={quickBooksStatus.connected}
            period={period}
            today={todayIso}
            monthEndFor={clientMonthEnd}
            monthEndLive={(client) => (selectedClient?.id === client.id && Boolean(monthEndView.checklist)) || Boolean(otherClientMonthEnd[client.id])}
            onOpen={openClient}
            onOpenReconcile={(client) => { selectClient(client); setView("Reconcile"); }}
            onOpenCompany={openCompany}
          />
        ) : view === "Bookkeeping Review" ? (
          <BookkeepingReview source={source} rows={buildFindingRows({ source, live: visibleTasks.filter(isAccountingFinding), dismissed: dismissedFindings.filter(isAccountingFinding), decisions: reviewDecisions, records: sourceRecordsFor, detailClientId: source === "demo" && !activeClient ? null : records.client.id })} history={reviewDecisions.filter((decision) => decision.source === source && (!activeClient || decision.clientId === activeClient.id))} decisionsSaved={reviewDecisionsSaved} available={queueAvailable} loading={reviewLoading} error={reviewError} today={localIsoDate(currentDate)} selectedRecurring={selectedRecurring} onBackRecurring={() => setSelectedRecurring(null)} onResolveRecurring={resolveRecurringReminder} onSourceChange={changeAppDataSource} onReview={reviewFinding} onDismiss={(task, reason) => recordReviewDecision(task, "dismissed", reason)} onReopen={(task) => recordReviewDecision(task, "reopened")} />
        ) : view === "Inbox" ? (
          <Inbox tasks={visibleTasks} source={source} available={queueAvailable} loading={reviewLoading} error={reviewError} scopeLabel={activeClient?.name ?? (source === "demo" ? "All clients" : sandboxName)} today={localIsoDate(currentDate)} onOpenTask={openTask} />
        ) : view === "Transactions" ? (
          <Transactions
            transactions={tabTransactions}
            quickBooksTransactions={quickBooksTransactions}
            source={appDataSource}
            clientId={activeClient?.id ?? null}
            scopeLabel={activeClient?.name ?? (appDataSource === "demo" ? "All clients" : sandboxName)}
            clientNames={clientNameById}
            period={period}
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
            today={todayIso}
            period={period}
            homeSignal={homeSignal}
            entryTools={entryTools}
            loadEntries={() => entriesRef.current}
            paymentBooks={appDataSource === "demo" ? paymentBooks : []}
            onPeriodChange={setPeriod}
            onSourceChange={changeAppDataSource}
            pickClient={appDataSource === "demo" && !activeClient}
            clientChoices={clients}
            onSelectClient={selectClient}
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
            allRows={appDataSource === "demo" && !activeClient ? allClientInvoiceRows : undefined}
            today={todayIso}
            onSelectRow={openInvoiceRow}
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
            allRows={appDataSource === "demo" && !activeClient ? allClientBillRows : undefined}
            today={todayIso}
            onSelectRow={openBillRow}
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
            needsClient={appDataSource === "demo" && !activeClient}
            clientChoices={clients.map((client) => ({ id: client.id, name: client.name }))}
            onSelectClient={(id) => { const client = clients.find((item) => item.id === id); if (client) selectClient(client); }}
            ledger={source === "demo" ? ledger : undefined}
            accountantTools={
              <AccountantTools
                key={`${appDataSource}:${activeDemoClientId}`}
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
            clientSelected={source === "demo" ? Boolean(activeClient) : true}
            today={todayIso}
            requests={source === "demo" ? (activeClient ? allDemoRequests.filter((request) => request.clientId === activeClient.id) : allDemoRequests) : scopedRequests}
            documents={source === "demo" && activeClient ? scopedDocuments.filter((document) => document.clientId === activeClient.id) : scopedDocuments}
            auditEvents={portalAudit.filter((event) => (source === "quickbooks" ? event.source === "quickbooks" : event.source === "demo" && (!activeClient || event.clientId === activeClient.id)))}
            transactions={transactions}
            selectedRequest={selectedRequest}
            draft={requestDraft}
            onDraftChange={setRequestDraft}
            onSelect={openRequestRow}
            onBack={() => setSelectedRequest(null)}
            onUpdate={updateRequest}
            onApplyResponse={applyClientResponse}
            onCreateRequest={createManagedRequest}
            onCreateClientMessage={createClientMessageRequest}
            onSendClientMessage={sendClientMessage}
            onSendFollowUp={sendFollowUp}
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
            devBypass={devBypass}
            rules={scopedRules}            rulePreviewTransactions={records.transactions}
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

function TaskCardList({ tasks, showClient, today, onOpenTask }: { tasks: WorkTask[]; showClient: boolean; today?: string; onOpenTask: (task: WorkTask) => void }) {
  return (
    <div className="review-card-list">
      {tasks.map((task) => {
        const due = task.dueDate && today ? describeDue(task.dueDate, today) : undefined;
        return (
          <button className="review-card" key={task.id} onClick={() => onOpenTask(task)}>
            <div className="review-card-top">
              <span className="review-type">{showClient ? `${task.client} · ` : ""}{task.issue}</span>
              <span className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</span>
            </div>
            <p>{task.description}</p>
            {task.amount !== undefined && <span className="review-amount">{formatMoney(task.amount)}</span>}
            <div className="review-card-footer">
              <span>
                {task.suspected ? "Possible issue · " : ""}
                {due && <strong className={`due-label ${due.tone}`}>{due.label}</strong>}
                {due ? " · " : ""}
                {task.dueDate ? `Due ${formatDueDate(task.dueDate)} · ` : ""}Next: {task.action}
              </span>
              <span className="task-action">{taskButtonLabel(task)} <span aria-hidden="true">→</span></span>
            </div>
          </button>
        );
      })}
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
  today,
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
  today: string;
}) {
  if (client || companyOpen)
    return (
      <ClientDashboard
        today={today}
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
      <section className="metrics-grid grouped" aria-label="Bookkeeping overview">
        <div className="metric-group">
          <h3 className="metric-group-title">Clients</h3>
          <div className="metric-group-cards">
            <MetricCard label="Clients" value={`${clientTotal}`} note={source === "demo" ? "Demo clients" : "Connected company"} tone="green" onClick={onViewClients} />
            <MetricCard label="Clients needing attention" value={value(summary.clientsNeedingAttention)} note={available ? `of ${clientTotal}` : "Data not loaded"} tone="red" onClick={onOpenInbox} />
            <MetricCard label="Month ends open" value={value(summary.clientsWithMonthEndOpen)} note="Clients not finished" tone="green" onClick={onMonthEnd} />
          </div>
        </div>
        <div className="metric-group">
          <h3 className="metric-group-title">Review work</h3>
          <div className="metric-group-cards">
            <MetricCard label="Transactions to review" value={value(summary.transactions)} note="Needs a look" tone="amber" onClick={onTransactions} />
            <MetricCard label="Reconciliation issues" value={value(summary.reconciliation)} note="Accounts to check" tone="blue" onClick={onReconcile} />
            <MetricCard label="Client questions" value={value(summary.clientQuestions)} note="Open requests" tone="purple" onClick={onOpenRequests} />
          </div>
        </div>
        <div className="metric-group">
          <h3 className="metric-group-title">Money and priorities</h3>
          <div className="metric-group-cards">
            <MetricCard label="Overdue invoices" value={value(summary.overdueInvoices)} note="Receivables" tone="red" onClick={onReceivables} />
            <MetricCard label="Overdue bills" value={value(summary.overdueBills)} note="Payables" tone="red" onClick={onPayables} />
            <MetricCard label="High priority" value={value(summary.high)} note="Do these first" tone="red" onClick={onOpenInbox} />
          </div>
        </div>
      </section>
      <section className="content-grid">
        <div className="panel work-panel work-panel-primary">
          <div className="panel-heading">
            <div>
              <h2>Today's work</h2>
              <p className="muted">Most urgent first: high priority, then the earliest due date.</p>
            </div>
            <span className="count-pill">{available ? `${tasks.length} tasks` : NOT_AVAILABLE}</span>
          </div>
          {available && nextUp.length === 0 && <div className="empty-state"><span>✓</span><h2>You're all caught up.</h2><p className="muted">Nothing needs attention right now.</p></div>}
          <TaskCardList tasks={nextUp} showClient={source === "demo"} today={today} onOpenTask={onOpenTask} />
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
                <button className="client-card" key={item.id} onClick={() => onOpen(item)} aria-label={`Open ${item.name}: ${open === 0 ? "all clear" : `${open} outstanding`}`}>
                  <div className="company-avatar">{item.initials}</div>
                  <div className="client-info">
                    <strong>{item.name}</strong>
                    <span>{open === 0 ? "No outstanding tasks" : `${open} outstanding ${open === 1 ? "task" : "tasks"}`}</span>
                  </div>
                  <span className={`client-status ${open === 0 ? "clear" : "attention"}`}>{open === 0 ? "All clear" : "Needs attention"}</span>
                  <span className="task-action">Open <span aria-hidden="true">→</span></span>
                </button>
              );
            })
          ) : (
            <button className="client-card" onClick={onOpenCompany} aria-label={`Open ${companyName}`}>
              <div className="company-avatar">QB</div>
              <div className="client-info">
                <strong>{companyName}</strong>
                <span>{available ? `${tasks.length} outstanding ${tasks.length === 1 ? "task" : "tasks"}` : NOT_AVAILABLE}</span>
              </div>
              {available ? (
                <span className={`client-status ${tasks.length === 0 ? "clear" : "attention"}`}>{tasks.length === 0 ? "All clear" : "Needs attention"}</span>
              ) : (
                <span className="client-status unknown">Data not loaded</span>
              )}
              <span className="task-action">Open <span aria-hidden="true">→</span></span>
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
  period,
  today,
  monthEndFor,
  monthEndLive,
  onOpen,
  onOpenReconcile,
  onOpenCompany,
}: {
  source: AccountSource;
  clients: Client[];
  tasks: WorkTask[];
  available: boolean;
  companyName: string;
  connected: boolean;
  period: Period;
  today: string;
  monthEndFor: (client: Client) => number | null;
  /** True when the month-end figure was calculated for the selected period rather than being the stored summary. */
  monthEndLive: (client: Client) => boolean;
  onOpen: (client: Client) => void;
  onOpenReconcile: (client: Client) => void;
  onOpenCompany: () => void;
}) {
  const counts = countByClient(tasks);
  const companyTaskCount = tasks.reduce((total, task) => total + task.count, 0);
  const qbPeriod = periodNotice(period, null, today);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Clients</h2>
          <p className="muted">Keep every company moving forward.</p>
        </div>
        <div className="add-client">
          <button className="primary-button" disabled aria-describedby="add-client-note">
            Add client <span>+</span>
          </button>
          <small id="add-client-note" className="muted">Not available yet: adding clients has not been built.</small>
        </div>
      </section>
      <div className="client-card-grid">
        {source === "quickbooks" ? (
          <button className="full-client-card" onClick={onOpenCompany}>
            <div className="full-client-header">
              <span className="company-avatar">QB</span>
              <span className="client-card-title">
                <strong>{companyName}</strong>
                <span>QuickBooks Sandbox · Period: {qbPeriod.label}{qbPeriod.historical ? " (historical)" : ""}</span>
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
            const notice = periodNotice(period, client.month, today);
            const attention = attentionStatus(open);
            // Stored summary figures only describe their own period; never present them for another one.
            const monthEndShown = monthEnd !== null && (notice.figuresMatch || monthEndLive(client)) ? monthEnd : null;
            const monthEndLabel = monthEndStatus(monthEndShown);
            const next = nextTaskFor(tasks, client.id, today);
            return (
              <article className="full-client-card" key={client.id} data-client-id={client.id}>
                <div className="full-client-header">
                  <span className="company-avatar">{client.initials}</span>
                  <span className="client-card-title">
                    <button className="card-link" onClick={() => onOpen(client)}>
                      <strong>{client.name}</strong>
                    </button>
                    <span>
                      Period: {notice.label}
                      {notice.historical && <em className="period-tag"> · Historical period</em>}
                    </span>
                  </span>
                  <span className={`status-badge ${attention.tone === "success" ? "success" : "warning"}`}>{attention.label}</span>
                </div>
                <div className="client-card-details">
                  <span>
                    <small>Items needing attention</small>
                    <strong className={open ? "attention-number" : "success-text"}>{open}</strong>
                  </span>
                  <span>
                    <small>Reconciliation</small>
                    <button className="card-action reconcile-link" onClick={() => onOpenReconcile(client)} aria-label={`Open Reconcile for ${client.name}`}>
                      {notice.figuresMatch ? client.reconciliation : `Check ${notice.label}`} <span aria-hidden="true">→</span>
                    </button>
                  </span>
                  <span>
                    <small>Next task</small>
                    <strong className="next-task">{next ? `${next.text}${next.due ? ` · ${next.due}` : ""}` : "Nothing outstanding"}</strong>
                  </span>
                </div>
                <div className="client-card-progress">
                  <span>
                    <small>{monthEndLabel.label}</small>
                    <strong>{monthEndShown === null ? (monthEnd === null ? NOT_AVAILABLE : `Not available for ${notice.label}`) : `${monthEndShown}%`}</strong>
                  </span>
                  <span className="progress-bar">
                    <span style={{ width: `${monthEndShown ?? 0}%` }} />
                  </span>
                  <span className="row-arrow" aria-hidden="true">→</span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

function BookkeepingReview({
  source,
  rows,
  history,
  decisionsSaved,
  available,
  loading,
  error,
  today,
  selectedRecurring,
  onBackRecurring,
  onResolveRecurring,
  onSourceChange,
  onReview,
  onDismiss,
  onReopen,
}: {
  source: ReviewSource;
  rows: FindingRow[];
  history: ReviewDecision[];
  decisionsSaved: boolean;
  available: boolean;
  loading: boolean;
  error: string | null;
  today: string;
  selectedRecurring: RecurringPattern | null;
  onBackRecurring: () => void;
  onResolveRecurring: (pattern: RecurringPattern, status: "confirmed" | "dismissed") => void;
  onSourceChange: (source: ReviewSource) => void;
  onReview: (task: WorkTask) => void;
  onDismiss: (task: WorkTask, reason: string) => void;
  onReopen: (task: WorkTask) => void;
}) {
  const [filters, setFilters] = useState<FindingFilters>({ client: "All", type: "All", priority: "All", status: "Active", query: "" });
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const setFilter = (patch: Partial<FindingFilters>) => setFilters((current) => ({ ...current, ...patch }));
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
  const active = rows.filter((row) => row.status === "Open" || row.status === "Under review").map((row) => row.task);
  const summary = summarizeFindings(active);
  const visibleRows = filterFindingRows(rows, filters);
  const clientOptions = [...new Map(rows.map((row) => [row.task.clientId, row.task.client])).entries()];
  const figure = (value: number) => (available ? `${value}` : NOT_AVAILABLE);
  const filtersActive = filters.client !== "All" || filters.type !== "All" || filters.priority !== "All" || filters.status !== "Active" || filters.query.trim() !== "";
  const submitDismiss = (task: WorkTask) => {
    if (!reason.trim()) return;
    onDismiss(task, reason.trim());
    setDismissing(null);
    setReason("");
  };
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Bookkeeping Review</h2>
          <p className="muted">Accounting quality checks. Findings marked "possible" are suggestions to look at, not confirmed errors. Reminders such as overdue invoices and bills are in the Inbox.</p>
        </div>
        <span className="attention-summary"><strong>{figure(summary.total)}</strong> review findings</span>
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {loading && <div className="data-state-message">Loading QuickBooks Sandbox review data...</div>}
      {error && <div className="data-state-message error">{error}</div>}
      {!available && !loading && !error && <div className="data-state-message">{NOT_AVAILABLE}: QuickBooks Sandbox data has not been loaded.</div>}
      <div className="review-summary-grid">
        <SummaryCard value={figure(summary.total)} label="Total review findings" tone="red" />
        <SummaryCard value={figure(summary.duplicates)} label="Possible duplicates" tone="amber" />
        <SummaryCard value={figure(summary.categorization)} label="Categorization issues" tone="blue" />
        <SummaryCard value={figure(summary.missingInfo)} label="Missing information" tone="purple" />
      </div>
      <div className="queue-filters review-filters">
        <label>
          Search
          <input type="search" placeholder="Vendor, reference, client, amount…" value={filters.query} onChange={(event) => setFilter({ query: event.target.value })} />
        </label>
        {clientOptions.length > 1 && (
          <label>
            Review client
            <select value={filters.client} onChange={(event) => setFilter({ client: event.target.value })}>
              <option value="All">All clients</option>
              {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        <label>
          Finding type
          <select value={filters.type} onChange={(event) => setFilter({ type: event.target.value as FindingFilters["type"] })}>
            <option value="All">All types</option>
            {findingTypes.map((type) => <option key={type} value={type}>{findingTypeLabel[type]}</option>)}
          </select>
        </label>
        <label>
          Priority
          <select value={filters.priority} onChange={(event) => setFilter({ priority: event.target.value as FindingFilters["priority"] })}>
            <option value="All">All priorities</option>
            {taskPriorities.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          Review status
          <select value={filters.status} onChange={(event) => setFilter({ status: event.target.value as FindingFilters["status"] })}>
            <option value="Active">Needs review (open)</option>
            {reviewStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
            <option value="All">All statuses</option>
          </select>
        </label>
        <button className="secondary-button" onClick={() => setShowHistory((current) => !current)} aria-expanded={showHistory}>
          {showHistory ? "Hide review decisions" : "View review decisions"}
        </button>
      </div>
      <p className="muted decision-note">
        {decisionsSaved ? "Review decisions are temporary development records, stored only in this browser." : "Review decisions could not be saved and will be lost when this page closes."}
        {filtersActive && available ? ` Showing ${visibleRows.length} of ${rows.length} findings.` : ""}
      </p>
      {showHistory && (
        <div className="panel decision-history" aria-label="Review decisions">
          <h3>Previous review decisions</h3>
          {history.length === 0 ? <p className="muted">No review decisions have been recorded yet.</p> : (
            <ul>
              {history.map((decision) => (
                <li key={decision.id}>
                  <strong>{decision.status === "dismissed" ? "Dismissed" : decision.status === "reopened" ? "Reopened" : "Review started"}</strong>
                  {" · "}{decision.clientName} · {decision.issue}
                  {decision.reason ? ` · Reason: ${decision.reason}` : ""}
                  <small>{decision.actor ? `${decision.actor} · ` : ""}{new Date(decision.at).toLocaleString()}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {available && visibleRows.length === 0 ? (
        <div className="empty-state">
          <span>✓</span>
          <h2>{rows.length === 0 ? "No review findings." : "No findings match."}</h2>
          <p className="muted">{rows.length === 0 ? "No accounting review findings were found." : "No findings match your search and filters."}</p>
        </div>
      ) : (
        <div className="review-card-list">
          {visibleRows.map((row) => {
            const { task } = row;
            const explanation = explainFinding(task);
            const due = task.dueDate ? describeDue(task.dueDate, today) : undefined;
            const resolved = row.status === "Resolved";
            return (
              <article className="review-card finding-card" key={row.key} data-finding-id={task.id}>
                <div className="review-card-top">
                  <span className="review-type">{source === "demo" ? `${task.client} · ` : ""}{task.issue} · {findingTypeLabel[rowType(row)]}</span>
                  <span>
                    <span className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</span>{" "}
                    <span className={`inbox-status finding-status ${taskSlug(row.status)}`}>{row.status}</span>
                  </span>
                </div>
                <dl className="finding-details">
                  <div><dt>What was detected</dt><dd>{explanation.detected}{task.amount !== undefined && <> <strong className="review-amount">{formatMoney(task.amount)}</strong></>}</dd></div>
                  {!resolved && <div><dt>Why it was flagged</dt><dd>{explanation.why}</dd></div>}
                  {resolved && <div><dt>Result</dt><dd>Resolved: the source record no longer triggers this check.</dd></div>}
                  <div><dt>Next action</dt><dd>{resolved ? "None." : explanation.next}{due && <> · <strong className={`due-label ${due.tone}`}>{due.label}</strong></>}</dd></div>
                  {row.changedSinceDismissed && <div><dt>Note</dt><dd>Shown again because the source record changed after it was dismissed.</dd></div>}
                  {row.status === "Dismissed" && row.decision && (
                    <div><dt>Dismissed</dt><dd>Reason: {row.decision.reason} <small>({row.decision.actor ? `${row.decision.actor}, ` : ""}{new Date(row.decision.at).toLocaleString()})</small></dd></div>
                  )}
                </dl>
                {!resolved && (
                  <div className="finding-actions">
                    {row.status === "Dismissed" ? (
                      <button className="secondary-button" onClick={() => onReopen(task)}>Reopen finding</button>
                    ) : dismissing === row.key ? (
                      <form className="dismiss-form" onSubmit={(event) => { event.preventDefault(); submitDismiss(task); }}>
                        <label>
                          Reason for dismissing
                          <input autoFocus required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this not a problem?" />
                        </label>
                        <button className="primary-button" type="submit" disabled={!reason.trim()}>Confirm dismiss</button>
                        <button className="secondary-button" type="button" onClick={() => { setDismissing(null); setReason(""); }}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <button className="primary-button" onClick={() => onReview(task)}>Review finding</button>
                        <button className="secondary-button" onClick={() => { setDismissing(row.key); setReason(""); }}>Dismiss finding</button>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
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
  today,
  onOpenTask,
}: {
  tasks: WorkTask[];
  source: AccountSource;
  available: boolean;
  loading: boolean;
  error: string | null;
  scopeLabel: string;
  today: string;
  onOpenTask: (task: WorkTask) => void;
}) {
  const [type, setType] = useState<TaskType | "All">("All");
  const [priority, setPriority] = useState<TaskPriority | "All">("All");
  const [status, setStatus] = useState<TaskStatus | "All">("All");
  const [readiness, setReadiness] = useState<Readiness>("all");
  const [query, setQuery] = useState("");
  // Counts are item counts (a summary row can stand for several items), so they can exceed the number of rows.
  const total = (list: WorkTask[]) => list.reduce((sum, task) => sum + task.count, 0);
  const narrowed = (options: { type?: TaskType | "All"; readiness?: Readiness }) =>
    searchTasks(filterByReadiness(filterTasks(tasks, { type: options.type ?? "All", priority, status }), options.readiness ?? readiness), query);
  const visibleTasks = narrowed({ type });
  const typeCount = (option: TaskType | "All") => total(narrowed({ type: option }));
  const figure = (value: number) => (available ? `${value}` : NOT_AVAILABLE);
  const allItems = total(tasks);
  const readyItems = total(filterByReadiness(tasks, "ready"));
  const waitingItems = total(filterByReadiness(tasks, "waiting"));
  const filtersActive = type !== "All" || priority !== "All" || status !== "All" || readiness !== "all" || query.trim() !== "";

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
          <strong>{figure(allItems)}</strong> items need attention
          {available && <small className="muted"> {readyItems} ready for you · {waitingItems} waiting on others</small>}
        </span>
      </section>
      {loading && <div className="data-state-message">Loading QuickBooks Sandbox data...</div>}
      {error && <div className="data-state-message error">{error}</div>}
      {!available && !loading && !error && <div className="data-state-message">{NOT_AVAILABLE}: QuickBooks Sandbox data has not been loaded. Connect in Settings to see real tasks.</div>}
      <div className="filter-row" aria-label="Inbox filters">
        {inboxTypeFilters.map((option) => (
          <button
            className={`filter-button ${type === option ? "active" : ""}`}
            key={option}
            onClick={() => setType(option)}
          >
            {option}
            <span>{typeCount(option)}</span>
          </button>
        ))}
      </div>
      <div className="queue-filters">
        <label>
          Search
          <input type="search" className="inbox-search" placeholder="Client, vendor, invoice, amount…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Work
          <select value={readiness} onChange={(event) => setReadiness(event.target.value as Readiness)}>
            <option value="all">All tasks</option>
            <option value="ready">Ready for me</option>
            <option value="waiting">Waiting on client</option>
          </select>
        </label>
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
      {available && filtersActive && (
        <p className="muted inbox-count" role="status">
          Showing {total(visibleTasks)} of {allItems} items
        </p>
      )}
      {visibleTasks.length === 0 ? (
        available ? (
          <div className="empty-state">
            <span>✓</span>
            <h2>{tasks.length === 0 ? "You're all caught up." : "No tasks match."}</h2>
            <p className="muted">{tasks.length === 0 ? "There is nothing waiting for your attention." : "No tasks match your search and filters. Clear the search or change a filter to see more."}</p>
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
            <span>Action</span>
          </div>
          {visibleTasks.map((task) => {
            const due = dueLabel(task, today);
            return (
              <div className="inbox-row" key={task.id} title={`Next: ${task.action}`}>
                <strong>{task.client}</strong>
                <span className="inbox-type">{task.type}</span>
                <span>{task.suspected ? "Possible issue: " : ""}{cleanDescription(task)}</span>
                <span className={`priority-badge ${task.priority.toLowerCase()}`}>
                  {task.priority}
                </span>
                <span className="inbox-due">
                  {task.dueDate ? (
                    <>
                      {due && <strong className={`due-${due.tone}`}>{due.label}</strong>}
                      <small>{formatDueDate(task.dueDate)}</small>
                    </>
                  ) : "—"}
                </span>
                <span className={`inbox-status ${taskSlug(task.status)}`}>
                  {task.status}
                  <small>{isWaiting(task) ? " · waiting on others" : " · ready for you"}</small>
                </span>
                <button className="card-link inbox-action" onClick={() => onOpenTask(task)}>{taskButtonLabel(task)}</button>
              </div>
            );
          })}
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
  clientSelected,
  today,
  requests,
  documents,
  auditEvents,
  transactions,
  selectedRequest,
  draft,
  onDraftChange,
  onSelect,
  onBack,
  onUpdate,
  onApplyResponse,
  onCreateRequest,
  onCreateClientMessage,
  onSendClientMessage,
  onSendFollowUp,
  onSubmitDocument,
  onApproveRequest,
  onRejectRequest,
  onMatchReceipt,
}: {
  source: AccountSource;
  clients: Client[];
  selectedClientId: string;
  /** False while All clients is selected: nothing can be created until one client is chosen. */
  clientSelected: boolean;
  today: string;
  requests: ClientRequest[];
  documents: ClientDocument[];
  auditEvents: PortalAuditEvent[];
  transactions: Transaction[];
  selectedRequest: ClientRequest | null;
  draft: RequestDraft;
  onDraftChange: (draft: RequestDraft) => void;
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
  onSendFollowUp: (request: ClientRequest, message: string) => void;
  onSubmitDocument: (request: ClientRequest, fixtureId: string, note: string) => void;
  onApproveRequest: (request: ClientRequest, message: string) => void;
  onRejectRequest: (request: ClientRequest, message: string) => void;
  onMatchReceipt: (request: ClientRequest, documentId: string, transactionId: string) => void;
}) {
  const [filters, setFilters] = useState<RequestFilters>(emptyRequestFilters);
  const [mode, setMode] = useState<"bookkeeper" | "client">("bookkeeper");
  const [portalClientId, setPortalClientId] = useState(selectedClientId);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [portalSubject, setPortalSubject] = useState("");
  const [portalMessage, setPortalMessage] = useState("");

  useEffect(() => {
    setPortalClientId(selectedClientId);
    setFilters((current) => (current.clientId === ALL_CLIENTS ? current : { ...current, clientId: ALL_CLIENTS }));
    setOpenDocumentId(null);
  }, [selectedClientId]);

  const clientNameOf = (request: ClientRequest) => clients.find((client) => client.id === request.clientId)?.name ?? request.client;
  const portalRequests = requests.filter((request) => requestMatchesClient(request, portalClientId));
  const portalDocuments = documents.filter((document) => document.clientId === portalClientId);
  const portalCounts = requestCounts(portalRequests, today);
  const outstanding = portalCounts.active;
  const completed = portalCounts.completed;

  // Bookkeeper view works over every request in scope; the simulated client sees only their own.
  const baseRequests = mode === "client" ? portalRequests : requests;
  const baseDocuments = mode === "client" ? portalDocuments : documents;
  const scopeCounts = requestCounts(baseRequests, today);
  const clientFilters = mode === "client" ? { ...filters, clientId: ALL_CLIENTS } : filters;
  // Status counts ignore the status filter itself so each chip shows what it would show if chosen.
  const searched = filterRequests(baseRequests, clientFilters, baseDocuments, clientNameOf, { ignoreStatus: true });
  const searchedCounts = requestCounts(searched, today);
  const visibleRequests = sortRequests(filterRequests(baseRequests, clientFilters, baseDocuments, clientNameOf));
  const filtersActive = hasActiveRequestFilters(clientFilters);
  const clientsWithRequests = clients.filter((client) => requests.some((request) => request.clientId === client.id));
  const showClientFilter = mode === "bookkeeper" && !clientSelected && clientsWithRequests.length > 1;
  const multiClient = new Set(visibleRequests.map((request) => request.clientId)).size > 1;
  const visibleDocuments = baseDocuments.filter((document) => mode === "client" || filters.clientId === ALL_CLIENTS || document.clientId === filters.clientId);
  const openDocument = visibleDocuments.find((document) => document.id === openDocumentId) ?? null;
  const openDocumentRequest = openDocument ? requests.find((request) => request.id === openDocument.requestId) : undefined;

  const effectiveClientId = clientSelected ? selectedClientId : draft.clientId;
  const effectiveClientName = clients.find((client) => client.id === effectiveClientId)?.name;
  const message = draftMessage(draft);
  const canSubmit = Boolean(effectiveClientId && effectiveClientName && message.trim());
  const dirty = draftIsDirty(draft);
  const defaultDue = addDays(today, 3);
  const updateDraft = (changes: Partial<RequestDraft>) => onDraftChange({ ...draft, ...changes });
  const submitDraft = (status: ClientRequestStatus) => {
    if (!canSubmit || !effectiveClientId) return;
    onCreateRequest({
      clientId: effectiveClientId,
      requestType: draft.type,
      question: message.trim(),
      dueDate: draft.dueDate ?? defaultDue,
      status,
      relatedTransaction: draft.transaction.trim() || undefined,
      relatedAmount: draft.amount.trim() || undefined,
    });
    onDraftChange(emptyRequestDraft);
    setConfirmDiscard(false);
  };

  if (selectedRequest)
    return (
      <ClientRequestDetail
        source={source}
        role={mode}
        request={selectedRequest}
        today={today}
        documents={documents.filter((document) => document.requestId === selectedRequest.id || requestDocumentIds(selectedRequest, documents).includes(document.id))}
        transactions={transactions}
        onBack={onBack}
        onUpdate={onUpdate}
        onApplyResponse={onApplyResponse}
        onSendClientMessage={onSendClientMessage}
        onSendFollowUp={onSendFollowUp}
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
        <span className="attention-summary" data-testid="request-counts">
          <strong>{scopeCounts.active}</strong> active of {scopeCounts.total} total requests
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
        <div className="panel portal-panel" data-testid="request-composer">
          <div className="panel-heading">
            <div>
              <h2>New request</h2>
              <p className="muted">Ask a client for a receipt, statement, invoice, or answer. Nothing is sent to a real client in demo mode.</p>
            </div>
            {!draft.open && (
              <button className="primary-button" onClick={() => updateDraft({ open: true })}>
                {dirty ? "Resume Draft" : "New Request"}
              </button>
            )}
          </div>
          {!draft.open && dirty && <p className="muted" data-testid="draft-kept">An unsaved request draft is being kept. Resume it or discard it.</p>}
          {draft.open && (
            <>
              <div className="queue-filters">
                <label>
                  Client
                  {clientSelected ? (
                    <input value={effectiveClientName ?? ""} readOnly aria-readonly="true" />
                  ) : (
                    <select value={draft.clientId} onChange={(event) => updateDraft({ clientId: event.target.value })}>
                      <option value="">Select a client…</option>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                    </select>
                  )}
                </label>
                <label>
                  Request type
                  <select value={draft.type} onChange={(event) => updateDraft({ type: event.target.value as ClientRequestType })}>
                    {REQUEST_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  Due date
                  <input type="date" value={draft.dueDate ?? defaultDue} onChange={(event) => updateDraft({ dueDate: event.target.value })} />
                </label>
              </div>
              <div className="queue-filters">
                <label>
                  Related transaction or document (optional)
                  <input value={draft.transaction} onChange={(event) => updateDraft({ transaction: event.target.value })} placeholder="Home Depot" />
                </label>
                <label>
                  Amount (optional)
                  <input value={draft.amount} onChange={(event) => updateDraft({ amount: event.target.value })} placeholder="$341.22" />
                </label>
              </div>
              <label className="portal-compose">
                Request message (suggested text can be edited)
                <textarea value={message} onChange={(event) => updateDraft({ message: event.target.value })} placeholder="Type the question for your client." />
              </label>
              {!effectiveClientId && <p className="muted" data-testid="draft-needs-client">Select a specific client before saving or sending a request.</p>}
              {effectiveClientId && !message.trim() && <p className="muted">Add a request message to continue.</p>}
              {confirmDiscard && (
                <div className="me-confirm" role="alertdialog" aria-label="Discard request draft" data-testid="discard-confirm">
                  <strong>Discard this unsaved request?</strong>
                  <p className="muted">Your changes to this request will be lost.</p>
                  <div className="reset-actions">
                    <button className="secondary-button" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
                    <button className="secondary-button" onClick={() => { onDraftChange(emptyRequestDraft); setConfirmDiscard(false); }}>Discard changes</button>
                  </div>
                </div>
              )}
              <div className="reset-actions">
                <button className="secondary-button" onClick={() => (dirty ? setConfirmDiscard(true) : onDraftChange(emptyRequestDraft))}>Discard draft</button>
                <button className="secondary-button" onClick={() => updateDraft({ open: false })}>Close (keep draft)</button>
                <button className="secondary-button" disabled={!canSubmit} onClick={() => submitDraft("Draft")}>Save Draft</button>
                <button className="primary-button" disabled={!canSubmit} onClick={() => submitDraft("Waiting for Client")}>Send Request <span>→</span></button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="request-toolbar" role="search">
        <label>
          Search requests
          <input
            type="search"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Client, vendor, transaction, document, or request text"
          />
        </label>
        {showClientFilter && (
          <label>
            Client
            <select value={filters.clientId} onChange={(event) => setFilters({ ...filters, clientId: event.target.value })}>
              <option value={ALL_CLIENTS}>All clients</option>
              {clientsWithRequests.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
        )}
        {filtersActive && <button className="secondary-button" onClick={() => setFilters(emptyRequestFilters)}>Reset Filters</button>}
        {filtersActive && <span className="muted" data-testid="requests-showing">Showing {visibleRequests.length} of {scopeCounts.total}</span>}
      </div>
      <div className="filter-row" aria-label="Request status filters">
        {([
          ["All", "All requests", searchedCounts.total],
          ["Active", "Active", searchedCounts.active],
          ...(["Draft", "Sent", "Waiting for Client", "Client Responded", "Needs Follow-Up", "Completed"] as const).map((status) => [status, status, searchedCounts.byStatus[status] ?? 0] as const),
        ] as ReadonlyArray<readonly [RequestStatusFilter, string, number]>).map(([option, label, count]) => (
          <button className={`filter-button ${filters.status === option ? "active" : ""}`} key={option} onClick={() => setFilters({ ...filters, status: option })}>{label}<span>{count}</span></button>
        ))}
      </div>
      <div className="request-documents-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{mode === "client" ? "Your demo documents" : "Recent documents"}</h2>
              <p className="muted">Metadata only — no real documents are stored here.</p>
            </div>
          </div>
          <div className="audit-log-list">
            {visibleDocuments.slice(0, 6).map((document) => (
              <div className="audit-log-row" key={document.id} data-testid="document-row">
                <strong>{document.name}</strong>
                <span>{document.type} · {document.date}</span>
                <span>{document.reviewStatus}{document.matchStatus ? ` · ${document.matchStatus}` : ""}</span>
                <button className="secondary-button" onClick={() => setOpenDocumentId(openDocumentId === document.id ? null : document.id)}>
                  {openDocumentId === document.id ? "Hide Document" : "View Document"}
                </button>
              </div>
            ))}
            {visibleDocuments.length === 0 && <p className="muted">No demo documents yet.</p>}
          </div>
          {openDocument && (
            <div className="document-detail" data-testid="document-detail">
              <h3>{openDocument.name}</h3>
              <p className="muted"><strong>Demo metadata only</strong> — no file was uploaded or stored.</p>
              <dl>
                <dt>Type</dt><dd>{openDocument.type}</dd>
                <dt>Date</dt><dd>{openDocument.date}</dd>
                {openDocument.vendor && <><dt>Vendor</dt><dd>{openDocument.vendor}</dd></>}
                {openDocument.amount && <><dt>Amount</dt><dd>{openDocument.amount}</dd></>}
                <dt>Review</dt><dd>{openDocument.reviewStatus}{openDocument.matchStatus ? ` · ${openDocument.matchStatus}` : ""}</dd>
                <dt>Uploaded by</dt><dd>{openDocument.uploadedBy}</dd>
                {openDocument.notes && <><dt>Notes</dt><dd>{openDocument.notes}</dd></>}
              </dl>
              {openDocumentRequest
                ? <button className="primary-button" onClick={() => onSelect(openDocumentRequest)}>Open Related Request</button>
                : <p className="muted">No related request is on file for this document.</p>}
            </div>
          )}
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
          <span>{filtersActive ? "?" : "✓"}</span>
          <h2>{filtersActive ? "No requests match these filters." : "You're all caught up."}</h2>
          <p className="muted">{filtersActive ? "Try a different search or reset the filters." : mode === "client" ? "There are no requests for this simulated client right now." : "All client questions have been resolved."}</p>
        </div>
      ) : (
        <div className="request-card-grid">
          {visibleRequests.map((request) => {
            const step = nextStep(request);
            const due = requestDue(request, today);
            const docCount = requestDocumentIds(request, documents).length;
            return (
              <article className={`request-card ${step.waiting ? "waiting" : ""}`} key={request.id} data-testid="request-card">
                <div className="request-card-top">
                  <span className="company-avatar">{clientNameOf(request).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
                  <span>
                    <strong data-testid="request-client">{clientNameOf(request)}</strong>
                    <small>{request.requestType} · Created {request.dateCreated}</small>
                  </span>
                  <span className={`inbox-status ${statusLabel(request.status)}`}>{request.status}</span>
                </div>
                <div className="request-card-related">
                  <strong>{request.relatedTransaction || request.requestType}</strong>
                  <span>
                    {request.relatedAmount}
                    {request.dueDate ? ` · due ${formatDueDate(request.dueDate)}` : ""}
                    {due && <em className={`request-due due-${due.tone}`} data-testid="request-due"> · {due.label}</em>}
                  </span>
                </div>
                <p>{request.question}</p>
                <small className="muted">{requestHasResponse(request) ? "Client has responded." : "Waiting for a response."} {docCount > 0 ? `${docCount} document(s) attached.` : ""}</small>
                <small className="request-next" data-testid="request-next">Next: {step.text}</small>
                <div className="reset-actions">
                  <button className={step.needsBookkeeper && mode === "bookkeeper" ? "primary-button" : "secondary-button"} onClick={() => onSelect(request)}>
                    {mode === "client" ? "View Request" : step.action}
                  </button>
                  {mode === "bookkeeper" && step.action !== "View Request" && (
                    <button className="secondary-button" onClick={() => onSelect(request)}>View Request</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClientRequestDetail({
  source,
  role,
  request,
  today,
  documents,
  transactions,
  onBack,
  onUpdate,
  onApplyResponse,
  onSendClientMessage,
  onSendFollowUp,
  onSubmitDocument,
  onApproveRequest,
  onRejectRequest,
  onMatchReceipt,
}: {
  source: AccountSource;
  role: "bookkeeper" | "client";
  request: ClientRequest;
  today: string;
  documents: ClientDocument[];
  transactions: Transaction[];
  onBack: () => void;
  onUpdate: (request: ClientRequest) => void;
  onApplyResponse: (request: ClientRequest) => Promise<void>;
  onSendClientMessage: (request: ClientRequest, message: string) => void;
  onSendFollowUp: (request: ClientRequest, message: string) => void;
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
  const [followUp, setFollowUp] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [fixtureId, setFixtureId] = useState(fixturesForRequest(request)[0]?.id ?? "fixture-other");
  const requestDocuments = documents;
  const due = requestDue(request, today);
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
          <h2>{request.relatedTransaction || request.requestType}</h2>
          <p className="muted">
            {request.requestType} · Created {request.dateCreated}{request.relatedAmount ? ` · ${request.relatedAmount}` : ""}{request.dueDate ? ` · due ${formatDueDate(request.dueDate)}` : ""}{due ? ` (${due.label})` : ""}
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
              {request.status === "Draft" ? (
                <div className="reset-actions">
                  <p className="muted">This request is a saved draft and has not been sent to the client.</p>
                  <button className="primary-button" onClick={() => onSendFollowUp(request, "")}>Send Request <span>→</span></button>
                </div>
              ) : (
                <>
                  <label>
                    Follow-up message
                    <textarea value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="Gentle reminder: we still need this to finish the books." />
                  </label>
                  <div className="reset-actions">
                    <button className="secondary-button" disabled={!followUp.trim()} onClick={() => { onSendFollowUp(request, followUp); setFollowUp(""); }}>Send Follow-Up</button>
                  </div>
                </>
              )}
              <label>
                Review note
                <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Approved — thanks." />
              </label>
              <div className="reset-actions">
                <button className="secondary-button" onClick={() => onRejectRequest(request, reviewNote.trim())}>Needs follow-up</button>
                <button className="primary-button" onClick={() => onApproveRequest(request, reviewNote.trim())}>Complete Request <span>✓</span></button>
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
  allRows,
  today,
  onSelectRow,
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
  /** Every demo company's invoices, set only while All clients is selected. */
  allRows?: ReceivableRow[];
  today: string;
  onSelectRow: (row: ReceivableRow) => void;
  onBack: () => void;
  onRecordPayment: (kind: DocumentPaymentKind, documentId: string, input: DemoPaymentInput) => Promise<void>;
  onReversePayment: (kind: DocumentPaymentKind, documentId: string, paymentId: string, reason: string) => Promise<void>;
  onAskClient: (question: string, transaction: string, amount: string) => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  const [filters, setFilters] = useState<ReceivableFilters>(emptyReceivableFilters);
  const displayedInvoices = source === "demo" ? (allRows ? allRows.map((row) => row.invoice) : invoices) : quickBooksInvoices;
  const rows: ReceivableRow[] = source === "demo"
    ? allRows ?? invoices.map((invoice) => ({ invoice, clientId, clientName: "" }))
    : quickBooksInvoices.map((invoice) => ({ invoice, clientId: QUICKBOOKS_CLIENT_ID, clientName: "QuickBooks Sandbox" }));
  if (selectedInvoice)
    return (
      <InvoiceDetail
        clientId={clientId}
        invoice={selectedInvoice}
        book={bookForDocument(paymentBooks, 'invoice', selectedInvoice.id, clientId)}
        originalPaidCents={Math.round(selectedInvoice.amountPaid * 100) - activePaymentCents(bookForDocument(paymentBooks, 'invoice', selectedInvoice.id, clientId))}
        dateDefault={paymentDateDefault}
        readOnly={source === "quickbooks"}
        today={today}
        onBack={onBack}
        onRecordPayment={(input) => onRecordPayment('invoice', selectedInvoice.id, input)}
        onReversePayment={(payment, reason) => onReversePayment('invoice', selectedInvoice.id, payment.id, reason)}
        onAskClient={onAskClient}
      />
    );
  const aging = summarizeOpenItems(displayedInvoices, today);
  const filtered = filterRows(rows, filters, today);
  const counts = filterCounts(rows, filters, today);
  const multiClient = new Set(filtered.map((row) => row.clientId)).size > 1 || (source === "demo" && Boolean(allRows));
  const toggleAging = (option: AgingFilter) => setFilters((current) => ({ ...current, aging: current.aging === option ? "All" : option }));
  const agingCards: { label: string; value: number; tone: string; option: AgingFilter }[] = [
    { label: "Total Outstanding", value: aging.totalCents, tone: "red", option: "All" },
    { label: "Current (not yet due)", value: aging.currentCents, tone: "green", option: "Current" },
    { label: "1-30 Days Overdue", value: aging.days1to30Cents, tone: "amber", option: "1-30" },
    { label: "31-60 Days Overdue", value: aging.days31to60Cents, tone: "blue", option: "31-60" },
    { label: "60+ Days Overdue", value: aging.over60Cents, tone: "purple", option: "60+" },
  ];
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
        {agingCards.map((card) => (
          <button
            type="button"
            key={card.label}
            className={`summary-card ${card.tone} summary-card-button${card.option !== "All" && filters.aging === card.option ? " active" : ""}`}
            aria-pressed={card.option !== "All" && filters.aging === card.option}
            onClick={() => (card.option === "All" ? setFilters((current) => ({ ...current, aging: "All" })) : toggleAging(card.option))}
          >
            <strong>{formatMoney(card.value / 100)}</strong>
            <span>{card.label}</span>
          </button>
        ))}
      </div>
      <p className="muted ar-as-of" data-testid="ar-as-of">Aging as of {formatLongDate(today)} (your local date). Paid invoices are not counted. Select a card to filter the invoices below.</p>
      {aging.unreadable > 0 && <div className="data-state-message">{aging.unreadable} open invoice{aging.unreadable === 1 ? " has" : "s have"} no readable due date, so {aging.unreadable === 1 ? "it is" : "they are"} counted in the total but in no aging column.</div>}
      <div className="ar-filters">
        <label className="ar-search">
          <input type="search" aria-label="Search invoices" placeholder="Search customer, invoice number or amount" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
        </label>
        <div className="filter-group" role="group" aria-label="Payment status">
          <small>Payment status</small>
          <div className="filter-row">
            {paymentFilters.map((option) => (
              <button type="button" className={`filter-button ${filters.payment === option ? "active" : ""}`} key={option} aria-pressed={filters.payment === option} onClick={() => setFilters((current) => ({ ...current, payment: option }))}>
                {option}
                <span>{counts.payment[option]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group" role="group" aria-label="Aging">
          <small>Aging</small>
          <div className="filter-row">
            {agingFilters.map((option) => (
              <button type="button" className={`filter-button ${filters.aging === option ? "active" : ""}`} key={option} aria-pressed={filters.aging === option} onClick={() => setFilters((current) => ({ ...current, aging: option }))}>
                {option === "All" ? "Any aging" : option === "Overdue" ? "Overdue (any)" : option === "Current" ? "Current" : `${option} days`}
                <span>{counts.aging[option]}</span>
              </button>
            ))}
          </div>
        </div>
        {hasActiveFilters(filters) && <button type="button" className="secondary-button" onClick={() => setFilters(emptyReceivableFilters)}>Reset filters</button>}
      </div>
      <p className="muted" data-testid="ar-showing">Showing {filtered.length} of {rows.length} invoices.</p>
      <div className={`panel finance-list-panel ar-list${multiClient ? " with-client" : ""}`}>
        <div className="finance-list-heading">
          {multiClient && <span>Client</span>}
          <span>Customer</span>
          <span>Invoice</span>
          <span>Invoice date</span>
          <span>Due date</span>
          <span>Original</span>
          <span>Remaining</span>
          <span>Status</span>
          <span />
        </div>
        {filtered.length === 0 && <p className="muted ar-empty">No invoices match these filters.</p>}
        {filtered.map((row) => {
          const { invoice } = row;
          const due = invoiceDue(invoice, today);
          const pay = paymentStatus(invoice);
          return (
            <button className="finance-list-row" key={`${row.clientId}/${invoice.id}`} onClick={() => onSelectRow(row)}>
              {multiClient && <span>{row.clientName}</span>}
              <strong>{invoice.customer}</strong>
              <span>{invoice.number}</span>
              <span>{invoice.invoiceDate}</span>
              <span className="inbox-due">{invoice.dueDate}{due && <small className={`due-${due.tone}`}>{due.label}</small>}</span>
              <span>{formatMoney(invoice.amount)}</span>
              <strong>{formatMoney(invoice.amount - invoice.amountPaid)}</strong>
              <span className="ar-badges">
                <span className={`inbox-status ${pay.toLowerCase().replaceAll(" ", "-")}`}>{pay}</span>
                {isOverdue(invoice, today) && <span className="inbox-status overdue">Overdue</span>}
              </span>
              <span className="row-action">View Invoice</span>
            </button>
          );
        })}
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
  today,
  onBack,
  onRecordPayment,
  onReversePayment,
  onAskClient,
}: {
  today: string;
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
  const pay = paymentStatus(invoice);
  const due = invoiceDue(invoice, today);
  const late = isOverdue(invoice, today);
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
            {invoice.number} · Due {invoice.dueDate}{due ? ` · ${due.label}` : ""}
          </p>
        </div>
        <span className="ar-badges">
          <span className={`inbox-status ${pay.toLowerCase().replaceAll(" ", "-")}`}>{pay}</span>
          {late && <span className="inbox-status overdue">Overdue</span>}
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
              <strong>{late ? `${pay}, overdue` : pay}</strong>
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
  allRows,
  today,
  onSelectRow,
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
  /** Every demo company's bills, set only while All clients is selected. */
  allRows?: BillRow[];
  today: string;
  onSelectRow: (row: BillRow) => void;
  onBack: () => void;
  onRecordPayment: (kind: DocumentPaymentKind, documentId: string, input: DemoPaymentInput) => Promise<void>;
  onReversePayment: (kind: DocumentPaymentKind, documentId: string, paymentId: string, reason: string) => Promise<void>;
  onAskClient: (question: string, transaction: string, amount: string) => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  const [filters, setFilters] = useState<BillFilters>(emptyBillFilters);
  const rows: BillRow[] = source === "demo"
    ? allRows ?? bills.map((bill) => ({ bill, clientId, clientName: "" }))
    : quickBooksBills.map((bill) => ({ bill, clientId: QUICKBOOKS_CLIENT_ID, clientName: "QuickBooks Sandbox" }));
  const displayedBills = rows.map((row) => row.bill);
  if (selectedBill)
    return (
      <BillDetail
        clientId={clientId}
        bill={selectedBill}
        book={bookForDocument(paymentBooks, 'bill', selectedBill.id, clientId)}
        originalPaidCents={Math.round(selectedBill.amountPaid * 100) - activePaymentCents(bookForDocument(paymentBooks, 'bill', selectedBill.id, clientId))}
        dateDefault={paymentDateDefault}
        readOnly={source === "quickbooks"}
        today={today}
        onBack={onBack}
        onRecordPayment={(input) => onRecordPayment('bill', selectedBill.id, input)}
        onReversePayment={(payment, reason) => onReversePayment('bill', selectedBill.id, payment.id, reason)}
        onAskClient={onAskClient}
      />
    );
  const aging = summarizeOpenItems(displayedBills, today);
  const filtered = filterBills(rows, filters, today);
  const counts = billFilterCounts(rows, filters, today);
  const multiClient = new Set(filtered.map((row) => row.clientId)).size > 1 || (source === "demo" && Boolean(allRows));
  const toggleDue = (option: DueFilter) => setFilters((current) => ({ ...current, due: current.due === option ? "All" : option }));
  const cards: { label: string; value: number; tone: string; active: boolean; onClick: () => void }[] = [
    { label: "Total Bills Due", value: aging.totalCents, tone: "red", active: false, onClick: () => setFilters((current) => ({ ...current, due: "All", payment: "All" })) },
    { label: "Due Within 7 Days", value: aging.dueWithin7DaysCents, tone: "amber", active: filters.due === "Due soon", onClick: () => toggleDue("Due soon") },
    { label: "Overdue", value: aging.days1to30Cents + aging.days31to60Cents + aging.over60Cents, tone: "purple", active: filters.due === "Overdue", onClick: () => toggleDue("Overdue") },
    { label: "Paid So Far", value: aging.paidCents, tone: "green", active: filters.payment === "Paid", onClick: () => setFilters((current) => ({ ...current, payment: current.payment === "Paid" ? "All" : "Paid" })) },
  ];
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
        {cards.map((card) => (
          <button type="button" key={card.label} className={`summary-card ${card.tone} summary-card-button${card.active ? " active" : ""}`} aria-pressed={card.active} onClick={card.onClick}>
            <strong>{formatMoney(card.value / 100)}</strong>
            <span>{card.label}</span>
          </button>
        ))}
      </div>
      <p className="muted ar-as-of" data-testid="ap-as-of">Balances as of {formatLongDate(today)} (your local date). Total Bills Due, Due Within 7 Days and Overdue count only unpaid balances. Paid So Far is every payment recorded on the bills listed here, all time, not just this month. Select a card to filter the bills below.</p>
      {aging.unreadable > 0 && <div className="data-state-message">{aging.unreadable} open bill{aging.unreadable === 1 ? " has" : "s have"} no readable due date, so {aging.unreadable === 1 ? "it is" : "they are"} counted in the total but not in the overdue or due-soon figures.</div>}
      <div className="ar-filters">
        <label className="ar-search">
          <input type="search" aria-label="Search bills" placeholder="Search vendor, bill number, client, date or amount" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
        </label>
        <div className="filter-group" role="group" aria-label="Payment status">
          <small>Payment status</small>
          <div className="filter-row">
            {billPaymentFilters.map((option) => (
              <button type="button" className={`filter-button ${filters.payment === option ? "active" : ""}`} key={option} aria-pressed={filters.payment === option} onClick={() => setFilters((current) => ({ ...current, payment: option }))}>
                {option}
                <span>{counts.payment[option]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group" role="group" aria-label="Review status">
          <small>Review status</small>
          <div className="filter-row">
            {reviewFilters.map((option) => (
              <button type="button" className={`filter-button ${filters.review === option ? "active" : ""}`} key={option} aria-pressed={filters.review === option} onClick={() => setFilters((current) => ({ ...current, review: option }))}>
                {option === "All" ? "Any review status" : option}
                <span>{counts.review[option]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group" role="group" aria-label="Due date">
          <small>Due date</small>
          <div className="filter-row">
            {dueFilters.map((option) => (
              <button type="button" className={`filter-button ${filters.due === option ? "active" : ""}`} key={option} aria-pressed={filters.due === option} onClick={() => setFilters((current) => ({ ...current, due: option }))}>
                {option === "All" ? "Any due date" : option === "Overdue" ? "Overdue (any)" : option === "Due soon" ? "Due within 7 days" : option === "Current" ? "Not yet due" : `${option} days overdue`}
                <span>{counts.due[option]}</span>
              </button>
            ))}
          </div>
        </div>
        {hasActiveBillFilters(filters) && <button type="button" className="secondary-button" onClick={() => setFilters(emptyBillFilters)}>Reset filters</button>}
      </div>
      <p className="muted" data-testid="ap-showing">Showing {filtered.length} of {rows.length} bills.</p>
      <div className={`panel finance-list-panel ar-list${multiClient ? " with-client" : ""}`}>
        <div className="finance-list-heading">
          {multiClient && <span>Client</span>}
          <span>Vendor</span>
          <span>Bill</span>
          <span>Bill date</span>
          <span>Due date</span>
          <span>Amount</span>
          <span>Remaining</span>
          <span>Status</span>
          <span />
        </div>
        {filtered.length === 0 && <p className="muted ar-empty">No bills match these filters.</p>}
        {filtered.map((row) => {
          const { bill } = row;
          const due = billDue(bill, today);
          const pay = paymentStatus(bill);
          return (
            <button className="finance-list-row" key={`${row.clientId}/${bill.id}`} onClick={() => onSelectRow(row)}>
              {multiClient && <span>{row.clientName}</span>}
              <strong>{bill.vendor}</strong>
              <span>{bill.number}</span>
              <span>{bill.billDate}</span>
              <span className="inbox-due">{bill.dueDate}{due && <small className={`due-${due.tone}`}>{due.label}</small>}</span>
              <span>{formatMoney(bill.amount)}</span>
              <strong>{formatMoney(bill.amount - bill.amountPaid)}</strong>
              <span className="ar-badges">
                <span className={`inbox-status ${pay.toLowerCase().replaceAll(" ", "-")}`}>{pay}</span>
                {isOverdue(bill, today) ? <span className="inbox-status overdue">Overdue</span> : isDueSoon(bill, today) && <span className="inbox-status due-soon">Due soon</span>}
                {billNeedsReview(bill) && <span className="inbox-status needs-review">Needs Review</span>}
              </span>
              <span className="row-action">View Bill</span>
            </button>
          );
        })}
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
  today,
  onBack,
  onRecordPayment,
  onReversePayment,
  onAskClient,
}: {
  today: string;
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
  const pay = paymentStatus(bill);
  const due = billDue(bill, today);
  const late = isOverdue(bill, today);
  const review = billNeedsReview(bill);
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
            {bill.number} · Due {bill.dueDate}{due ? ` · ${due.label}` : ""}
          </p>
        </div>
        <span className="ar-badges">
          <span className={`inbox-status ${pay.toLowerCase().replaceAll(" ", "-")}`}>{pay}</span>
          {late && <span className="inbox-status overdue">Overdue</span>}
          {review && <span className="inbox-status needs-review">Needs Review</span>}
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
              <strong>{[pay, late ? "overdue" : "", review ? "needs review" : ""].filter(Boolean).join(", ")}</strong>
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

type CategoryOption = { id?: string; name: string };

function Transactions({
  transactions,
  quickBooksTransactions,
  source,
  clientId,
  scopeLabel,
  clientNames,
  period,
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
  scopeLabel: string;
  clientNames: Record<string, string>;
  period: Period;
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
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [reason, setReason] = useState<ReasonFilter>("Any");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [dateMode, setDateMode] = useState<"all" | "month" | "custom">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range: DateRange = dateMode === "month" ? monthRange(period) : dateMode === "custom" ? { from: customFrom || undefined, to: customTo || undefined } : {};
  const rangeInvalid = Boolean(range.from && range.to && range.from > range.to);

  const everything = source === "demo" ? transactions : quickBooksTransactions;
  // "Unusually large" is judged per client against that client's own history, never against the whole list.
  const unusualIds = useMemo(() => new Set(unusualAmountsByClient(everything).keys()), [everything]);
  // Client, date, search and category scope every count; status and reason then narrow the list.
  const scoped = filterTransactions(everything, { clientId, category, search, range: rangeInvalid ? {} : range });
  const reasonScoped = scoped.filter((transaction) => matchesReason(transaction, reason, unusualIds));
  const reviewQueue = reasonScoped.filter(needsAttention);
  const filteredTransactions = reasonScoped.filter((transaction) => filter === "All" || categorizationStatus(transaction) === filter);
  const filtersActive = filter !== "All" || reason !== "Any" || search.trim() !== "" || category !== "All" || dateMode !== "all";
  const resetFilters = () => {
    setFilter("All");
    setReason("Any");
    setSearch("");
    setCategory("All");
    setDateMode("all");
    setCustomFrom("");
    setCustomTo("");
  };
  const showClient = clientIdsIn(filteredTransactions).length > 1;
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

  const attentionCount = scoped.filter(needsAttention).length;
  const scopeSentence = clientId || source === "quickbooks" ? `Review ${scopeLabel}'s transactions one item at a time.` : "Review transactions across every client with detailed records, one item at a time.";

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Transactions</h2>
          <p className="muted">{scopeSentence}</p>
        </div>
        <span className="attention-summary" title="Transactions in the selected client and date range that need categorizing or a receipt">
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
      <div className="date-filter" aria-label="Date filter">
        <label>
          Dates
          <select value={dateMode} aria-label="Date range type" onChange={(event) => setDateMode(event.target.value as "all" | "month" | "custom")}>
            <option value="all">All dates</option>
            <option value="month">Selected month ({monthLabel(period)})</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {dateMode === "custom" && (
          <>
            <label>From<input type="date" value={customFrom} aria-label="From date" onChange={(event) => setCustomFrom(event.target.value)} /></label>
            <label>To<input type="date" value={customTo} aria-label="To date" onChange={(event) => setCustomTo(event.target.value)} /></label>
          </>
        )}
        <span className="active-range" role="status">Showing: {rangeInvalid ? "start date is after end date, so dates are not filtered" : describeDateRange(range)}</span>
      </div>
      <div className="filter-group">
        <strong>Status</strong>
        <div className="filter-row" aria-label="Status filters">
          {statusFilters.map((option) => (
            <button className={`filter-button ${filter === option ? "active" : ""}`} key={option} aria-pressed={filter === option} onClick={() => setFilter(option)}>
              {option}
              <span>{reasonScoped.filter((transaction) => option === "All" || categorizationStatus(transaction) === option).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="filter-group">
        <strong>Needs</strong>
        <div className="filter-row" aria-label="Review reason filters">
          {reasonFilters.map((option) => (
            <button className={`filter-button ${reason === option ? "active" : ""}`} key={option} aria-pressed={reason === option} onClick={() => setReason(option)}>
              {option === "Any" ? "Any reason" : option}
              <span>{scoped.filter((transaction) => matchesReason(transaction, option, unusualIds)).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="list-summary">
        <span role="status">Showing {filteredTransactions.length} of {scoped.length} transactions{everything.length !== scoped.length ? ` (${everything.length} in this data source)` : ""}</span>
        {filtersActive && <button className="text-button" onClick={resetFilters}>Reset filters</button>}
      </div>
      <div className={`panel transaction-panel ${showClient ? "with-client" : ""}`}>
        <div className="transaction-heading">
          {showClient && <span>Client</span>}
          <span>Date</span>
          <span>Payee</span>
          <span>Description</span>
          <span>Amount</span>
          <span>Category</span>
          <span>Status</span>
          <span />
        </div>
        {filteredTransactions.length === 0 && (
          <p className="muted empty-state">
            {everything.length === 0 ? "No transactions are available for this data source." : "No transactions match these filters."}
            {filtersActive && <> <button className="text-button" onClick={resetFilters}>Reset filters</button></>}
          </p>
        )}
        {filteredTransactions.map((transaction) => {
          const actionable = needsAttention(transaction);
          const extra = reviewReasons(transaction, unusualIds);
          return (
            <button
              className="transaction-row"
              key={`${transaction.clientId ?? ""}/${transaction.id}`}
              onClick={() => onSelect(transaction)}
            >
              {showClient && <span className="tx-client">{(transaction.clientId && clientNames[transaction.clientId]) || NOT_AVAILABLE}</span>}
              <span>{transaction.date}</span>
              <strong>{transaction.payee}</strong>
              <span className="tx-desc">{transaction.description}</span>
              <strong>{transaction.amount}</strong>
              <span className="tx-category">{categoryLabel(transaction)}</span>
              <span className="tx-status">
                <span className={`transaction-status ${statusClass(categorizationStatus(transaction))}`}>{categorizationStatus(transaction)}</span>
                {needsReceipt(transaction) && <span className="transaction-status needs-receipt">Receipt missing</span>}
                {extra.filter((item) => item !== "Missing receipt" && item !== "Missing category").map((item) => <span key={item} className="reason-tag">{item}</span>)}
              </span>
              <span className="row-action">{actionable ? "Review" : "View details"}</span>
            </button>
          );
        })}
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
  const next = nextActionable(ordered, queue, transaction.id);
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
      <div className="review-progress-bar"><strong>{queue.length} {queue.length === 1 ? "transaction needs" : "transactions need"} review</strong><span>Progress: {completedCount} of {ordered.length} completed</span><div><span style={{ width: `${ordered.length ? (completedCount / ordered.length) * 100 : 0}%` }} /></div></div>
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
          {savedCount > 0 && !next && queue.every((item) => item.id === transaction.id) && !needsAttention(transaction) && <div className="data-state-message" role="status">No more transactions need review in this view.</div>}
          {showRequestComposer && <div className="confirmation-box"><strong>Ask the client</strong><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><div><button className="secondary-button" onClick={() => setShowRequestComposer(false)}>Cancel</button><button className="primary-button" onClick={() => { onCreateQuickBooksRequest(transaction, question); setShowRequestComposer(false); }}>Save Request</button></div></div>}
          <button className="secondary-button" onClick={requestInformation}>
            Request More Information <span>→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function statusClass(status: string) {
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
  devBypass,
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
  devBypass: boolean;
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
  type RuleFormState = RuleForm;
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

  const [section, setSection] = useState<SettingsSection>("Connections");
  const [recheck, setRecheck] = useState(0);
  const [connection, setConnection] = useState<ConnectionSummary>({ state: "checking", label: "Checking…", detail: "Asking the server about QuickBooks." });
  const [storage, setStorage] = useState<StorageSummary>(describeStorage("checking"));

  useEffect(() => {
    let active = true;
    quickBooksService.readConnection().then((reading) => {
      if (!active) return;
      const summary = classifyConnection(reading, devBypass);
      setConnection(summary);
      onStatusChange({ connected: summary.state === "connected", environment: "sandbox" });
    });
    reconciliationService
      .storage()
      .then((result) => active && setStorage(describeStorage(result)))
      .catch(() => active && setStorage(describeStorage("unavailable")));
    return () => {
      active = false;
    };
  }, [onStatusChange, devBypass, recheck]);

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
    setRuleForm(ruleFormFromRule(rule));
  };
  const unsavedRuleWork = ruleFormHasUnsavedWork(ruleForm, editingRuleId !== null);

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

  const sectionId = (name: SettingsSection) => name.toLowerCase().replace(/[^a-z]+/g, "-");
  const onSectionKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = SETTINGS_SECTIONS[(index + step + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length];
    setSection(next);
    document.getElementById(`settings-tab-${sectionId(next)}`)?.focus();
  };
  const sourceLabel = source === "demo" ? "Demo data" : "QuickBooks Sandbox";
  const resetNames = DEMO_RESET_CLIENTS.map((client) => client.name).join(", ");
  const canConnect = connection.state === "not-connected";

  return (
    <div className="page-content settings-page">
      <section className="welcome-row">
        <div>
          <h2>Settings</h2>
          <p className="muted">Connections, automation rules, demo data and activity history for LedgerOps.</p>
        </div>
      </section>
      <div className="settings-sections" role="tablist" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((name, index) => (
          <button
            key={name}
            id={`settings-tab-${sectionId(name)}`}
            role="tab"
            type="button"
            aria-selected={section === name}
            aria-controls={`settings-panel-${sectionId(name)}`}
            tabIndex={section === name ? 0 : -1}
            className={`settings-section-tab ${section === name ? "active" : ""}`}
            onClick={() => setSection(name)}
            onKeyDown={(event) => onSectionKey(event, index)}
          >
            {name}
            {name === "Automation Rules" && unsavedRuleWork && <span className="settings-unsaved" data-testid="rule-unsaved">Unsaved edits</span>}
          </button>
        ))}
      </div>

      <div className="settings-panel" role="tabpanel" id="settings-panel-connections" aria-labelledby="settings-tab-connections" hidden={section !== "Connections"}>
        <section className="panel settings-card" aria-labelledby="qb-heading">
          <div className="settings-card-heading">
            <div className="account-icon">QB</div>
            <div>
              <h2 id="qb-heading">QuickBooks Online</h2>
              <p className="muted">Sandbox connection only. Production QuickBooks is not enabled.</p>
            </div>
          </div>
          <div className="settings-status">
            <span>Status</span>
            <strong className={`connection-${connection.state}`} data-testid="qb-connection-state" data-state={connection.state}>{connection.label}</strong>
          </div>
          <p className="settings-note" data-testid="qb-connection-detail">{connection.detail}</p>
          {devBypass && (
            <p className="settings-note dev-bypass-note" data-testid="dev-bypass-note">
              Local development bypass is on. It only opens demo data on this computer. QuickBooks still requires real authentication and is never bypassed.
            </p>
          )}
          <div className="reset-actions settings-actions">
            {canConnect && (
              <button
                className="primary-button"
                onClick={() =>
                  quickBooksService.connect().catch((connectError: unknown) =>
                    setError(connectError instanceof Error ? connectError.message : "Unable to start the QuickBooks connection."),
                  )
                }
              >
                Connect QuickBooks <span>→</span>
              </button>
            )}
            {connection.state === "connected" && (
              <button className="secondary-button" onClick={loadCompany} disabled={loadingCompany}>
                {loadingCompany ? "Loading company info..." : "Load Company Info"} <span>→</span>
              </button>
            )}
            {(connection.state === "backend-unavailable" || connection.state === "error") && (
              <button className="secondary-button" onClick={() => setRecheck((count) => count + 1)}>Check again</button>
            )}
          </div>
          {error && <p className="settings-error">{error}</p>}
          {company && (
            <div className="company-info">
              <h3>Company information</h3>
              <div className="detail-list">
                <span><small>Company Name</small><strong>{company.CompanyName || "Not provided"}</strong></span>
                <span><small>Legal Name</small><strong>{company.LegalName || "Not provided"}</strong></span>
                <span><small>Country</small><strong>{company.Country || "Not provided"}</strong></span>
                <span><small>Fiscal Year Start Month</small><strong>{company.FiscalYearStartMonth || "Not provided"}</strong></span>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="settings-panel" role="tabpanel" id="settings-panel-automation-rules" aria-labelledby="settings-tab-automation-rules" hidden={section !== "Automation Rules"}>
        <section className="panel settings-card automation-rules-card" aria-labelledby="rules-heading">
          <h2 id="rules-heading">{editingRuleId ? "Edit rule" : "New rule"}</h2>
          <p className="muted">Create reusable suggestions for {selectedClientName}. Rules never post accounting changes automatically.</p>
          <div className="detail-list">
            <span><small>Scope</small><strong>{selectedClientName}</strong></span>
            <span><small>Data source</small><strong>{sourceLabel}</strong></span>
          </div>
          <div className="rule-groups">
            <fieldset className="settings-fieldset">
              <legend>Rule details</legend>
              <div className="settings-fields">
                <label>
                  Rule name
                  <input value={ruleForm.name} onChange={(event) => setRuleForm({ ...ruleForm, name: event.target.value })} placeholder="Home Depot materials" />
                </label>
                <label>
                  Priority
                  <input type="number" min={1} value={ruleForm.priority} onChange={(event) => setRuleForm({ ...ruleForm, priority: Number(event.target.value) || 1 })} />
                </label>
                <label>
                  Review priority
                  <select value={ruleForm.reviewPriority} onChange={(event) => setRuleForm({ ...ruleForm, reviewPriority: event.target.value as TaskPriority })}>
                    {taskPriorities.map((priority, index) => <option key={`${priority}-${index}`} value={priority}>{priority}</option>)}
                  </select>
                </label>
                <label className="checkbox-field">
                  <input type="checkbox" checked={ruleForm.enabled} onChange={(event) => setRuleForm({ ...ruleForm, enabled: event.target.checked })} />
                  <span>Enabled</span>
                </label>
              </div>
            </fieldset>
            <fieldset className="settings-fieldset">
              <legend>Match conditions</legend>
              <div className="settings-fields">
                <label>
                  Transaction kind
                  <select value={ruleForm.transactionKind} onChange={(event) => setRuleForm({ ...ruleForm, transactionKind: event.target.value as "Any" | "Expense" | "Deposit" })}>
                    <option value="Any">Any</option>
                    <option value="Expense">Expense</option>
                    <option value="Deposit">Deposit</option>
                  </select>
                </label>
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
            </fieldset>
            <fieldset className="settings-fieldset">
              <legend>Suggested action</legend>
              <div className="settings-fields">
                <label>
                  Suggested category
                  <select value={effectiveCategory} onChange={(event) => setRuleForm({ ...ruleForm, category: event.target.value })}>
                    {!categoryOptions.some((option) => option.name === effectiveCategory) && effectiveCategory && <option value={effectiveCategory}>{effectiveCategory}</option>}
                    {categoryOptions.map((option, index) => <option key={`${option.id ?? option.name}-${index}`} value={option.name}>{option.name}</option>)}
                  </select>
                </label>
                <label>
                  Optional memo
                  <input value={ruleForm.memo} onChange={(event) => setRuleForm({ ...ruleForm, memo: event.target.value })} placeholder="Job materials purchase" />
                </label>
              </div>
              <p className="muted">The rule only suggests this category. A bookkeeper still reviews and approves every change.</p>
            </fieldset>
          </div>
          {(ruleErrors.name || ruleErrors.criteria || ruleErrors.amount || ruleErrors.category || ruleErrors.priority) && <p className="settings-error" role="alert">{ruleErrors.name || ruleErrors.criteria || ruleErrors.amount || ruleErrors.category || ruleErrors.priority}</p>}
          <div className="reset-actions settings-actions">
            <button className="secondary-button" onClick={resetRuleForm}>{editingRuleId ? "Cancel edit" : "Clear rule"}</button>
            <button className="primary-button" onClick={submitRule}>{editingRuleId ? "Save rule" : "Create rule"}</button>
          </div>
        </section>
        <section className="panel settings-card automation-preview-panel" data-testid="rule-preview" aria-labelledby="preview-heading">
          <h3 id="preview-heading">Preview matches</h3>
          {previewMatches.length === 0 ? <p className="muted">No current transactions match this rule yet.</p> : <div className="audit-log-list">{previewMatches.slice(0, 5).map((match, index) => <div className="audit-log-row" key={`${match.transactionId}-${index}`}><strong>{match.payee}</strong><span>{match.date} · {match.amount}</span><span>{match.reasons[0]}</span></div>)}</div>}
        </section>
        <section className="panel settings-card" aria-labelledby="existing-rules-heading">
          <h3 id="existing-rules-heading">Existing rules ({sortedRules.length})</h3>
          <div className="audit-log-list" data-testid="rules-list">
            {sortedRules.length === 0 ? <p className="muted">No rules saved for this client yet.</p> : sortedRules.map((rule, index) => {
              const matches = previewRule(rule, rulePreviewTransactions);
              return <div className="audit-log-row" key={`${rule.id}-${index}`} data-testid="rule-row"><strong>{rule.name}</strong><span>{rule.enabled ? "Enabled" : "Disabled"} · Priority {rule.priority} · {rule.reviewPriority}</span><span>{rule.category}{rule.memo ? ` · Memo: ${rule.memo}` : ""}</span><span>{matches.length} current match{matches.length === 1 ? "" : "es"}</span><div className="reset-actions"><button className="text-button" onClick={() => editRule(rule)}>Edit</button><button className="text-button" onClick={() => onToggleRule(rule.id, !rule.enabled)}>{rule.enabled ? "Disable" : "Enable"}</button><button className="text-button" onClick={() => onDeleteRule(rule.id)}>Delete</button></div></div>;
            })}
          </div>
        </section>
      </div>

      <div className="settings-panel" role="tabpanel" id="settings-panel-demo-data" aria-labelledby="settings-tab-demo-data" hidden={section !== "Demo Data"}>
        <section className="panel settings-card storage-card" data-testid="storage-card" aria-labelledby="storage-heading">
          <h2 id="storage-heading">Development storage</h2>
          <div className="settings-status">
            <span>Server records</span>
            <strong className={`storage-${storage.state}`} data-testid="storage-state" data-state={storage.state}>{storage.label}</strong>
          </div>
          <p className="settings-note" data-testid="storage-detail">{storage.detail}</p>
          <p className="muted">Browser-only items (automation rules and activity, and the QuickBooks update attempts shown in Activity &amp; History) are never saved to the server.</p>
        </section>
        <section className="panel settings-card demo-reset-card reset-zone" aria-labelledby="reset-heading">
          <h2 id="reset-heading">Reset Demo Data</h2>
          <p className="muted">Restore the original demo books. Choose one company, or all five.</p>
          <ul className="reset-scope">
            <li><strong>One company:</strong> only the selected company's demo changes are removed; the other four are untouched.</li>
            <li><strong>All five demo companies:</strong> every demo company ({resetNames}) is restored to its original data.</li>
            <li><strong>Never reset:</strong> QuickBooks, sign-in, sessions, or any other database records.</li>
          </ul>
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
      </div>

      <div className="settings-panel" role="tabpanel" id="settings-panel-activity-history" aria-labelledby="settings-tab-activity-history" hidden={section !== "Activity & History"}>
        <div className="history-grid">
          <section className="panel settings-card audit-log-card" data-testid="history-audit" aria-labelledby="audit-heading">
            <h2 id="audit-heading">Audit Log <span className="history-count">{auditLog.length}</span></h2>
            <span className="history-badge temporary">This session only</span>
            <p className="muted">Record of QuickBooks Sandbox update attempts made in this browser tab. It is cleared when the page reloads and is not a permanent log.</p>
            {auditLog.length === 0 ? <p className="muted">No QuickBooks updates attempted.</p> : <div className="audit-log-list">{auditLog.map((entry, index) => <div className="audit-log-row" key={`${entry.timestamp}-${index}`}><strong>{entry.result}</strong><span>{entry.transactionType} · {entry.quickBooksId}</span><span>{entry.oldCategory} → {entry.newCategory}</span><small>{new Date(entry.timestamp).toLocaleString()}</small></div>)}</div>}
          </section>
          <section className="panel settings-card audit-log-card" data-testid="history-automation" aria-labelledby="automation-heading">
            <h2 id="automation-heading">Automation Activity <span className="history-count">{automationEvents.length}</span></h2>
            <span className="history-badge browser">Saved in this browser only</span>
            <p className="muted">Rule changes and automation suggestions, kept in this browser's storage. Not saved on the server, and nothing here marks an accounting change as posted.</p>
            {automationEvents.length === 0 ? <p className="muted">No automation activity recorded yet.</p> : <div className="audit-log-list">{automationEvents.map((event, index) => <div className="audit-log-row" key={`${event.id}-${index}`}><strong>{event.summary}</strong><span>{event.kind}</span>{event.detail && <span>{event.detail}</span>}<small>{new Date(event.at).toLocaleString()}</small></div>)}</div>}
          </section>
          <section className="panel settings-card audit-log-card" data-testid="history-recurring" aria-labelledby="recurring-heading">
            <h2 id="recurring-heading">Recurring activity <span className="history-count">{recurringPatterns.length}</span></h2>
            <span className="history-badge derived">Calculated from current transactions</span>
            <p className="muted">Expected recurring transactions are reminders only and never create entries automatically. This list is recalculated, not a saved history.</p>
            {recurringPatterns.length === 0 ? <p className="muted">No recurring reminders are currently open.</p> : <div className="audit-log-list">{recurringPatterns.slice(0, 8).map((pattern, index) => <div className="audit-log-row" key={`${pattern.id}-${index}`}><strong>{pattern.vendor}</strong><span>{pattern.frequency} · typical {formatMoney(pattern.typicalAmountCents / 100)}</span><span>Expected next date {formatDueDate(pattern.expectedNextDate)} · {pattern.confidence} confidence</span></div>)}</div>}
          </section>
        </div>
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
  pickClient,
  clientChoices,
  onSelectClient,
}: {
  source: AccountSource;
  clientRef: { id: string; name: string };
  pickClient: boolean;
  clientChoices: Client[];
  onSelectClient: (client: Client) => void;
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
      {source === "demo" && pickClient ? (
        <ReconcileClientPicker
          clients={[demoClient.id, ...ADDITIONAL_DEMO_CLIENT_IDS].map((id) => ({
            id,
            name: clientChoices.find((client) => client.id === id)?.name ?? (id === demoClient.id ? demoClient.name : getAdditionalDemoCompany(id)?.clientName ?? id),
            accountIds: id === demoClient.id ? demoReconSources.map((item) => item.id) : getAdditionalDemoCompany(id)?.reconciliationAccounts.map((account) => account.id) ?? [],
          }))}
          period={period}
          source="demo"
          onOpen={(id) => { const client = clientChoices.find((item) => item.id === id); if (client) onSelectClient(client); }}
        />
      ) : (
        <ReconcileWorkspace key={`${source}:${clientRef.id}`} source={source} client={clientRef} accounts={options} loadAccountData={loadAccountData} today={today} period={period} homeSignal={homeSignal} entryTools={entryTools} />
      )}
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
  today,
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
  today: string;
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
          <TaskCardList tasks={tasks.slice(0, 5)} showClient={false} today={today} onOpenTask={onOpenTask} />
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
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="metric-note">{note}</span>
    </>
  );
  if (onClick)
    return (
      <button type="button" className={`metric-card clickable ${tone}`} onClick={onClick}>
        {body}
      </button>
    );
  return <div className={`metric-card ${tone}`}>{body}</div>;
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
