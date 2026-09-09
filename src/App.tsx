import { useEffect, useState, type ReactNode } from "react";
import { demoDataService } from "./services/demoDataService";
import type {
  Bill,
  Client,
  ClientRequest,
  DemoReportData,
  InboxItem,
  Invoice,
  LedgerAccount,
  LedgerBill,
  LedgerInvoice,
  LedgerReport,
  LedgerTransaction,
  MonthEndItem,
  ReconciliationAccount,
  ReconciliationTransaction,
  Transaction,
} from "./services/bookkeepingTypes";
import {
  quickBooksService,
  type QuickBooksCompany,
  type QuickBooksStatus,
} from "./services/quickBooksService";

const {
  bills: demoBills,
  clients,
  clientRequests,
  demoClient,
  invoices: demoInvoices,
  transactions: demoTransactions,
  inboxItems,
  monthEndItems,
  navigationItems,
  reconciliationAccounts,
  reports: demoReports,
  todaysWork,
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
type ReviewCategory = "Transactions" | "Receivables" | "Payables" | "Reconciliation";

type ReviewItem = {
  id: string;
  category: ReviewCategory;
  issueType: string;
  client: string;
  description: string;
  amount?: number;
  priority: "High" | "Medium" | "Low";
  action: string;
  destination: "Transactions" | "Receivables" | "Payables" | "Reconcile";
};

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

function App() {
  const [view, setView] = useState<View>("Dashboard");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [transactions, setTransactions] =
    useState<Transaction[]>(demoTransactions);
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [selectedReconciliation, setSelectedReconciliation] =
    useState<ReconciliationAccount | null>(null);
  const [monthEndChecklist, setMonthEndChecklist] =
    useState<MonthEndItem[]>(monthEndItems);
  const [monthEndCompleted, setMonthEndCompleted] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>(inboxItems);
  const [requests, setRequests] = useState<ClientRequest[]>(clientRequests);
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(
    null,
  );
  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);
  const [bills, setBills] = useState<Bill[]>(demoBills);
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
  const [monthEndHistory, setMonthEndHistory] = useState<MonthEndCompletion[]>([]);

  useEffect(() => {
    quickBooksService.getStatus().then(setQuickBooksStatus).catch(() => undefined);
  }, []);

  const openClient = (client: Client) => {
    setSelectedClient(client);
    setView("Dashboard");
  };

  const openTransactions = () => {
    setSelectedTransaction(null);
    setView("Transactions");
  };

  const openReconcile = () => {
    setSelectedReconciliation(null);
    setView("Reconcile");
  };

  const openMonthEnd = () => setView("Month End");

  const openInbox = () => {
    setSelectedRequest(null);
    setView("Inbox");
  };

  const openRequests = () => setView("Client Requests");

  const openReceivables = () => {
    setSelectedInvoice(null);
    setView("Receivables");
  };
  const openPayables = () => {
    setSelectedBill(null);
    setView("Payables");
  };
  const openReports = () => setView("Reports");
  const openSettings = () => setView("Settings");

  const changeAppDataSource = async (source: AccountSource) => {
    setAppDataSource(source);
    await Promise.all([
      changeTransactionSource(source),
      changeAccountSource(source),
      changeReceivablesSource(source),
      changePayablesSource(source),
      changeReviewSource(source),
    ]);
  };

  const updateQuickBooksTransaction = async (transaction: LedgerTransaction, newCategory: string) => {
    const entryBase = { timestamp: new Date().toISOString(), quickBooksId: transaction.quickBooksId || transaction.id, transactionType: transaction.transactionType || "Unknown", oldCategory: transaction.category, newCategory };
    try {
      await quickBooksService.updateTransactionAccount(transaction.transactionType || "", transaction.quickBooksId || "", newCategory);
      setAuditLog((entries) => [{ ...entryBase, result: "Success" }, ...entries]);
      const refreshed = await quickBooksService.getTransactions();
      setQuickBooksTransactions(refreshed);
      return refreshed.find((item) => item.quickBooksId === transaction.quickBooksId) || transaction;
    } catch (error) {
      setAuditLog((entries) => [{ ...entryBase, result: "Failed" }, ...entries]);
      throw error;
    }
  };

  const updateMonthEndItem = (updatedItem: MonthEndItem) => {
    setMonthEndChecklist((currentItems) =>
      currentItems.map((item) =>
        item.id === updatedItem.id ? updatedItem : item,
      ),
    );
  };

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
    const request: ClientRequest = {
      id: `request-${transaction.id}`,
      client: "ABC Plumbing",
      dateCreated: "September 7, 2026",
      relatedTransaction: transaction.payee,
      relatedAmount: transaction.amount,
      question: "What was this purchase for?",
      status: "Waiting for Client",
    };
    setRequests((currentRequests) =>
      currentRequests.some((currentRequest) => currentRequest.id === request.id)
        ? currentRequests
        : [...currentRequests, request],
    );
    setInbox((currentInbox) =>
      currentInbox.some((item) => item.requestId === request.id)
        ? currentInbox
        : [
            ...currentInbox,
            {
              id: `inbox-${request.id}`,
              client: request.client,
              type: "Client Question",
              description: `${request.relatedTransaction} purchase needs an answer`,
              priority: "High",
              date: "Today",
              status: "Open",
              destination: "Client Requests",
              requestId: request.id,
            },
          ],
    );
    updateTransaction({ ...transaction, status: "Needs Receipt" });
  };

  const createQuickBooksRequest = (transaction: LedgerTransaction, question: string) => {
    const request: ClientRequest = {
      id: `request-${transaction.quickBooksId || transaction.id}`,
      client: "ABC Plumbing",
      dateCreated: new Date().toLocaleDateString(),
      relatedTransaction: transaction.payee,
      relatedAmount: transaction.amount,
      question,
      status: "Waiting for Client",
      quickBooksId: transaction.quickBooksId,
      transactionType: transaction.transactionType,
      payee: transaction.payee,
      transactionDate: transaction.date,
      amount: transaction.amount,
      currentCategory: transaction.category,
    };
    setRequests((currentRequests) => currentRequests.some((item) => item.id === request.id) ? currentRequests : [...currentRequests, request]);
    setInbox((currentInbox) => currentInbox.some((item) => item.requestId === request.id) ? currentInbox : [...currentInbox, { id: `inbox-${request.id}`, client: request.client, type: "Client Question", description: `${request.payee} purchase needs an answer`, priority: "High", date: "Today", status: "Open", destination: "Client Requests", requestId: request.id }]);
  };

  const updateRequest = (updatedRequest: ClientRequest) => {
    setRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === updatedRequest.id ? updatedRequest : request,
      ),
    );
    setInbox((currentInbox) =>
      currentInbox.map((item) =>
        item.requestId === updatedRequest.id
          ? {
              ...item,
              status:
                updatedRequest.status === "Resolved" ? "Resolved" : updatedRequest.status === "Client Responded" ? "Answered" : "Open",
            }
          : item,
      ),
    );
    setSelectedRequest(updatedRequest);
  };

  const applyClientResponse = async (request: ClientRequest) => {
    if (!request.quickBooksId || !request.transactionType || !request.responseCategory) throw new Error("This request is not linked to a writable QuickBooks transaction.");
    const transaction = quickBooksTransactions.find((item) => item.quickBooksId === request.quickBooksId);
    if (!transaction) throw new Error("The linked QuickBooks transaction could not be refreshed.");
    await updateQuickBooksTransaction(transaction, request.responseCategory);
    const resolved = { ...request, status: "Resolved" as const };
    setRequests((currentRequests) => currentRequests.map((item) => item.id === request.id ? resolved : item));
    setInbox((currentInbox) => currentInbox.filter((item) => item.requestId !== request.id));
    setSelectedRequest(resolved);
  };

  const createPageRequest = (
    question: string,
    relatedTransaction: string,
    relatedAmount: string,
  ) => {
    const request: ClientRequest = {
      id: `request-${Date.now()}`,
      client: "ABC Plumbing",
      dateCreated: "September 7, 2026",
      relatedTransaction,
      relatedAmount,
      question,
      status: "Waiting for Client",
    };
    setRequests((currentRequests) => [...currentRequests, request]);
    setInbox((currentInbox) => [
      ...currentInbox,
      {
        id: `inbox-${request.id}`,
        client: request.client,
        type: "Client Question",
        description: `${relatedTransaction} needs an answer`,
        priority: "High",
        date: "Today",
        status: "Open",
        destination: "Client Requests",
        requestId: request.id,
      },
    ]);
  };

  const updateInvoice = (invoice: Invoice) => {
    setInvoices((currentInvoices) =>
      currentInvoices.map((item) => (item.id === invoice.id ? invoice : item)),
    );
    setSelectedInvoice(invoice);
  };
  const updateBill = (bill: Bill) => {
    setBills((currentBills) =>
      currentBills.map((item) => (item.id === bill.id ? bill : item)),
    );
    setSelectedBill(bill);
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
    setSelectedReconciliation(null);
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

  const openReviewDestination = (destination: ReviewItem["destination"]) => {
    if (destination === "Transactions") openTransactions();
    else if (destination === "Receivables") openReceivables();
    else if (destination === "Payables") openPayables();
    else openReconcile();
  };

  return (
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
          <div className="avatar">JR</div>
          <div>
            <strong>Jordan Reed</strong>
            <span>Bookkeeper</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Monday, September 7, 2026</p>
            <h1>
              {view === "Dashboard"
                ? selectedClient
                  ? selectedClient.name
                  : "Good morning, Jordan"
                : view}
            </h1>
          </div>
          <div className="global-source-area">
            <AccountSourceSwitch source={appDataSource} onChange={changeAppDataSource} />
            {appDataSource === "quickbooks" && <div className="global-source-meta"><strong>{quickBooksCompany?.CompanyName || "QuickBooks Sandbox"}</strong><span>Sandbox · Write Enabled · Test Data Only</span></div>}
            {appDataSource === "quickbooks" && !quickBooksStatus.connected && <button className="text-button" onClick={openSettings}>Connect in Settings →</button>}
          </div>
          <button className="help-button" aria-label="Get help">
            ?
          </button>
        </header>

        {view === "Dashboard" ? (
          <Dashboard
            client={selectedClient}
            accountSource={appDataSource}
            quickBooksAccounts={quickBooksAccounts}
            onBack={() => setSelectedClient(null)}
            onOpen={openClient}
            onViewClients={() => setView("Clients")}
            onTransactions={openTransactions}
            onReconcile={openReconcile}
            onMonthEnd={openMonthEnd}
            onReceivables={openReceivables}
            onPayables={openPayables}
            onReports={openReports}
            onAccountSourceChange={changeAccountSource}
            accountLoading={quickBooksAccountsLoading}
            accountError={quickBooksAccountsError}
            reviewSource={appDataSource}
            reviewData={reviewData}
            reviewLoading={reviewLoading}
            reviewError={reviewError}
            reviewRequests={requests}
            reviewReconciliationAccounts={reconciliationAccounts}
            onReviewSourceChange={changeAppDataSource}
            onOpenReview={() => setView("Bookkeeping Review")}
            onReviewNavigate={openReviewDestination}
          />
        ) : view === "Clients" ? (
          <Clients onOpen={openClient} />
        ) : view === "Bookkeeping Review" ? (
          <BookkeepingReview source={appDataSource} data={reviewData} clientRequests={requests} reconciliationAccounts={reconciliationAccounts} loading={reviewLoading} error={reviewError} onSourceChange={changeAppDataSource} onNavigate={openReviewDestination} />
        ) : view === "Inbox" ? (
          <Inbox
            items={inbox}
            onOpenRequest={(requestId) => {
              const request = requests.find((item) => item.id === requestId);
              if (request) {
                setSelectedRequest(request);
                openRequests();
              }
            }}
            onNavigate={(destination) =>
              destination === "Transactions"
                ? openTransactions()
                : destination === "Reconcile"
                  ? openReconcile()
                  : destination === "Receivables"
                    ? openReceivables()
                    : destination === "Payables"
                      ? openPayables()
                      : destination === "Month End"
                        ? openMonthEnd()
                        : openRequests()
            }
          />
        ) : view === "Transactions" ? (
          <Transactions
            transactions={transactions}
            quickBooksTransactions={quickBooksTransactions}
            source={appDataSource}
            isLoading={quickBooksTransactionsLoading}
            error={quickBooksTransactionsError}
            onSourceChange={changeAppDataSource}
            selectedTransaction={selectedTransaction}
            onSelect={setSelectedTransaction}
            onBack={() => setSelectedTransaction(null)}
            onUpdate={updateTransaction}
            onRequestInformation={createRequest}
            onQuickBooksUpdate={updateQuickBooksTransaction}
            onCreateQuickBooksRequest={createQuickBooksRequest}
          />
        ) : view === "Reconcile" ? (
          <Reconcile
            source={appDataSource}
            accounts={quickBooksAccounts}
            isLoading={quickBooksAccountsLoading}
            error={quickBooksAccountsError}
            selectedAccount={selectedReconciliation}
            onSelect={setSelectedReconciliation}
            onBack={() => setSelectedReconciliation(null)}
            onSourceChange={changeAppDataSource}
          />
        ) : view === "Receivables" ? (
          <Receivables
            source={appDataSource}
            invoices={invoices}
            quickBooksInvoices={quickBooksInvoices}
            isLoading={quickBooksReceivablesLoading}
            error={quickBooksReceivablesError}
            selectedInvoice={selectedInvoice}
            onSelect={setSelectedInvoice}
            onBack={() => setSelectedInvoice(null)}
            onUpdate={updateInvoice}
            onAskClient={createPageRequest}
            onSourceChange={changeAppDataSource}
          />
        ) : view === "Payables" ? (
          <Payables
            source={appDataSource}
            bills={bills}
            quickBooksBills={quickBooksBills}
            isLoading={quickBooksPayablesLoading}
            error={quickBooksPayablesError}
            selectedBill={selectedBill}
            onSelect={setSelectedBill}
            onBack={() => setSelectedBill(null)}
            onUpdate={updateBill}
            onAskClient={createPageRequest}
            onSourceChange={changeAppDataSource}
          />
        ) : view === "Reports" ? (
          <Reports invoices={invoices} bills={bills} reportData={demoReports} source={appDataSource} onSourceChange={changeAppDataSource} />
        ) : view === "Month End" ? (
          <MonthEnd
            source={appDataSource}
            checklist={monthEndChecklist}
            quickBooksTransactions={quickBooksTransactions}
            quickBooksAccounts={quickBooksAccounts}
            quickBooksInvoices={quickBooksInvoices}
            quickBooksBills={quickBooksBills}
            reviewRequests={requests}
            reviewReconciliationAccounts={reconciliationAccounts}
            completed={monthEndCompleted}
            onUpdate={updateMonthEndItem}
            history={monthEndHistory}
            onComplete={(status) => { setMonthEndCompleted(true); setMonthEndHistory((entries) => [{ client: "ABC Plumbing", month: "August 2026", dateCompleted: new Date().toLocaleDateString(), checklistStatus: status, completedBy: "LedgerOps User" }, ...entries]); }}
            onNavigate={(destination) =>
              destination === "Transactions"
                ? openTransactions()
                : destination === "Reconcile" ? openReconcile() : destination === "Receivables" ? openReceivables() : destination === "Payables" ? openPayables() : destination === "Reports" ? openReports() : openRequests()
            }
          />
        ) : view === "Client Requests" ? (
          <ClientRequests
            requests={requests}
            selectedRequest={selectedRequest}
            onSelect={setSelectedRequest}
            onBack={() => setSelectedRequest(null)}
            onUpdate={updateRequest}
            onApplyResponse={applyClientResponse}
          />
        ) : (
          <Settings
            quickBooksStatus={quickBooksStatus}
            company={quickBooksCompany}
            onStatusChange={setQuickBooksStatus}
            onCompanyChange={setQuickBooksCompany}
            auditLog={auditLog}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  client,
  accountSource,
  quickBooksAccounts,
  accountLoading,
  accountError,
  onAccountSourceChange,
  onBack,
  onOpen,
  onViewClients,
  onTransactions,
  onReconcile,
  onMonthEnd,
  onReceivables,
  onPayables,
  onReports,
  reviewSource,
  reviewData,
  reviewLoading,
  reviewError,
  reviewRequests,
  reviewReconciliationAccounts,
  onReviewSourceChange,
  onOpenReview,
  onReviewNavigate,
}: {
  client: Client | null;
  accountSource: AccountSource;
  quickBooksAccounts: LedgerAccount[];
  accountLoading: boolean;
  accountError: string | null;
  onAccountSourceChange: (source: AccountSource) => void;
  onBack: () => void;
  onOpen: (client: Client) => void;
  onViewClients: () => void;
  onTransactions: () => void;
  onReconcile: () => void;
  onMonthEnd: () => void;
  onReceivables: () => void;
  onPayables: () => void;
  onReports: () => void;
  reviewSource: ReviewSource;
  reviewData: { transactions: LedgerTransaction[]; accounts: LedgerAccount[]; invoices: LedgerInvoice[]; bills: LedgerBill[] } | null;
  reviewLoading: boolean;
  reviewError: string | null;
  reviewRequests: ClientRequest[];
  reviewReconciliationAccounts: ReconciliationAccount[];
  onReviewSourceChange: (source: ReviewSource) => void;
  onOpenReview: () => void;
  onReviewNavigate: (destination: ReviewItem["destination"]) => void;
}) {
  if (client)
    return (
      <ClientDashboard
        client={client}
        accountSource={accountSource}
        quickBooksAccounts={quickBooksAccounts}
        accountLoading={accountLoading}
        accountError={accountError}
        onAccountSourceChange={onAccountSourceChange}
        onBack={onBack}
        onTransactions={onTransactions}
        onReconcile={onReconcile}
        onMonthEnd={onMonthEnd}
        onReceivables={onReceivables}
        onPayables={onPayables}
        onReports={onReports}
      />
    );

  const reviewItems = buildReviewItems(reviewSource, reviewData, reviewRequests, reviewReconciliationAccounts);
  const reviewCount = (predicate: (item: ReviewItem) => boolean) => reviewItems.filter(predicate).length;
  const todaysReviewItems = [...reviewItems].sort((left, right) => ({ High: 0, Medium: 1, Low: 2 }[left.priority] - { High: 0, Medium: 1, Low: 2 }[right.priority])).slice(0, 8);

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Here is what needs your attention.</h2>
          <p className="muted">
            Work through these items to keep your clients on track.
          </p>
        </div>
        <button className="primary-button" onClick={onOpenReview}>
          Open Bookkeeping Review <span>→</span>
        </button>
      </section>
      <AccountSourceSwitch source={reviewSource} onChange={onReviewSourceChange} />
      {reviewLoading && <div className="data-state-message">Loading QuickBooks Sandbox review data...</div>}
      {reviewError && <div className="data-state-message error">{reviewError}</div>}
      <section className="metrics-grid" aria-label="Bookkeeping overview">
        <MetricCard label="Clients" value="5" note="All clients" tone="green" />
        <MetricCard
          label="Items needing attention"
          value={`${reviewItems.length}`}
          note="From review rules"
          tone="red"
        />
        <MetricCard
          label="Transactions to review"
          value={`${reviewCount((item) => item.category === "Transactions")}`}
          note="Review queue"
          tone="amber"
        />
        <MetricCard
          label="Reconciliations"
          value={`${reviewCount((item) => item.category === "Reconciliation")}`}
          note="Review queue"
          tone="blue"
        />
        <MetricCard
          label="Client questions"
          value={`${reviewRequests.filter((request) => request.status !== "Resolved").length}`}
          note="Open client requests"
          tone="purple"
        />
        <MetricCard
          label="Month end"
          value="90%"
          note="ABC Plumbing"
          tone="green"
        />
        <MetricCard label="High Priority" value={`${reviewCount((item) => item.priority === "High")}`} note="Review queue" tone="red" />
        <MetricCard label="Medium Priority" value={`${reviewCount((item) => item.priority === "Medium")}`} note="Review queue" tone="amber" />
        <MetricCard label="Low Priority" value={`${reviewCount((item) => item.priority === "Low")}`} note="Review queue" tone="green" />
        <MetricCard label="Overdue invoices" value={`${reviewCount((item) => item.issueType === "Overdue invoice")}`} note="Receivables" tone="red" />
        <MetricCard label="Overdue bills" value={`${reviewCount((item) => item.issueType === "Overdue bill")}`} note="Payables" tone="red" />
      </section>
      <section className="content-grid">
        <div className="panel work-panel">
          <div className="panel-heading">
            <div>
              <h2>Today's work</h2>
              <p className="muted">Start with the most important items.</p>
            </div>
            <span className="count-pill">{todaysReviewItems.length} items</span>
          </div>
          <div className="review-card-list">
            {todaysReviewItems.map((item) => (
              <button className="review-card" key={item.id} onClick={() => onReviewNavigate(item.destination)}>
                <div className="review-card-top"><span className="review-type">{item.client} · {item.issueType}</span><span className={`priority-badge ${item.priority.toLowerCase()}`}>{item.priority}</span></div>
                <p>{item.description}</p>
                <div className="review-card-footer"><span>Next: {item.action}</span><span className="row-arrow">→</span></div>
              </button>
            ))}
          </div>
        </div>
        <div className="panel client-summary">
          <div className="panel-heading">
            <div>
              <h2>Your clients</h2>
              <p className="muted">A quick look at their books.</p>
            </div>
          </div>
          <button className="client-card" onClick={() => onOpen(demoClient)}>
            <div className="company-avatar">{demoClient.initials}</div>
            <div className="client-info">
              <strong>{demoClient.name}</strong>
              <span>{demoClient.month}</span>
            </div>
            <span className="status-dot amber-dot" />{" "}
            <span className="arrow">→</span>
          </button>
          <button className="text-button" onClick={onViewClients}>
            View all clients <span>→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Clients({ onOpen }: { onOpen: (client: Client) => void }) {
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
        {clients.map((client) => (
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
              <span
                className={`status-badge ${client.status === "On track" ? "success" : "warning"}`}
              >
                {client.status}
              </span>
            </div>
            <div className="client-card-details">
              <span>
                <small>Items needing attention</small>
                <strong
                  className={
                    client.attention ? "attention-number" : "success-text"
                  }
                >
                  {client.attention}
                </strong>
              </span>
              <span>
                <small>Reconciliation</small>
                <strong>{client.reconciliation}</strong>
              </span>
            </div>
            <div className="client-card-progress">
              <span>
                <small>Month-end progress</small>
                <strong>{client.monthEnd}%</strong>
              </span>
              <span className="progress-bar">
                <span style={{ width: `${client.monthEnd}%` }} />
              </span>
              <span className="row-arrow">→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function buildReviewItems(source: ReviewSource, data: { transactions: LedgerTransaction[]; accounts: LedgerAccount[]; invoices: LedgerInvoice[]; bills: LedgerBill[] } | null, requests: ClientRequest[], reconciliationData: ReconciliationAccount[]): ReviewItem[] {
  const transactionsToReview = source === "quickbooks" ? data?.transactions || [] : demoTransactions.map((transaction) => ({ ...transaction, source: "demo" as const }));
  const invoicesToReview = source === "quickbooks" ? data?.invoices || [] : demoInvoices.map((invoice) => ({ ...invoice, source: "demo" as const }));
  const billsToReview = source === "quickbooks" ? data?.bills || [] : demoBills.map((bill) => ({ ...bill, source: "demo" as const }));
  const accountsToReview = source === "quickbooks" ? data?.accounts || [] : [];
  const items: ReviewItem[] = [];
  transactionsToReview.forEach((transaction, index) => {
    const amount = Number(transaction.amount.replace(/[$,]/g, ""));
    if (!transaction.category || transaction.category === "Uncategorized") items.push({ id: `${transaction.id}-category`, category: "Transactions", issueType: "Missing category", client: "ABC Plumbing", description: `${transaction.payee || "Unknown payee"} has no category or account.`, amount, priority: "High", action: "Categorize transaction", destination: "Transactions" });
    if (!transaction.payee || transaction.payee === "Unknown") items.push({ id: `${transaction.id}-payee`, category: "Transactions", issueType: "Unknown payee", client: "ABC Plumbing", description: "This transaction needs a payee before it can be reviewed.", amount, priority: "High", action: "Review transaction", destination: "Transactions" });
    if (amount >= 1000) items.push({ id: `${transaction.id}-large`, category: "Transactions", issueType: "Large transaction", client: "ABC Plumbing", description: `${transaction.payee} is a large transaction worth a second look.`, amount, priority: "Medium", action: "Review transaction", destination: "Transactions" });
    if (transaction.status === "Needs Receipt") items.push({ id: `${transaction.id}-receipt`, category: "Transactions", issueType: "May need receipt", client: "ABC Plumbing", description: `${transaction.payee} may need supporting documentation.`, amount, priority: "Medium", action: "Request receipt", destination: "Transactions" });
    if (transactionsToReview.some((other, otherIndex) => otherIndex < index && other.payee === transaction.payee && other.amount === transaction.amount)) items.push({ id: `${transaction.id}-duplicate`, category: "Transactions", issueType: "Duplicate-looking transaction", client: "ABC Plumbing", description: `${transaction.payee} has another transaction with the same amount.`, amount, priority: "Low", action: "Compare transactions", destination: "Transactions" });
  });
  invoicesToReview.forEach((invoice) => { const amount = invoice.amount - invoice.amountPaid; if (invoice.status === "Overdue") items.push({ id: `${invoice.id}-overdue`, category: "Receivables", issueType: "Overdue invoice", client: "ABC Plumbing", description: `${invoice.customer} invoice ${invoice.number} is overdue.`, amount, priority: amount >= 1000 ? "High" : "Medium", action: "Review invoice", destination: "Receivables" }); else if (amount >= 1000 && invoice.status !== "Paid") items.push({ id: `${invoice.id}-large`, category: "Receivables", issueType: "Large unpaid invoice", client: "ABC Plumbing", description: `${invoice.customer} still owes a large balance on ${invoice.number}.`, amount, priority: "Medium", action: "Review invoice", destination: "Receivables" }); });
  billsToReview.forEach((bill) => { const amount = bill.amount - bill.amountPaid; if (bill.status === "Overdue") items.push({ id: `${bill.id}-overdue`, category: "Payables", issueType: "Overdue bill", client: "ABC Plumbing", description: `${bill.vendor} bill ${bill.number} is overdue.`, amount, priority: "High", action: "Review bill", destination: "Payables" }); else if (bill.status === "Due Soon") items.push({ id: `${bill.id}-soon`, category: "Payables", issueType: "Bill due soon", client: "ABC Plumbing", description: `${bill.vendor} bill ${bill.number} is due soon.`, amount, priority: "Medium", action: "Review bill", destination: "Payables" }); else if (bill.status === "Needs Review") items.push({ id: `${bill.id}-review`, category: "Payables", issueType: "Bill needs review", client: "ABC Plumbing", description: `${bill.vendor} bill ${bill.number} needs review.`, amount, priority: "High", action: "Review bill", destination: "Payables" }); });
  accountsToReview.filter((account) => account.accountType === "Bank" || account.accountType === "Credit Card").forEach((account) => { if (account.currentBalance < 0) items.push({ id: `${account.quickBooksId || account.name}-balance`, category: "Reconciliation", issueType: "Account balance needs review", client: "ABC Plumbing", description: `${account.name} has a negative QuickBooks balance.`, amount: Math.abs(account.currentBalance), priority: "Medium", action: "Review account", destination: "Reconcile" }); });
  reconciliationData.filter((account) => account.statementBalance !== account.quickBooksBalance).forEach((account) => items.push({ id: `${account.id}-difference`, category: "Reconciliation", issueType: "Reconciliation difference", client: "ABC Plumbing", description: `${account.name} does not match its statement.`, amount: Math.abs(account.statementBalance - account.quickBooksBalance), priority: "High", action: "Find the problem", destination: "Reconcile" }));
  requests.filter((request) => request.status !== "Resolved").forEach((request) => items.push({ id: `${request.id}-question`, category: "Transactions", issueType: "Client question", client: request.client, description: request.question, priority: "Medium", action: "Open client request", destination: "Transactions" }));
  return items;
}

function BookkeepingReview({ source, data, clientRequests, reconciliationAccounts, loading, error, onSourceChange, onNavigate }: { source: ReviewSource; data: { transactions: LedgerTransaction[]; accounts: LedgerAccount[]; invoices: LedgerInvoice[]; bills: LedgerBill[] } | null; clientRequests: ClientRequest[]; reconciliationAccounts: ReconciliationAccount[]; loading: boolean; error: string | null; onSourceChange: (source: ReviewSource) => void; onNavigate: (destination: ReviewItem["destination"]) => void }) {
  const [filter, setFilter] = useState<"All" | ReviewCategory>("All");
  const items = buildReviewItems(source, data, clientRequests, reconciliationAccounts);
  const visibleItems = filter === "All" ? items : items.filter((item) => item.category === filter);
  const count = (priority: ReviewItem["priority"]) => items.filter((item) => item.priority === priority).length;
  return <div className="page-content"><section className="welcome-row"><div><h2>Bookkeeping Review</h2><p className="muted">Rule-based checks for items that may need attention.</p></div><span className="attention-summary"><strong>{items.length}</strong> items found</span></section><AccountSourceSwitch source={source} onChange={onSourceChange} />{loading && <div className="data-state-message">Loading QuickBooks Sandbox review data...</div>}{error && <div className="data-state-message error">{error}</div>}<div className="review-summary-grid"><SummaryCard value={`${items.length}`} label="Needs Attention" tone="red" /><SummaryCard value={`${count("High")}`} label="High Priority" tone="red" /><SummaryCard value={`${count("Medium")}`} label="Medium Priority" tone="amber" /><SummaryCard value={`${count("Low")}`} label="Low Priority" tone="green" /></div><div className="filter-row">{(["All", "Transactions", "Receivables", "Payables", "Reconciliation"] as const).map((option) => <button className={`filter-button ${filter === option ? "active" : ""}`} key={option} onClick={() => setFilter(option)}>{option}<span>{option === "All" ? items.length : items.filter((item) => item.category === option).length}</span></button>)}</div>{visibleItems.length === 0 ? <div className="empty-state"><span>✓</span><h2>You're all caught up.</h2><p className="muted">No rule-based review items were found.</p></div> : <div className="review-card-list">{visibleItems.map((item) => <button className="review-card" key={item.id} onClick={() => onNavigate(item.destination)}><div className="review-card-top"><span className="review-type">{item.issueType}</span><span className={`priority-badge ${item.priority.toLowerCase()}`}>{item.priority}</span></div><strong>{item.client}</strong><p>{item.description}</p>{item.amount !== undefined && <span className="review-amount">{formatMoney(item.amount)}</span>}<div className="review-card-footer"><span>Suggested next action: {item.action}</span><span className="row-arrow">→</span></div></button>)}</div>}</div>
}

const inboxFilters = [
  "All",
  "Transactions",
  "Receipts",
  "Client Questions",
  "Reconciliation",
  "Bills",
  "Month End",
] as const;

function Inbox({
  items,
  onOpenRequest,
  onNavigate,
}: {
  items: InboxItem[];
  onOpenRequest: (requestId: string) => void;
  onNavigate: (destination: InboxItem["destination"]) => void;
}) {
  const [filter, setFilter] = useState<(typeof inboxFilters)[number]>("All");
  const activeItems = items.filter((item) => item.status !== "Resolved");
  const filteredItems =
    filter === "All"
      ? activeItems
      : activeItems.filter((item) => matchesInboxFilter(item, filter));
  const openItem = (item: InboxItem) =>
    item.requestId
      ? onOpenRequest(item.requestId)
      : onNavigate(item.destination);
  const clientQuestionCount = activeItems.filter(
    (item) => item.type === "Client Question",
  ).length;
  const receiptCount = activeItems.some(
    (item) => item.type === "Missing Receipt",
  )
    ? 2
    : 0;
  const billCount = activeItems.some((item) => item.type === "Bill") ? 2 : 0;

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Bookkeeping Inbox</h2>
          <p className="muted">
            Everything that needs your attention, in one place.
          </p>
        </div>
        <span className="attention-summary">
          <strong>{activeItems.length}</strong> items need attention
        </span>
      </section>
      <div className="inbox-summary-grid">
        <SummaryCard value="14" label="Transactions need review" tone="red" />
        <SummaryCard
          value={`${receiptCount}`}
          label="Missing receipts"
          tone="amber"
        />
        <SummaryCard
          value={`${clientQuestionCount}`}
          label="Client question"
          tone="purple"
        />
        <SummaryCard value="1" label="Reconciliation issue" tone="blue" />
        <SummaryCard
          value={`${billCount}`}
          label="Bills need review"
          tone="red"
        />
      </div>
      <div className="filter-row" aria-label="Inbox filters">
        {inboxFilters.map((filterOption) => (
          <button
            className={`filter-button ${filter === filterOption ? "active" : ""}`}
            key={filterOption}
            onClick={() => setFilter(filterOption)}
          >
            {filterOption}
            <span>
              {filterOption === "All"
                ? activeItems.length
                : activeItems.filter((item) =>
                    matchesInboxFilter(item, filterOption),
                  ).length}
            </span>
          </button>
        ))}
      </div>
      {filteredItems.length === 0 ? (
        <div className="empty-state">
          <span>✓</span>
          <h2>You're all caught up.</h2>
          <p className="muted">There is nothing waiting for your attention.</p>
        </div>
      ) : (
        <div className="panel inbox-panel">
          <div className="inbox-heading">
            <span>Client</span>
            <span>Type</span>
            <span>Description</span>
            <span>Priority</span>
            <span>Date</span>
            <span>Status</span>
            <span />
          </div>
          {filteredItems.map((item) => (
            <button
              className="inbox-row"
              key={item.id}
              onClick={() => openItem(item)}
            >
              <strong>{item.client}</strong>
              <span className="inbox-type">{item.type}</span>
              <span>{item.description}</span>
              <span className={`priority-badge ${item.priority.toLowerCase()}`}>
                {item.priority}
              </span>
              <span>{item.date}</span>
              <span className={`inbox-status ${item.status.toLowerCase()}`}>
                {item.status}
              </span>
              <span className="row-arrow">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function matchesInboxFilter(
  item: InboxItem,
  filter: (typeof inboxFilters)[number],
) {
  const types: Record<string, InboxItem["type"]> = {
    Transactions: "Transaction",
    Receipts: "Missing Receipt",
    "Client Questions": "Client Question",
    Reconciliation: "Reconciliation",
    Bills: "Bill",
    "Month End": "Month End",
  };
  return item.type === types[filter];
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
  requests,
  selectedRequest,
  onSelect,
  onBack,
  onUpdate,
  onApplyResponse,
}: {
  requests: ClientRequest[];
  selectedRequest: ClientRequest | null;
  onSelect: (request: ClientRequest) => void;
  onBack: () => void;
  onUpdate: (request: ClientRequest) => void;
  onApplyResponse: (request: ClientRequest) => Promise<void>;
}) {
  const [filter, setFilter] = useState<ClientRequest["status"] | "All">("All");
  if (selectedRequest)
    return (
      <ClientRequestDetail
        request={selectedRequest}
        onBack={onBack}
        onUpdate={onUpdate}
        onApplyResponse={onApplyResponse}
      />
    );
  const visibleRequests = filter === "All" ? requests : requests.filter((request) => request.status === filter);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Client Requests</h2>
          <p className="muted">Questions waiting for ABC Plumbing's answers.</p>
        </div>
        <span className="attention-summary">
          <strong>{requests.filter((request) => request.status !== "Resolved").length}</strong> active requests
        </span>
      </section>
      <div className="filter-row">{(["All", "Draft", "Waiting for Client", "Client Responded", "Resolved"] as const).map((option) => <button className={`filter-button ${filter === option ? "active" : ""}`} key={option} onClick={() => setFilter(option)}>{option}<span>{option === "All" ? requests.length : requests.filter((request) => request.status === option).length}</span></button>)}</div>
      {visibleRequests.length === 0 ? (
        <div className="empty-state">
          <span>✓</span>
          <h2>You're all caught up.</h2>
          <p className="muted">All client questions have been resolved.</p>
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
                <span className="company-avatar">AB</span>
                <span>
                  <strong>{request.client}</strong>
                  <small>Created {request.dateCreated}</small>
                </span>
                <span
                  className={`inbox-status ${request.status.toLowerCase().replaceAll(" ", "-")}`}
                >
                  {request.status}
                </span>
              </div>
              <div className="request-card-related">
                <strong>{request.relatedTransaction}</strong>
                <span>{request.relatedAmount}</span>
              </div>
              <p>{request.question}</p>
              <span className="row-arrow">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientRequestDetail({
  request,
  onBack,
  onUpdate,
  onApplyResponse,
}: {
  request: ClientRequest;
  onBack: () => void;
  onUpdate: (request: ClientRequest) => void;
  onApplyResponse: (request: ClientRequest) => Promise<void>;
}) {
  const answers = ["Materials", "Equipment", "Office Supplies", "Utilities", "Meals", "Travel", "Other"];
  const [applyConfirmation, setApplyConfirmation] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const responseCategory = request.responseCategory || request.answer;
  const suggestedAccount = responseCategory === "Materials" ? "Job Materials" : responseCategory;
  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All requests
      </button>
      <section className="review-header">
        <div>
          <p className="eyebrow">CLIENT REQUEST · ABC PLUMBING</p>
          <h2>{request.relatedTransaction}</h2>
          <p className="muted">
            Created {request.dateCreated} · {request.relatedAmount}
          </p>
        </div>
        <span
          className={`inbox-status ${request.status.toLowerCase().replaceAll(" ", "-")}`}
        >
          {request.status}
        </span>
      </section>
      <section className="request-detail-layout">
        <div className="panel request-question">
          <h2>Question for the client</h2>
          <p className="request-question-text">{request.question}</p>
          <p className="muted">{request.client}</p>
          {request.answer ? (
            <div className="answer-box">
              <small>Client answer</small>
              <strong>{request.answer}</strong>
            </div>
          ) : (
            <div className="answer-options">
              <p className="muted">Simulate a client answer:</p>
              {answers.map((answer) => (
                <button
                  className="category-button"
                  key={answer}
                  onClick={() =>
                    onUpdate({ ...request, status: request.quickBooksId ? "Client Responded" : "Answered", answer, responseCategory: answer })
                  }
                >
                  {answer}
                  <span>→</span>
                </button>
              ))}
            </div>
          )}
          {request.quickBooksId && responseCategory && <div className="suggestion-box"><small>Suggested QuickBooks Change</small><strong>Current: {request.currentCategory || "Uncategorized Expense"}</strong><span>Change to: {suggestedAccount}</span></div>}
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
          </div>
          {request.quickBooksId && responseCategory && request.status === "Client Responded" && <><button className="primary-button resolve-button" onClick={() => setApplyConfirmation(true)}>Approve & Apply Response <span>→</span></button>{applyError && <div className="data-state-message error">{applyError}</div>}{applyConfirmation && <div className="confirmation-box"><strong>You are about to update this transaction in QuickBooks Sandbox.</strong><span>Transaction: {request.payee}</span><span>Amount: {request.amount}</span><span>Current category: {request.currentCategory}</span><span>New category: {suggestedAccount}</span><div><button className="secondary-button" onClick={() => setApplyConfirmation(false)}>Cancel</button><button className="primary-button" disabled={applying} onClick={async () => { setApplying(true); setApplyError(null); try { await onApplyResponse({ ...request, responseCategory: suggestedAccount }); setApplyConfirmation(false); } catch (error) { setApplyError(error instanceof Error ? error.message : "Unable to apply response."); } finally { setApplying(false); } }}>{applying ? "Updating..." : "Confirm Update"}</button></div></div>}</>}
          {request.status === "Answered" && !request.quickBooksId && (
            <button
              className="primary-button resolve-button"
              onClick={() => onUpdate({ ...request, status: "Resolved" })}
            >
              Mark Resolved <span>✓</span>
            </button>
          )}
          {request.status === "Resolved" && (
            <div className="resolved-note">✓ This request is resolved.</div>
          )}
        </div>
      </section>
    </div>
  );
}

const invoiceFilters = ["All", "Open", "Overdue", "Paid"] as const;
const billFilters = [
  "All",
  "Open",
  "Due Soon",
  "Overdue",
  "Needs Review",
  "Paid",
] as const;

function Receivables({
  source,
  invoices,
  quickBooksInvoices,
  isLoading,
  error,
  selectedInvoice,
  onSelect,
  onBack,
  onUpdate,
  onAskClient,
  onSourceChange,
}: {
  source: AccountSource;
  invoices: Invoice[];
  quickBooksInvoices: LedgerInvoice[];
  isLoading: boolean;
  error: string | null;
  selectedInvoice: Invoice | null;
  onSelect: (invoice: Invoice) => void;
  onBack: () => void;
  onUpdate: (invoice: Invoice) => void;
  onAskClient: (question: string, transaction: string, amount: string) => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  const [filter, setFilter] = useState<(typeof invoiceFilters)[number]>("All");
  const displayedInvoices = source === "demo" ? invoices : quickBooksInvoices;
  if (selectedInvoice)
    return (
      <InvoiceDetail
        invoice={selectedInvoice}
        readOnly={source === "quickbooks"}
        onBack={onBack}
        onUpdate={onUpdate}
        onAskClient={onAskClient}
      />
    );
  const outstanding = displayedInvoices.reduce(
    (total, invoice) => total + invoice.amount - invoice.amountPaid,
    0,
  );
  const filtered =
    filter === "All"
      ? displayedInvoices
      : displayedInvoices.filter((invoice) => invoice.status === filter);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Accounts Receivable</h2>
          <p className="muted">ABC Plumbing · Money customers owe you.</p>
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
          value={formatMoney(outstanding)}
          label="Total Outstanding"
          tone="red"
        />
        <SummaryCard value={formatMoney(4780)} label="Current" tone="green" />
        <SummaryCard
          value={formatMoney(2840)}
          label="1-30 Days Overdue"
          tone="amber"
        />
        <SummaryCard
          value={formatMoney(0)}
          label="31-60 Days Overdue"
          tone="blue"
        />
        <SummaryCard
          value={formatMoney(0)}
          label="60+ Days Overdue"
          tone="purple"
        />
      </div>
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
  invoice,
  readOnly,
  onBack,
  onUpdate,
  onAskClient,
}: {
  invoice: Invoice;
  readOnly: boolean;
  onBack: () => void;
  onUpdate: (invoice: Invoice) => void;
  onAskClient: (question: string, transaction: string, amount: string) => void;
}) {
  const remaining = invoice.amount - invoice.amountPaid;
  const markPayment = () =>
    onUpdate({ ...invoice, amountPaid: invoice.amount, status: "Paid" });
  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All invoices
      </button>
      <section className="review-header">
        <div>
          <p className="eyebrow">ACCOUNTS RECEIVABLE · ABC PLUMBING</p>
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
          <h2>Payment history</h2>
          <p className="muted">
            {invoice.amountPaid > 0
              ? `Payment received: ${formatMoney(invoice.amountPaid)}`
              : "No payments recorded yet."}
          </p>
          {!readOnly && (
            <button
              className="primary-button"
              disabled={remaining === 0}
              onClick={markPayment}
            >
              Mark Payment Received <span>✓</span>
            </button>
          )}
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
          {readOnly && (
            <p className="data-state-message">
              QuickBooks Sandbox data is read-only.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Payables({
  source,
  bills,
  quickBooksBills,
  isLoading,
  error,
  selectedBill,
  onSelect,
  onBack,
  onUpdate,
  onAskClient,
  onSourceChange,
}: {
  source: AccountSource;
  bills: Bill[];
  quickBooksBills: LedgerBill[];
  isLoading: boolean;
  error: string | null;
  selectedBill: Bill | null;
  onSelect: (bill: Bill) => void;
  onBack: () => void;
  onUpdate: (bill: Bill) => void;
  onAskClient: (question: string, transaction: string, amount: string) => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  const [filter, setFilter] = useState<(typeof billFilters)[number]>("All");
  const displayedBills = source === "demo" ? bills : quickBooksBills;
  if (selectedBill)
    return (
      <BillDetail
        bill={selectedBill}
        readOnly={source === "quickbooks"}
        onBack={onBack}
        onUpdate={onUpdate}
        onAskClient={onAskClient}
      />
    );
  const outstanding = displayedBills.reduce(
    (total, bill) => total + bill.amount - bill.amountPaid,
    0,
  );
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
            ABC Plumbing · Bills your company needs to pay.
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
          value={formatMoney(outstanding)}
          label="Total Bills Due"
          tone="red"
        />
        <SummaryCard
          value={formatMoney(986.44)}
          label="Due This Week"
          tone="amber"
        />
        <SummaryCard value={formatMoney(286)} label="Overdue" tone="purple" />
        <SummaryCard
          value={formatMoney(210)}
          label="Paid This Month"
          tone="green"
        />
      </div>
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
  bill,
  readOnly,
  onBack,
  onUpdate,
  onAskClient,
}: {
  bill: Bill;
  readOnly: boolean;
  onBack: () => void;
  onUpdate: (bill: Bill) => void;
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
          <p className="eyebrow">ACCOUNTS PAYABLE · ABC PLUMBING</p>
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
          <h2>Bill actions</h2>
          <p className="muted">Update this fake bill as you work through it.</p>
          {!readOnly && (
            <button
              className="primary-button"
              disabled={remaining === 0}
              onClick={() =>
                onUpdate({ ...bill, amountPaid: bill.amount, status: "Paid" })
              }
            >
              Mark Bill Paid <span>✓</span>
            </button>
          )}
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
          {readOnly && (
            <p className="data-state-message">
              QuickBooks Sandbox data is read-only.
            </p>
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
const reviewQueueFilters = ["Needs Review", "Missing Category", "Missing Payee", "Needs Receipt", "Large Transaction"] as const;

function reviewFilterMatch(transaction: Transaction, filter: (typeof reviewQueueFilters)[number]) {
  const amount = Number(transaction.amount.replace(/[$,]/g, ""));
  if (filter === "Needs Review") return transaction.status === "Needs Review" || transaction.status === "Needs Receipt";
  if (filter === "Missing Category") return !transaction.category || transaction.category === "Uncategorized";
  if (filter === "Missing Payee") return !transaction.payee || transaction.payee === "Unknown";
  if (filter === "Needs Receipt") return transaction.status === "Needs Receipt";
  return amount >= 1000;
}

function Transactions({
  transactions,
  quickBooksTransactions,
  source,
  isLoading,
  error,
  onSourceChange,
  selectedTransaction,
  onSelect,
  onBack,
  onUpdate,
  onRequestInformation,
  onQuickBooksUpdate,
  onCreateQuickBooksRequest,
}: {
  transactions: Transaction[];
  quickBooksTransactions: LedgerTransaction[];
  source: TransactionSource;
  isLoading: boolean;
  error: string | null;
  onSourceChange: (source: TransactionSource) => void;
  selectedTransaction: Transaction | null;
  onSelect: (transaction: Transaction) => void;
  onBack: () => void;
  onUpdate: (transaction: Transaction) => void;
  onRequestInformation: (transaction: Transaction) => void;
  onQuickBooksUpdate: (transaction: LedgerTransaction, category: string) => Promise<LedgerTransaction>;
  onCreateQuickBooksRequest: (transaction: LedgerTransaction, question: string) => void;
}) {
  const [filter, setFilter] =
    useState<(typeof transactionFilters)[number]>("All");
  const [reviewFilter, setReviewFilter] = useState<(typeof reviewQueueFilters)[number]>("Needs Review");

  const displayedTransactions = source === "demo" ? transactions : quickBooksTransactions;
  const reviewQueue = displayedTransactions.filter((transaction) => reviewFilterMatch(transaction, reviewFilter));
  const selectedIndex = selectedTransaction ? reviewQueue.findIndex((item) => item.id === selectedTransaction.id) : -1;
  const moveToReview = (index: number) => { if (reviewQueue[index]) onSelect(reviewQueue[index]); };

  if (selectedTransaction)
    return (
      <TransactionReview
        transaction={selectedTransaction}
        readOnly={source === "quickbooks"}
        onBack={onBack}
        onUpdate={onUpdate}
        onRequestInformation={onRequestInformation}
        onQuickBooksUpdate={onQuickBooksUpdate}
        onCreateQuickBooksRequest={onCreateQuickBooksRequest}
        allTransactions={displayedTransactions}
        reviewQueue={reviewQueue}
        reviewIndex={selectedIndex}
        onMoveToReview={moveToReview}
      />
    );

  const filteredTransactions =
    filter === "All"
      ? displayedTransactions
      : displayedTransactions.filter(
          (transaction) => transaction.status === filter,
        );
  const attentionCount = displayedTransactions.filter(
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
            Review ABC Plumbing's recent activity one item at a time.
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
      <div className="filter-row" aria-label="Transaction filters">
        {transactionFilters.map((filterOption) => (
          <button
            className={`filter-button ${filter === filterOption ? "active" : ""}`}
            key={filterOption}
            onClick={() => setFilter(filterOption)}
          >
            {filterOption}
            <span>
              {filterOption === "All"
                ? displayedTransactions.length
                : displayedTransactions.filter(
                    (transaction) => transaction.status === filterOption,
                  ).length}
            </span>
          </button>
        ))}
      </div>
      <div className="filter-row" aria-label="Review queue filters">{reviewQueueFilters.map((option) => <button className={`filter-button ${reviewFilter === option ? "active" : ""}`} key={option} onClick={() => setReviewFilter(option)}>{option}<span>{displayedTransactions.filter((transaction) => reviewFilterMatch(transaction, option)).length}</span></button>)}</div>
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
            <span>{transaction.category}</span>
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
  readOnly,
  onBack,
  onUpdate,
  onRequestInformation,
  onQuickBooksUpdate,
  onCreateQuickBooksRequest,
  allTransactions,
  reviewQueue,
  reviewIndex,
  onMoveToReview,
}: {
  transaction: LedgerTransaction;
  readOnly: boolean;
  onBack: () => void;
  onUpdate: (transaction: Transaction) => void;
  onRequestInformation: (transaction: Transaction) => void;
  onQuickBooksUpdate: (transaction: LedgerTransaction, category: string) => Promise<LedgerTransaction>;
  onCreateQuickBooksRequest: (transaction: LedgerTransaction, question: string) => void;
  allTransactions: Transaction[];
  reviewQueue: Transaction[];
  reviewIndex: number;
  onMoveToReview: (index: number) => void;
}) {
  const categories = [
    "Office Supplies",
    "Materials",
    "Equipment",
    "Utilities",
    "Meals",
    "Travel",
    "Personal / Ask Client",
    "Other",
  ];
  const chooseCategory = (category: string) => {
    onUpdate({ ...transaction, category, status: "Categorized" });
    if (!readOnly && reviewIndex >= 0) onMoveToReview(reviewIndex);
  };
  const [question, setQuestion] = useState("What was this purchase for?");
  const [showRequestComposer, setShowRequestComposer] = useState(false);
  const requestInformation = () => readOnly ? setShowRequestComposer(true) : onRequestInformation(transaction);
  const [selectedCategory, setSelectedCategory] = useState(transaction.category);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const supportedWrite = transaction.source === "quickbooks" && (transaction.transactionType === "Purchase" || transaction.transactionType === "Check");
  const history = allTransactions.filter((item) => item.payee === transaction.payee && item.category && item.category !== "Uncategorized").reduce<Record<string, number>>((counts, item) => { counts[item.category] = (counts[item.category] || 0) + 1; return counts; }, {});
  const historyItems = Object.entries(history).sort((left, right) => right[1] - left[1]);
  const suggestedCategory = historyItems[0]?.[0];
  const suggestionConfidence = (historyItems[0]?.[1] || 0) >= 5 ? "High" : (historyItems[0]?.[1] || 0) >= 2 ? "Medium" : "Low";
  const completedCount = Math.max(0, allTransactions.length - reviewQueue.length);
  const confirmUpdate = async () => {
    setUpdating(true);
    setUpdateError(null);
    try {
      await onQuickBooksUpdate(transaction, selectedCategory);
      setUpdated(true);
      setShowConfirmation(false);
      onMoveToReview(reviewIndex);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "QuickBooks rejected the update.");
    } finally {
      setUpdating(false);
    }
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
      <div className="review-progress-bar"><strong>{reviewQueue.length} transactions need review</strong><span>Progress: {completedCount} of {allTransactions.length} completed</span><div><span style={{ width: `${allTransactions.length ? (completedCount / allTransactions.length) * 100 : 0}%` }} /></div></div>
      <div className="review-navigation"><button className="secondary-button" disabled={reviewIndex <= 0} onClick={() => onMoveToReview(reviewIndex - 1)}>Previous</button><button className="secondary-button" disabled={reviewIndex < 0 || reviewIndex >= reviewQueue.length - 1} onClick={() => onMoveToReview(reviewIndex + 1)}>Next</button><button className="secondary-button" disabled={reviewIndex < 0 || reviewIndex >= reviewQueue.length - 1} onClick={() => onMoveToReview(reviewIndex + 1)}>Skip</button></div>
      <section className="review-layout">
        <div className="panel review-details">
          <h2>Transaction details</h2>
          <div className="detail-list">
            <span>
              <small>Payee</small>
              <strong>{transaction.payee}</strong>
            </span>
            <span>
              <small>Date</small>
              <strong>{transaction.date}</strong>
            </span>
            <span>
              <small>Amount</small>
              <strong>{transaction.amount}</strong>
            </span>
            <span>
              <small>Description</small>
              <strong>{transaction.description}</strong>
            </span>
            <span>
              <small>Current category</small>
              <strong>{transaction.category}</strong>
            </span>
            <span>
              <small>Status</small>
              <strong>{transaction.status}</strong>
            </span>
          </div>
        </div>
        {readOnly ? (
          <div className="panel review-choice">
            <h2>QuickBooks Sandbox transaction</h2>
            <p className="muted">Sandbox · Write Enabled · Test Data Only</p>
            <div className="detail-list"><span><small>Current QuickBooks category/account</small><strong>{transaction.category}</strong></span><span><small>Change to</small><strong>{selectedCategory}</strong></span></div>
            {historyItems.length > 0 && <div className="category-history"><strong>Previously used for {transaction.payee}</strong>{historyItems.map(([category, count]) => <span key={category}>{category} — {count} times</span>)}</div>}
            {suggestedCategory && <div className="suggestion-box"><small>Suggested Category</small><strong>{suggestedCategory}</strong><span>Confidence: {suggestionConfidence}</span><button className="secondary-button" onClick={() => setSelectedCategory(suggestedCategory)}>Use suggestion</button></div>}
            {showRequestComposer && <div className="confirmation-box"><strong>Ask the client</strong><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><div><button className="secondary-button" onClick={() => setShowRequestComposer(false)}>Cancel</button><button className="primary-button" onClick={() => { onCreateQuickBooksRequest(transaction, question); setShowRequestComposer(false); }}>Save Request</button></div></div>}
            {supportedWrite ? <><div className="category-grid">{categories.map((category) => <button className={`category-button ${selectedCategory === category ? "selected" : ""}`} key={category} onClick={() => setSelectedCategory(category)}>{category}{selectedCategory === category && <span>✓</span>}</button>)}</div><div className="change-preview"><strong>Change preview</strong><span>Current: {transaction.category}</span><span>Change to: {selectedCategory}</span></div>{suggestedCategory && suggestionConfidence === "High" && <button className="secondary-button" onClick={() => { setSelectedCategory(suggestedCategory); setShowConfirmation(true); }}>Approve Suggestion <span>✓</span></button>}{updated && <div className="data-state-message">Updated in QuickBooks</div>}{updateError && <div className="data-state-message error">{updateError}</div>}<button className="primary-button" disabled={selectedCategory === transaction.category || updating} onClick={() => setShowConfirmation(true)}>Approve & Update QuickBooks <span>→</span></button>{showConfirmation && <div className="confirmation-box"><strong>You are about to update this transaction in QuickBooks Sandbox.</strong><span>Transaction: {transaction.payee}</span><span>Amount: {transaction.amount}</span><span>Current category: {transaction.category}</span><span>New category: {selectedCategory}</span><div><button className="secondary-button" onClick={() => setShowConfirmation(false)}>Cancel</button><button className="primary-button" disabled={updating} onClick={confirmUpdate}>{updating ? "Updating..." : "Confirm Update"}</button></div></div>}</> : <p className="data-state-message">This transaction type is read-only for now.</p>}
          </div>
        ) : (
          <div className="panel review-choice">
            <h2>What was this purchase for?</h2>
            <p className="muted">
              Choose a category to clean up this transaction.
            </p>
            <div className="category-grid">
              {categories.map((category) => (
                <button
                  className={`category-button ${transaction.category === category ? "selected" : ""}`}
                  key={category}
                  onClick={() => chooseCategory(category)}
                >
                  {category}
                  {transaction.category === category && <span>✓</span>}
                </button>
              ))}
            </div>
            {transaction.suggestedCategory &&
              transaction.status === "Needs Review" && (
                <div className="suggestion-box">
                  <div>
                    <small>Suggested category</small>
                    <strong>{transaction.suggestedCategory}</strong>
                    <span>{transaction.confidence}% confidence</span>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() =>
                      chooseCategory(transaction.suggestedCategory!)
                    }
                  >
                    Accept suggestion <span>✓</span>
                  </button>
                </div>
              )}
            <button className="secondary-button" onClick={requestInformation}>
              Request More Information <span>→</span>
            </button>
          </div>
        )}
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
}: {
  quickBooksStatus: QuickBooksStatus;
  company: QuickBooksCompany | null;
  onStatusChange: (status: QuickBooksStatus) => void;
  onCompanyChange: (company: QuickBooksCompany) => void;
  auditLog: AuditLogEntry[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState(false);

  useEffect(() => {
    quickBooksService
      .getStatus()
      .then(onStatusChange)
      .catch(() =>
        setError("Start the backend server to check QuickBooks status."),
      );
  }, [onStatusChange]);

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
              onClick={quickBooksService.connect}
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
        <section className="panel settings-card audit-log-card">
          <h2>Audit Log</h2>
          <p className="muted">Local test record of QuickBooks Sandbox write attempts.</p>
          {auditLog.length === 0 ? <p className="muted">No QuickBooks updates attempted.</p> : <div className="audit-log-list">{auditLog.map((entry, index) => <div className="audit-log-row" key={`${entry.timestamp}-${index}`}><strong>{entry.result}</strong><span>{entry.transactionType} · {entry.quickBooksId}</span><span>{entry.oldCategory} → {entry.newCategory}</span><small>{new Date(entry.timestamp).toLocaleString()}</small></div>)}</div>}
        </section>
      </div>
    </div>
  );
}

const reportPeriods = [
  "This Month",
  "Last Month",
  "This Quarter",
  "This Year",
] as const;
type ReportPeriod = (typeof reportPeriods)[number];
type ReportName =
  | "Profit & Loss"
  | "Balance Sheet"
  | "Cash Flow"
  | "Accounts Receivable"
  | "Accounts Payable";

function Reports({
  invoices,
  bills,
  reportData,
  source,
  onSourceChange,
}: {
  invoices: Invoice[];
  bills: Bill[];
  reportData: DemoReportData;
  source: AccountSource;
  onSourceChange: (source: AccountSource) => void;
}) {
  const [period, setPeriod] = useState<ReportPeriod>("This Month");
  const [selectedReport, setSelectedReport] = useState<ReportName | null>(null);
  const [quickBooksReport, setQuickBooksReport] = useState<LedgerReport | null>(
    null,
  );
  const [quickBooksInvoices, setQuickBooksInvoices] = useState<LedgerInvoice[]>(
    [],
  );
  const [quickBooksBills, setQuickBooksBills] = useState<LedgerBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const multiplier =
    period === "Last Month"
      ? 0.94
      : period === "This Quarter"
        ? 2.88
        : period === "This Year"
          ? 11.6
          : 1;
  const scale = (amount: number) => amount * multiplier;
  const outstanding = invoices.reduce(
    (total, invoice) => total + invoice.amount - invoice.amountPaid,
    0,
  );
  const billsDue = bills.reduce(
    (total, bill) => total + bill.amount - bill.amountPaid,
    0,
  );
  const reports: { name: ReportName; description: string }[] = [
    {
      name: "Profit & Loss",
      description: "See income, expenses, and net profit.",
    },
    {
      name: "Balance Sheet",
      description: "See what ABC Plumbing owns and owes.",
    },
    { name: "Cash Flow", description: "See how cash moved during the period." },
    {
      name: "Accounts Receivable",
      description: "See money customers still owe.",
    },
    {
      name: "Accounts Payable",
      description: "See bills ABC Plumbing needs to pay.",
    },
  ];
  const loadQuickBooksReport = async (
    name: ReportName,
    selectedPeriod: ReportPeriod,
  ) => {
    setLoading(true);
    setError(null);
    try {
      if (name === "Accounts Receivable")
        setQuickBooksInvoices(await quickBooksService.getInvoices());
      else if (name === "Accounts Payable")
        setQuickBooksBills(await quickBooksService.getBills());
      else {
        const reportPath =
          name === "Profit & Loss"
            ? "profit-loss"
            : name === "Balance Sheet"
              ? "balance-sheet"
              : "cash-flow";
        setQuickBooksReport(
          await quickBooksService.getReport(reportPath, selectedPeriod),
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load QuickBooks report.",
      );
    } finally {
      setLoading(false);
    }
  };
  const selectReport = (name: ReportName) => {
    setSelectedReport(name);
    if (source === "quickbooks") void loadQuickBooksReport(name, period);
  };
  const changeSource = (nextSource: AccountSource) => {
    onSourceChange(nextSource);
    setQuickBooksReport(null);
    setError(null);
    if (nextSource === "quickbooks" && selectedReport)
      void loadQuickBooksReport(selectedReport, period);
  };
  const changePeriod = (nextPeriod: ReportPeriod) => {
    setPeriod(nextPeriod);
    if (source === "quickbooks" && selectedReport)
      void loadQuickBooksReport(selectedReport, nextPeriod);
  };
  useEffect(() => {
    if (source === "quickbooks" && selectedReport) {
      void loadQuickBooksReport(selectedReport, period);
    }
  }, [source, selectedReport, period]);
  if (selectedReport)
    return source === "quickbooks" ? (
      <QuickBooksReportDetail
        name={selectedReport}
        period={period}
        report={quickBooksReport}
        invoices={quickBooksInvoices}
        bills={quickBooksBills}
        loading={loading}
        error={error}
        onBack={() => setSelectedReport(null)}
      />
    ) : (
      <ReportDetail
        name={selectedReport}
        period={period}
        scale={scale}
        outstanding={outstanding}
        billsDue={billsDue}
        reportData={reportData}
        onBack={() => setSelectedReport(null)}
      />
    );

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Reports</h2>
          <p className="muted">Simple financial reports for ABC Plumbing.</p>
        </div>
        <div className="period-selector" aria-label="Report period">
          {reportPeriods.map((option) => (
            <button
              className={period === option ? "active" : ""}
              key={option}
              onClick={() => changePeriod(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </section>
      <AccountSourceSwitch source={source} onChange={changeSource} />
      {loading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox report...
        </div>
      )}
      {error && <div className="data-state-message error">{error}</div>}
      <div className="report-card-grid">
        {reports.map((report) => (
          <button
            className="report-card"
            key={report.name}
            onClick={() => selectReport(report.name)}
          >
            <span className="report-icon">▥</span>
            <span className="report-card-copy">
              <strong>{report.name}</strong>
              <small>{period} · August 2026</small>
              <span>{report.description}</span>
            </span>
            <span className="report-open">Open report →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickBooksReportDetail({
  name,
  period,
  report,
  invoices,
  bills,
  loading,
  error,
  onBack,
}: {
  name: ReportName;
  period: ReportPeriod;
  report: LedgerReport | null;
  invoices: LedgerInvoice[];
  bills: LedgerBill[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
}) {
  const row = (label: string, amount: number, bold = false) => (
    <div className={`report-row ${bold ? "bold" : ""}`}>
      <span>{label}</span>
      <strong>{formatMoney(amount)}</strong>
    </div>
  );
  const total = (label: string) =>
    report?.totals.find((line) =>
      line.label.toLowerCase().includes(label.toLowerCase()),
    );
  const reportContent = report
    ? report.sections.map((section) => (
        <div className="report-section" key={section.label}>
          <h3>{section.label}</h3>
          {section.lines.map((line) => row(line.label, line.amount))}
        </div>
      ))
    : null;
  const invoiceOutstanding = invoices.reduce(
    (sum, invoice) => sum + invoice.amount - invoice.amountPaid,
    0,
  );
  const billOutstanding = bills.reduce(
    (sum, bill) => sum + bill.amount - bill.amountPaid,
    0,
  );
  const summaryContent =
    name === "Accounts Receivable" ? (
      <div className="report-section">
        {row("Total Outstanding", invoiceOutstanding, true)}
        {row(
          "Current",
          invoices
            .filter((invoice) => invoice.status === "Open")
            .reduce(
              (sum, invoice) => sum + invoice.amount - invoice.amountPaid,
              0,
            ),
        )}
        {row(
          "Overdue",
          invoices
            .filter((invoice) => invoice.status === "Overdue")
            .reduce(
              (sum, invoice) => sum + invoice.amount - invoice.amountPaid,
              0,
            ),
        )}
      </div>
    ) : name === "Accounts Payable" ? (
      <div className="report-section">
        {row("Total Bills Due", billOutstanding, true)}
        {row(
          "Due Soon",
          bills
            .filter((bill) => bill.status === "Due Soon")
            .reduce((sum, bill) => sum + bill.amount - bill.amountPaid, 0),
        )}
        {row(
          "Overdue",
          bills
            .filter((bill) => bill.status === "Overdue")
            .reduce((sum, bill) => sum + bill.amount - bill.amountPaid, 0),
        )}
      </div>
    ) : (
      <>
        {reportContent}
        <div className="report-total">
          <span>
            {name === "Profit & Loss"
              ? "Net Profit"
              : name === "Cash Flow"
                ? "Ending Cash"
                : "Total Liabilities + Equity"}
          </span>
          <strong>
            {formatMoney(
              total(
                name === "Profit & Loss"
                  ? "net income"
                  : name === "Cash Flow"
                    ? "ending cash"
                    : "liabilities and equity",
              )?.amount || 0,
            )}
          </strong>
        </div>
      </>
    );
  return (
    <div className="page-content report-detail-page">
      <div className="report-detail-toolbar">
        <button className="back-button" onClick={onBack}>
          ← All reports
        </button>
        <span className="read-only-label">QuickBooks Sandbox · Read only</span>
        <button
          className="secondary-button print-button"
          onClick={() => window.print()}
        >
          Print report <span>⎙</span>
        </button>
      </div>
      <section className="report-detail-heading">
        <div>
          <p className="eyebrow">ABC PLUMBING · {period.toUpperCase()}</p>
          <h2>{name}</h2>
          <p className="muted">Live QuickBooks Online report</p>
        </div>
      </section>
      {loading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox report...
        </div>
      )}
      {error && <div className="data-state-message error">{error}</div>}
      <div className="report-paper">{summaryContent}</div>
    </div>
  );
}

function ReportDetail({
  name,
  period,
  scale,
  outstanding,
  billsDue,
  reportData,
  onBack,
}: {
  name: ReportName;
  period: ReportPeriod;
  scale: (amount: number) => number;
  outstanding: number;
  billsDue: number;
  reportData: DemoReportData;
  onBack: () => void;
}) {
  const printReport = () => window.print();
  const income = scale(84260);
  const expenses = scale(52418);
  const netProfit = income - expenses;
  const row = (label: string, amount: number, bold = false) => (
    <div className={`report-row ${bold ? "bold" : ""}`}>
      <span>{label}</span>
      <strong>{formatMoney(amount)}</strong>
    </div>
  );
  const section = (
    title: string,
    rows: { label: string; amount: number }[],
    total: { label: string; amount: number },
  ) => (
    <div className="report-section">
      <h3>{title}</h3>
      {rows.map((line) => row(line.label, scale(line.amount)))}
      {row(total.label, scale(total.amount), true)}
    </div>
  );

  let content: ReactNode;
  if (name === "Profit & Loss")
    content = (
      <>
        {section("Income", reportData.income, {
          label: "Total Income",
          amount: 84260,
        })}
        {section("Expenses", reportData.expenses, {
          label: "Total Expenses",
          amount: 52418,
        })}
        <div className="report-total profit">
          <span>Net Profit</span>
          <strong>{formatMoney(netProfit)}</strong>
        </div>
      </>
    );
  else if (name === "Balance Sheet")
    content = (
      <>
        {section(
          "Assets",
          [
            ...reportData.assets,
            { label: "Accounts Receivable", amount: outstanding },
          ],
          { label: "Total Assets", amount: 79661.72 + outstanding },
        )}
        {section(
          "Liabilities",
          [
            ...reportData.liabilities,
            { label: "Accounts Payable", amount: billsDue },
          ],
          { label: "Total Liabilities", amount: 18010.3 + billsDue },
        )}
        {section(
          "Equity",
          [
            ...reportData.equity,
            { label: "Current Year Earnings", amount: netProfit },
          ],
          { label: "Total Equity", amount: 25000 + netProfit },
        )}
        <div className="report-total">
          <span>Total Liabilities + Equity</span>
          <strong>{formatMoney(43010.3 + billsDue + netProfit)}</strong>
        </div>
      </>
    );
  else if (name === "Cash Flow")
    content = (
      <div className="report-section cash-flow-report">
        {reportData.cashFlow.map((line) =>
          row(line.label, scale(line.amount), true),
        )}
        {row("Net Change in Cash", scale(26100), true)}
        {row("Ending Cash Balance", scale(48421.72), true)}
      </div>
    );
  else if (name === "Accounts Receivable")
    content = (
      <div className="report-section">
        {row("Total Outstanding", outstanding, true)}
        {row("Current", scale(4780))}
        {row("1-30 Days Overdue", scale(2840))}
        {row("31-60 Days Overdue", scale(0))}
        {row("60+ Days Overdue", scale(0))}
      </div>
    );
  else
    content = (
      <div className="report-section">
        {row("Total Bills Due", billsDue, true)}
        {row("Due This Week", scale(986.44))}
        {row("Overdue", scale(286))}
        {row("Paid This Month", scale(210))}
      </div>
    );

  return (
    <div className="page-content report-detail-page">
      <div className="report-detail-toolbar">
        <button className="back-button" onClick={onBack}>
          ← All reports
        </button>
        <button className="secondary-button print-button" onClick={printReport}>
          Print report <span>⎙</span>
        </button>
      </div>
      <section className="report-detail-heading">
        <div>
          <p className="eyebrow">ABC PLUMBING · {period.toUpperCase()}</p>
          <h2>{name}</h2>
          <p className="muted">August 2026 · Fake demo report</p>
        </div>
      </section>
      <div className="report-paper">{content}</div>
    </div>
  );
}

function buildQuickBooksMonthEndChecklist(data: { transactions: LedgerTransaction[]; accounts: LedgerAccount[]; invoices: LedgerInvoice[]; bills: LedgerBill[] }, requests: ClientRequest[], reconciliationAccounts: ReconciliationAccount[]): MonthEndItem[] {
  const reviewItems = buildReviewItems("quickbooks", data, requests, reconciliationAccounts);
  const transactionIssues = reviewItems.filter((item) => item.category === "Transactions");
  const overdueInvoices = data.invoices.filter((invoice) => invoice.status === "Overdue");
  const overdueBills = data.bills.filter((bill) => bill.status === "Overdue");
  const openRequests = requests.filter((request) => request.status !== "Resolved");
  const bankReady = data.accounts.some((account) => account.accountType === "Bank" && account.active);
  const cardReady = data.accounts.some((account) => account.accountType === "Credit Card" && account.active);
  const item = (id: string, label: string, status: MonthEndItem["status"], explanation?: string, relatedView?: MonthEndItem["relatedView"], relatedLabel?: string): MonthEndItem => ({ id, label, status, explanation, relatedView, relatedLabel });
  return [
    item("qb-bank", "Bank accounts reviewed", bankReady ? "Complete" : "Not Started", bankReady ? undefined : "No active QuickBooks bank account was available.", "Reconcile", "Go to Reconcile"),
    item("qb-card", "Credit card accounts reviewed", cardReady ? "Complete" : "Not Started", cardReady ? undefined : "No active QuickBooks credit card account was available.", "Reconcile", "Go to Reconcile"),
    item("qb-transactions", "Transactions needing review", transactionIssues.length === 0 ? "Complete" : "Needs Attention", transactionIssues.length ? `${transactionIssues.length} transactions still need attention` : undefined, "Transactions", "Go to Transactions"),
    item("qb-category", "Missing categories", reviewItems.some((review) => review.issueType === "Missing category") ? "Needs Attention" : "Complete", reviewItems.some((review) => review.issueType === "Missing category") ? "Some transactions still need categories." : undefined, "Transactions", "Go to Transactions"),
    item("qb-payee", "Missing payees", reviewItems.some((review) => review.issueType === "Unknown payee") ? "Needs Attention" : "Complete", reviewItems.some((review) => review.issueType === "Unknown payee") ? "Some transactions have unknown payees." : undefined, "Transactions", "Go to Transactions"),
    item("qb-receipts", "Missing receipts", reviewItems.some((review) => review.issueType === "May need receipt") ? "Needs Attention" : "Complete", reviewItems.some((review) => review.issueType === "May need receipt") ? "Some transactions may need receipts." : undefined, "Transactions", "Go to Transactions"),
    item("qb-invoices", "Overdue invoices reviewed", overdueInvoices.length === 0 ? "Complete" : "Needs Attention", overdueInvoices.length ? `${overdueInvoices.length} overdue invoices need review` : undefined, "Receivables", "Go to Receivables"),
    item("qb-bills", "Overdue bills reviewed", overdueBills.length === 0 ? "Complete" : "Needs Attention", overdueBills.length ? `${overdueBills.length} overdue bills need review` : undefined, "Payables", "Go to Payables"),
    item("qb-requests", "Open client requests", openRequests.length === 0 ? "Complete" : "Needs Attention", openRequests.length ? `${openRequests.length} questions are waiting for client responses` : undefined, "Client Requests", "Go to Client Requests"),
    item("qb-reconcile", "Reconciliation issues", "Not Available", "QuickBooks reconciliation statement data is not available yet.", "Reconcile", "Go to Reconcile"),
    item("qb-pnl", "Profit & Loss reviewed", "Not Available", "Report review tracking is not available yet.", "Reports", "Go to Reports"),
    item("qb-balance", "Balance Sheet reviewed", "Not Available", "Report review tracking is not available yet.", "Reports", "Go to Reports"),
  ];
}

function MonthEnd({
  source,
  checklist,
  quickBooksTransactions,
  quickBooksAccounts,
  quickBooksInvoices,
  quickBooksBills,
  reviewRequests,
  reviewReconciliationAccounts,
  completed,
  onUpdate,
  onComplete,
  history,
  onNavigate,
}: {
  source: AccountSource;
  checklist: MonthEndItem[];
  quickBooksTransactions: LedgerTransaction[];
  quickBooksAccounts: LedgerAccount[];
  quickBooksInvoices: LedgerInvoice[];
  quickBooksBills: LedgerBill[];
  reviewRequests: ClientRequest[];
  reviewReconciliationAccounts: ReconciliationAccount[];
  completed: boolean;
  onUpdate: (item: MonthEndItem) => void;
  onComplete: (status: string) => void;
  history: MonthEndCompletion[];
  onNavigate: (destination: NonNullable<MonthEndItem["relatedView"]>) => void;
}) {
  const activeChecklist = source === "quickbooks" ? buildQuickBooksMonthEndChecklist({ transactions: quickBooksTransactions, accounts: quickBooksAccounts, invoices: quickBooksInvoices, bills: quickBooksBills }, reviewRequests, reviewReconciliationAccounts) : checklist;
  const completedCount = activeChecklist.filter(
    (item) => item.status === "Complete",
  ).length;
  const progress = Math.round((completedCount / activeChecklist.length) * 100);
  const attentionCount = activeChecklist.filter(
    (item) => item.status !== "Complete",
  ).length;
  const [selectedItemId, setSelectedItemIdState] = useState<string | null>(
    null,
  );
  const selectedItem = activeChecklist.find((item) => item.id === selectedItemId);
  const setSelectedItemId = (nextId: string | null) => {
    if (selectedItemId && nextId === null) {
      const item = activeChecklist.find(
        (checklistItem) => checklistItem.id === selectedItemId,
      );
      if (item && item.status !== "Complete")
        onUpdate({ ...item, status: "Complete" });
    }
    setSelectedItemIdState(nextId);
  };

  return (
    <div className="page-content">
      <section className="month-end-hero">
        <div>
          <p className="eyebrow">ABC PLUMBING · AUGUST 2026</p>
          <h2>Month End</h2>
          <p className="muted">
            Finish the monthly checklist and get the books ready.
          </p>
        </div>
        <div className="month-progress-summary">
          <span>Month-End Progress</span>
          <strong>{completed ? "100%" : `${progress}%`} Complete</strong>
          <div className="large-progress">
            <span style={{ width: `${completed ? 100 : progress}%` }} />
          </div>
        </div>
      </section>
      {completed ? (
        <div className="ready-banner">
          <div>
            <h2>August books are ready</h2>
            <p className="muted">
              ABC Plumbing's August 2026 month end is complete.
            </p>
          </div>
          <span>✓</span>
        </div>
      ) : (
        <div className="month-attention-summary">
          <strong>{attentionCount}</strong>{" "}
          {attentionCount === 1 ? "item needs" : "items need"} attention
        </div>
      )}
      {source === "quickbooks" && <div className={`reconcile-status ${progress === 100 ? "ready" : "problem"}`}>{progress === 100 ? "Ready to Close" : "Not Ready to Close"}</div>}
      <section className="panel month-checklist">
        <div className="panel-heading">
          <div>
            <h2>Month-end checklist</h2>
            <p className="muted">Click an item to see its current status.</p>
          </div>
          <span className="count-pill">
            {completedCount} of {activeChecklist.length} complete
          </span>
        </div>
        <div className="month-items">
          {activeChecklist.map((item) => (
            <button
              className={`month-item ${item.status.toLowerCase().replaceAll(" ", "-")}`}
              key={item.id}
              onClick={() =>
                setSelectedItemId(selectedItemId === item.id ? null : item.id)
              }
            >
              <span
                className={`month-check ${item.status === "Complete" ? "checked" : ""}`}
              >
                {item.status === "Complete"
                  ? "✓"
                  : item.status === "Needs Attention"
                    ? "!"
                    : ""}
              </span>
              <span className="month-item-label">
                <strong>{item.label}</strong>
                {selectedItemId === item.id && item.explanation && (
                  <span className="month-explanation">{item.explanation}</span>
                )}
              </span>
              <span
                className={`month-status ${item.status.toLowerCase().replaceAll(" ", "-")}`}
              >
                {item.status}
              </span>
              <span className="row-arrow">
                {selectedItemId === item.id ? "⌃" : "→"}
              </span>
            </button>
          ))}
        </div>
        {selectedItem?.explanation && selectedItem.relatedView && (
          <div className="month-related-action">
            <div>
              <strong>{selectedItem.explanation}</strong>
              <span>Take care of this item in the related section.</span>
            </div>
            <button
              className="secondary-button"
              onClick={() => onNavigate(selectedItem.relatedView!)}
            >
              {selectedItem.relatedLabel} <span>→</span>
            </button>
          </div>
        )}
      </section>
      <button
        className="primary-button complete-month-button"
        disabled={progress !== 100 || completed}
        onClick={() => onComplete(activeChecklist.map((item) => `${item.label}: ${item.status}`).join("; "))}
      >
        {completed ? "Month End Complete" : "Complete Month End"}{" "}
        <span>{completed ? "✓" : "→"}</span>
      </button>
      {history.length > 0 && <section className="panel month-history"><h2>Month-End History</h2>{history.map((entry, index) => <div className="audit-log-row" key={`${entry.dateCompleted}-${index}`}><strong>{entry.month}</strong><span>{entry.client} · Completed {entry.dateCompleted}</span><span>{entry.checklistStatus}</span><small>Completed by: {entry.completedBy}</small></div>)}</section>}
    </div>
  );
}

function Reconcile({
  source,
  accounts,
  isLoading,
  error,
  selectedAccount,
  onSelect,
  onBack,
  onSourceChange,
}: {
  source: AccountSource;
  accounts: LedgerAccount[];
  isLoading: boolean;
  error: string | null;
  selectedAccount: ReconciliationAccount | null;
  onSelect: (account: ReconciliationAccount) => void;
  onBack: () => void;
  onSourceChange: (source: AccountSource) => void;
}) {
  if (source === "demo" && selectedAccount)
    return (
      <ReconciliationWorkspace
        account={selectedAccount}
        onBack={onBack}
        onUpdate={onSelect}
      />
    );
  const quickBooksAccounts = accounts.filter(
    (account) =>
      account.active &&
      (account.accountType === "Bank" || account.accountType === "Credit Card"),
  );

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <h2>Reconcile</h2>
          <p className="muted">Make sure each account matches its statement.</p>
        </div>
        <span className="count-pill">ABC Plumbing</span>
      </section>
      <AccountSourceSwitch source={source} onChange={onSourceChange} />
      {isLoading && (
        <div className="data-state-message">
          Loading QuickBooks Sandbox accounts...
        </div>
      )}
      {error && <div className="data-state-message error">{error}</div>}
      {source === "demo" ? (
        <div className="reconciliation-account-grid">
          {reconciliationAccounts.map((account) => (
            <button
              className="reconciliation-account-card"
              key={account.id}
              onClick={() => onSelect(account)}
            >
              <div className="account-card-header">
                <span className="account-icon">$</span>
                <span>
                  <strong>{account.name}</strong>
                  <small>Last reconciled {account.lastReconciled}</small>
                </span>
                <span className="row-arrow">→</span>
              </div>
              <div className="account-card-details">
                <span>
                  <small>Statement ending</small>
                  <strong>{account.statementEnding}</strong>
                </span>
                <span>
                  <small>QuickBooks balance</small>
                  <strong>{formatMoney(account.quickBooksBalance)}</strong>
                </span>
                <span>
                  <small>Statement balance</small>
                  <strong>{formatMoney(account.statementBalance)}</strong>
                </span>
              </div>
              <div className="account-card-footer">
                <span
                  className={`transaction-status ${account.status === "Ready to complete" ? "matched" : "needs-review"}`}
                >
                  {account.status}
                </span>
                <span
                  className={
                    account.quickBooksBalance === account.statementBalance
                      ? "success-text"
                      : "attention-number"
                  }
                >
                  Difference{" "}
                  {formatMoney(
                    account.statementBalance - account.quickBooksBalance,
                  )}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="reconciliation-account-grid">
          {quickBooksAccounts.map((account) => (
            <QuickBooksAccountCard
              account={account}
              key={account.quickBooksId || account.name}
            />
          ))}
        </div>
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

function QuickBooksAccountCard({ account }: { account: LedgerAccount }) {
  return (
    <div className="reconciliation-account-card quickbooks-account-card">
      <div className="account-card-header">
        <span className="account-icon">$</span>
        <span>
          <strong>{account.name}</strong>
          <small>QuickBooks Sandbox · {account.accountType}</small>
        </span>
      </div>
      <div className="account-card-details">
        <span>
          <small>Account type</small>
          <strong>{account.accountType}</strong>
        </span>
        <span>
          <small>Subtype</small>
          <strong>{account.accountSubType || "Not provided"}</strong>
        </span>
        <span>
          <small>Current balance</small>
          <strong>{formatMoney(account.currentBalance)}</strong>
        </span>
      </div>
      <div className="account-card-footer">
        <span className="transaction-status matched">Read only</span>
        <span>{account.currency || "USD"}</span>
      </div>
    </div>
  );
}

function ReconciliationWorkspace({
  account,
  onBack,
  onUpdate,
}: {
  account: ReconciliationAccount;
  onBack: () => void;
  onUpdate: (account: ReconciliationAccount) => void;
}) {
  const [completed, setCompleted] = useState(false);
  const toggleTransaction = (transactionId: string) =>
    onUpdate({
      ...account,
      transactions: account.transactions.map((transaction) =>
        transaction.id === transactionId
          ? { ...transaction, cleared: !transaction.cleared }
          : transaction,
      ),
    });
  const clearedBalance = account.transactions.reduce(
    (balance, transaction) =>
      transaction.cleared
        ? balance +
          (transaction.type === "Deposit"
            ? transaction.amount
            : -transaction.amount)
        : balance,
    0,
  );
  const totalTransactionChange = account.transactions.reduce(
    (balance, transaction) =>
      balance +
      (transaction.type === "Deposit"
        ? transaction.amount
        : -transaction.amount),
    0,
  );
  const isBalanced =
    Math.abs(
      account.statementBalance -
        (account.quickBooksBalance - totalTransactionChange + clearedBalance),
    ) < 0.005;
  const beginningBalance = account.quickBooksBalance - totalTransactionChange;
  const displayedClearedBalance = beginningBalance + clearedBalance;
  const actualDifference = account.statementBalance - displayedClearedBalance;
  const likelyProblems = account.possibleProblems || [
    "No likely problems found.",
  ];

  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All accounts
      </button>
      <section className="reconcile-header">
        <div>
          <p className="eyebrow">ABC PLUMBING · RECONCILIATION</p>
          <h2>{account.name.toUpperCase()}</h2>
          <p className="muted">Statement ending {account.statementEnding}</p>
        </div>
        <span
          className={`reconcile-status ${isBalanced ? "ready" : "problem"}`}
        >
          {isBalanced ? "Ready to Complete" : "Something doesn't match."}
        </span>
      </section>
      <section className="reconcile-summary">
        <BalanceItem
          label="Beginning balance"
          value={formatMoney(beginningBalance)}
        />
        <BalanceItem
          label="Statement ending balance"
          value={formatMoney(account.statementBalance)}
        />
        <BalanceItem
          label="Cleared balance"
          value={formatMoney(displayedClearedBalance)}
        />
        <BalanceItem
          label="Difference"
          value={formatMoney(actualDifference)}
          tone={isBalanced ? "good" : "bad"}
        />
      </section>
      {!isBalanced && (
        <div className="problem-panel">
          <div>
            <h2>Something doesn't match.</h2>
            <p className="muted">Check these common causes:</p>
            <ul>
              {[
                "Missing transaction",
                "Duplicate transaction",
                "Wrong transaction amount",
                "Transaction not cleared",
              ].map((cause) => (
                <li key={cause}>{cause}</li>
              ))}
            </ul>
          </div>
          <button
            className="secondary-button problem-button"
            onClick={() =>
              document
                .getElementById("likely-problems")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            Find the Problem <span>→</span>
          </button>
        </div>
      )}
      <section className="panel reconciliation-workspace">
        <div className="panel-heading">
          <div>
            <h2>Transactions included</h2>
            <p className="muted">
              Check each transaction that cleared the bank.
            </p>
          </div>
          <span className="count-pill">
            {
              account.transactions.filter((transaction) => transaction.cleared)
                .length
            }{" "}
            cleared
          </span>
        </div>
        <div className="reconcile-transaction-heading">
          <span>Cleared</span>
          <span>Date</span>
          <span>Payee</span>
          <span>Amount</span>
          <span>Type</span>
        </div>
        {account.transactions.map((transaction) => (
          <button
            className="reconcile-transaction-row"
            key={transaction.id}
            onClick={() => toggleTransaction(transaction.id)}
          >
            <span
              className={`clear-check ${transaction.cleared ? "checked" : ""}`}
            >
              {transaction.cleared ? "✓" : ""}
            </span>
            <span>{transaction.date}</span>
            <strong>{transaction.payee}</strong>
            <span>{formatMoney(transaction.amount)}</span>
            <span
              className={transaction.type === "Deposit" ? "success-text" : ""}
            >
              {transaction.type}
            </span>
          </button>
        ))}
      </section>
      {!isBalanced && (
        <div className="likely-problems" id="likely-problems">
          <h2>Likely problem transactions</h2>
          {likelyProblems.map((problem) => (
            <p key={problem}>! {problem}</p>
          ))}
        </div>
      )}
      <button
        className="primary-button complete-button"
        disabled={!isBalanced || completed}
        onClick={() => setCompleted(true)}
      >
        {completed ? "Reconciliation Complete" : "Complete Reconciliation"}{" "}
        <span>{completed ? "✓" : "→"}</span>
      </button>
    </div>
  );
}

function BalanceItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className={`balance-item ${tone || ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
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
  accountSource,
  quickBooksAccounts,
  accountLoading,
  accountError,
  onAccountSourceChange,
  onBack,
  onTransactions,
  onReconcile,
  onMonthEnd,
  onReceivables,
  onPayables,
  onReports,
}: {
  client: Client;
  accountSource: AccountSource;
  quickBooksAccounts: LedgerAccount[];
  accountLoading: boolean;
  accountError: string | null;
  onAccountSourceChange: (source: AccountSource) => void;
  onBack: () => void;
  onTransactions: () => void;
  onReconcile: () => void;
  onMonthEnd: () => void;
  onReceivables: () => void;
  onPayables: () => void;
  onReports: () => void;
}) {
  const bankBalance =
    accountSource === "quickbooks"
      ? formatMoney(quickBooksBalance(quickBooksAccounts, "Bank"))
      : client.bankBalance;
  const accountsReceivable =
    accountSource === "quickbooks"
      ? formatMoney(
          quickBooksBalance(quickBooksAccounts, "Accounts Receivable"),
        )
      : client.accountsReceivable;
  const accountsPayable =
    accountSource === "quickbooks"
      ? formatMoney(quickBooksBalance(quickBooksAccounts, "Accounts Payable"))
      : client.accountsPayable;
  return (
    <div className="page-content">
      <button className="back-button" onClick={onBack}>
        ← All clients
      </button>
      <section className="client-hero">
        <div>
          <span className="status-badge warning">Needs attention</span>
          <h2>{client.name}</h2>
          <p className="muted">Books for {client.month}</p>
        </div>
        <button className="primary-button" onClick={onTransactions}>
          Review transactions <span>→</span>
        </button>
      </section>
      <AccountSourceSwitch
        source={accountSource}
        onChange={onAccountSourceChange}
      />
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
          value={client.income}
          note="This month"
          tone="green"
        />
        <MetricCard
          label="Expenses"
          value={client.expenses}
          note="This month"
          tone="amber"
        />
        <MetricCard
          label="Profit"
          value={client.profit}
          note="This month"
          tone="blue"
        />
        <MetricCard
          label="Bank balance"
          value={bankBalance}
          note={
            accountSource === "quickbooks"
              ? "QuickBooks balance"
              : "As of today"
          }
          tone="purple"
        />
        <MetricCard
          label="Accounts receivable"
          value={accountsReceivable}
          note={
            accountSource === "quickbooks" ? "QuickBooks balance" : "To collect"
          }
          tone="green"
        />
        <MetricCard
          label="Accounts payable"
          value={accountsPayable}
          note={
            accountSource === "quickbooks" ? "QuickBooks balance" : "To pay"
          }
          tone="red"
        />
      </section>
      <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Bookkeeping status</h2>
              <p className="muted">A short list of what is left to do.</p>
            </div>
          </div>
          <div className="status-list">
            <StatusRow
              label="Transactions needing review"
              value="14"
              tone="red"
            />
            <StatusRow
              label="Uncategorized transactions"
              value="3"
              tone="amber"
            />
            <StatusRow label="Reconciliation" value="Ready" tone="green" />
            <StatusRow label="Missing receipts" value="1" tone="amber" />
            <StatusRow
              label="Client questions"
              value="1 waiting"
              tone="purple"
            />
            <StatusRow
              label="Month-end progress"
              value={`${client.monthEnd}%`}
              tone="blue"
            />
          </div>
        </div>
        <div className="panel action-panel">
          <div className="panel-heading">
            <div>
              <h2>Quick actions</h2>
              <p className="muted">Choose the next thing to work on.</p>
            </div>
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
function WorkRow({ item }: { item: (typeof todaysWork)[number] }) {
  return (
    <button className="work-row">
      <span className={`work-icon ${item.tone}`}>
        {item.tone === "red" ? "!" : item.tone === "amber" ? "◷" : "✓"}
      </span>
      <span className="work-copy">
        <strong>{item.title}</strong>
        <span>
          {item.client} · {item.detail}
        </span>
      </span>
      <span className="row-arrow">→</span>
    </button>
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
