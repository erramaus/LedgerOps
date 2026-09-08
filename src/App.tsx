import { useState } from 'react'
import { clientRequests, clients, demoBills, demoClient, demoInvoices, demoTransactions, inboxItems, monthEndItems, navigationItems, reconciliationAccounts, todaysWork, type Bill, type Client, type ClientRequest, type InboxItem, type Invoice, type MonthEndItem, type ReconciliationAccount, type ReconciliationTransaction, type Transaction } from './data/demoData'

type View = 'Dashboard' | 'Clients' | 'Inbox' | 'Transactions' | 'Reconcile' | 'Receivables' | 'Payables' | 'Month End' | 'Client Requests'

function App() {
  const [view, setView] = useState<View>('Dashboard')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>(demoTransactions)
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [selectedReconciliation, setSelectedReconciliation] = useState<ReconciliationAccount | null>(null)
  const [monthEndChecklist, setMonthEndChecklist] = useState<MonthEndItem[]>(monthEndItems)
  const [monthEndCompleted, setMonthEndCompleted] = useState(false)
  const [inbox, setInbox] = useState<InboxItem[]>(inboxItems)
  const [requests, setRequests] = useState<ClientRequest[]>(clientRequests)
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices)
  const [bills, setBills] = useState<Bill[]>(demoBills)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)

  const openClient = (client: Client) => {
    setSelectedClient(client)
    setView('Dashboard')
  }

  const openTransactions = () => {
    setSelectedTransaction(null)
    setView('Transactions')
  }

  const openReconcile = () => {
    setSelectedReconciliation(null)
    setView('Reconcile')
  }

  const openMonthEnd = () => setView('Month End')

  const openInbox = () => {
    setSelectedRequest(null)
    setView('Inbox')
  }

  const openRequests = () => setView('Client Requests')

  const openReceivables = () => { setSelectedInvoice(null); setView('Receivables') }
  const openPayables = () => { setSelectedBill(null); setView('Payables') }

  const updateMonthEndItem = (updatedItem: MonthEndItem) => {
    setMonthEndChecklist((currentItems) => currentItems.map((item) => item.id === updatedItem.id ? updatedItem : item))
  }

  const updateTransaction = (updatedTransaction: Transaction) => {
    setTransactions((currentTransactions) => currentTransactions.map((transaction) => transaction.id === updatedTransaction.id ? updatedTransaction : transaction))
    setSelectedTransaction(updatedTransaction)
  }

  const createRequest = (transaction: Transaction) => {
    const request: ClientRequest = { id: `request-${transaction.id}`, client: 'ABC Plumbing', dateCreated: 'September 7, 2026', relatedTransaction: transaction.payee, relatedAmount: transaction.amount, question: 'What was this purchase for?', status: 'Waiting for Client' }
    setRequests((currentRequests) => currentRequests.some((currentRequest) => currentRequest.id === request.id) ? currentRequests : [...currentRequests, request])
    setInbox((currentInbox) => currentInbox.some((item) => item.requestId === request.id) ? currentInbox : [...currentInbox, { id: `inbox-${request.id}`, client: request.client, type: 'Client Question', description: `${request.relatedTransaction} purchase needs an answer`, priority: 'High', date: 'Today', status: 'Open', destination: 'Client Requests', requestId: request.id }])
    updateTransaction({ ...transaction, status: 'Needs Receipt' })
  }

  const updateRequest = (updatedRequest: ClientRequest) => {
    setRequests((currentRequests) => currentRequests.map((request) => request.id === updatedRequest.id ? updatedRequest : request))
    setInbox((currentInbox) => currentInbox.map((item) => item.requestId === updatedRequest.id ? { ...item, status: updatedRequest.status === 'Resolved' ? 'Resolved' : 'Answered' } : item))
    setSelectedRequest(updatedRequest)
  }

  const createPageRequest = (question: string, relatedTransaction: string, relatedAmount: string) => {
    const request: ClientRequest = { id: `request-${Date.now()}`, client: 'ABC Plumbing', dateCreated: 'September 7, 2026', relatedTransaction, relatedAmount, question, status: 'Waiting for Client' }
    setRequests((currentRequests) => [...currentRequests, request])
    setInbox((currentInbox) => [...currentInbox, { id: `inbox-${request.id}`, client: request.client, type: 'Client Question', description: `${relatedTransaction} needs an answer`, priority: 'High', date: 'Today', status: 'Open', destination: 'Client Requests', requestId: request.id }])
  }

  const updateInvoice = (invoice: Invoice) => { setInvoices((currentInvoices) => currentInvoices.map((item) => item.id === invoice.id ? invoice : item)); setSelectedInvoice(invoice) }
  const updateBill = (bill: Bill) => { setBills((currentBills) => currentBills.map((item) => item.id === bill.id ? bill : item)); setSelectedBill(bill) }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><span className="brand-dot" /> LedgerOps</div>
        <p className="workspace-label">BOOKKEEPING WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          {navigationItems.map((item) => {
            const isActive = item.label === view
            const isAvailable = item.label === 'Dashboard' || item.label === 'Clients' || item.label === 'Inbox' || item.label === 'Transactions' || item.label === 'Reconcile' || item.label === 'Receivables' || item.label === 'Payables' || item.label === 'Month End' || item.label === 'Client Requests'
            return (
              <button
                className={`nav-item ${isActive ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                key={item.label}
                onClick={() => isAvailable && (item.label === 'Inbox' ? openInbox() : item.label === 'Transactions' ? openTransactions() : item.label === 'Reconcile' ? openReconcile() : item.label === 'Receivables' ? openReceivables() : item.label === 'Payables' ? openPayables() : item.label === 'Month End' ? openMonthEnd() : item.label === 'Client Requests' ? openRequests() : setView(item.label as View))}
                disabled={!isAvailable}
                title={isAvailable ? item.label : 'Coming in the next build'}
              >
                <span className="nav-icon">{item.icon}</span>{item.label}
                {!isAvailable && <span className="soon">Soon</span>}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">JR</div>
          <div><strong>Jordan Reed</strong><span>Bookkeeper</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Monday, September 7, 2026</p>
            <h1>{view === 'Dashboard' ? (selectedClient ? selectedClient.name : 'Good morning, Jordan') : view}</h1>
          </div>
          <button className="help-button" aria-label="Get help">?</button>
        </header>

        {view === 'Dashboard' ? <Dashboard client={selectedClient} onBack={() => setSelectedClient(null)} onOpen={openClient} onViewClients={() => setView('Clients')} onTransactions={openTransactions} onReconcile={openReconcile} onMonthEnd={openMonthEnd} onReceivables={openReceivables} onPayables={openPayables} /> : view === 'Clients' ? <Clients onOpen={openClient} /> : view === 'Inbox' ? <Inbox items={inbox} onOpenRequest={(requestId) => { const request = requests.find((item) => item.id === requestId); if (request) { setSelectedRequest(request); openRequests() } }} onNavigate={(destination) => destination === 'Transactions' ? openTransactions() : destination === 'Reconcile' ? openReconcile() : destination === 'Receivables' ? openReceivables() : destination === 'Payables' ? openPayables() : destination === 'Month End' ? openMonthEnd() : openRequests()} /> : view === 'Transactions' ? <Transactions transactions={transactions} selectedTransaction={selectedTransaction} onSelect={setSelectedTransaction} onBack={() => setSelectedTransaction(null)} onUpdate={updateTransaction} onRequestInformation={createRequest} /> : view === 'Reconcile' ? <Reconcile selectedAccount={selectedReconciliation} onSelect={setSelectedReconciliation} onBack={() => setSelectedReconciliation(null)} /> : view === 'Receivables' ? <Receivables invoices={invoices} selectedInvoice={selectedInvoice} onSelect={setSelectedInvoice} onBack={() => setSelectedInvoice(null)} onUpdate={updateInvoice} onAskClient={createPageRequest} /> : view === 'Payables' ? <Payables bills={bills} selectedBill={selectedBill} onSelect={setSelectedBill} onBack={() => setSelectedBill(null)} onUpdate={updateBill} onAskClient={createPageRequest} /> : view === 'Month End' ? <MonthEnd checklist={monthEndChecklist} completed={monthEndCompleted} onUpdate={updateMonthEndItem} onComplete={() => setMonthEndCompleted(true)} onNavigate={(destination) => destination === 'Transactions' ? openTransactions() : openReconcile()} /> : <ClientRequests requests={requests} selectedRequest={selectedRequest} onSelect={setSelectedRequest} onBack={() => setSelectedRequest(null)} onUpdate={updateRequest} />}
      </main>
    </div>
  )
}

function Dashboard({ client, onBack, onOpen, onViewClients, onTransactions, onReconcile, onMonthEnd, onReceivables, onPayables }: { client: Client | null; onBack: () => void; onOpen: (client: Client) => void; onViewClients: () => void; onTransactions: () => void; onReconcile: () => void; onMonthEnd: () => void; onReceivables: () => void; onPayables: () => void }) {
  if (client) return <ClientDashboard client={client} onBack={onBack} onTransactions={onTransactions} onReconcile={onReconcile} onMonthEnd={onMonthEnd} onReceivables={onReceivables} onPayables={onPayables} />

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div><h2>Here is what needs your attention.</h2><p className="muted">Work through these items to keep your clients on track.</p></div>
        <button className="primary-button" onClick={onTransactions}>Review transactions <span>→</span></button>
      </section>
      <section className="metrics-grid" aria-label="Bookkeeping overview">
        <MetricCard label="Clients" value="5" note="All clients" tone="green" />
        <MetricCard label="Items needing attention" value="22" note="Across all clients" tone="red" />
        <MetricCard label="Transactions to review" value="14" note="ABC Plumbing" tone="amber" />
        <MetricCard label="Reconciliations" value="1" note="Ready to complete" tone="blue" />
        <MetricCard label="Client questions" value="1" note="Waiting for answer" tone="purple" />
        <MetricCard label="Month end" value="90%" note="ABC Plumbing" tone="green" />
      </section>
      <section className="content-grid">
        <div className="panel work-panel"><div className="panel-heading"><div><h2>Today's work</h2><p className="muted">Start with the most important items.</p></div><span className="count-pill">4 items</span></div><div className="work-list">{todaysWork.map((item) => <WorkRow item={item} key={item.title} />)}</div></div>
        <div className="panel client-summary"><div className="panel-heading"><div><h2>Your clients</h2><p className="muted">A quick look at their books.</p></div></div><button className="client-card" onClick={() => onOpen(demoClient)}><div className="company-avatar">{demoClient.initials}</div><div className="client-info"><strong>{demoClient.name}</strong><span>{demoClient.month}</span></div><span className="status-dot amber-dot" /> <span className="arrow">→</span></button><button className="text-button" onClick={onViewClients}>View all clients <span>→</span></button></div>
      </section>
    </div>
  )
}

function Clients({ onOpen }: { onOpen: (client: Client) => void }) {
  return <div className="page-content"><section className="welcome-row"><div><h2>Clients</h2><p className="muted">Keep every company moving forward.</p></div><button className="primary-button" disabled>Add client <span>+</span></button></section><div className="client-card-grid">{clients.map((client) => <button className="full-client-card" key={client.id} onClick={() => onOpen(client)}><div className="full-client-header"><span className="company-avatar">{client.initials}</span><span className="client-card-title"><strong>{client.name}</strong><span>{client.month}</span></span><span className={`status-badge ${client.status === 'On track' ? 'success' : 'warning'}`}>{client.status}</span></div><div className="client-card-details"><span><small>Items needing attention</small><strong className={client.attention ? 'attention-number' : 'success-text'}>{client.attention}</strong></span><span><small>Reconciliation</small><strong>{client.reconciliation}</strong></span></div><div className="client-card-progress"><span><small>Month-end progress</small><strong>{client.monthEnd}%</strong></span><span className="progress-bar"><span style={{ width: `${client.monthEnd}%` }} /></span><span className="row-arrow">→</span></div></button>)}</div></div>
}

const inboxFilters = ['All', 'Transactions', 'Receipts', 'Client Questions', 'Reconciliation', 'Bills', 'Month End'] as const

function Inbox({ items, onOpenRequest, onNavigate }: { items: InboxItem[]; onOpenRequest: (requestId: string) => void; onNavigate: (destination: InboxItem['destination']) => void }) {
  const [filter, setFilter] = useState<(typeof inboxFilters)[number]>('All')
  const activeItems = items.filter((item) => item.status !== 'Resolved')
  const filteredItems = filter === 'All' ? activeItems : activeItems.filter((item) => matchesInboxFilter(item, filter))
  const openItem = (item: InboxItem) => item.requestId ? onOpenRequest(item.requestId) : onNavigate(item.destination)
  const clientQuestionCount = activeItems.filter((item) => item.type === 'Client Question').length
  const receiptCount = activeItems.some((item) => item.type === 'Missing Receipt') ? 2 : 0
  const billCount = activeItems.some((item) => item.type === 'Bill') ? 2 : 0

  return <div className="page-content"><section className="welcome-row"><div><h2>Bookkeeping Inbox</h2><p className="muted">Everything that needs your attention, in one place.</p></div><span className="attention-summary"><strong>{activeItems.length}</strong> items need attention</span></section><div className="inbox-summary-grid"><SummaryCard value="14" label="Transactions need review" tone="red" /><SummaryCard value={`${receiptCount}`} label="Missing receipts" tone="amber" /><SummaryCard value={`${clientQuestionCount}`} label="Client question" tone="purple" /><SummaryCard value="1" label="Reconciliation issue" tone="blue" /><SummaryCard value={`${billCount}`} label="Bills need review" tone="red" /></div><div className="filter-row" aria-label="Inbox filters">{inboxFilters.map((filterOption) => <button className={`filter-button ${filter === filterOption ? 'active' : ''}`} key={filterOption} onClick={() => setFilter(filterOption)}>{filterOption}<span>{filterOption === 'All' ? activeItems.length : activeItems.filter((item) => matchesInboxFilter(item, filterOption)).length}</span></button>)}</div>{filteredItems.length === 0 ? <div className="empty-state"><span>✓</span><h2>You're all caught up.</h2><p className="muted">There is nothing waiting for your attention.</p></div> : <div className="panel inbox-panel"><div className="inbox-heading"><span>Client</span><span>Type</span><span>Description</span><span>Priority</span><span>Date</span><span>Status</span><span /></div>{filteredItems.map((item) => <button className="inbox-row" key={item.id} onClick={() => openItem(item)}><strong>{item.client}</strong><span className="inbox-type">{item.type}</span><span>{item.description}</span><span className={`priority-badge ${item.priority.toLowerCase()}`}>{item.priority}</span><span>{item.date}</span><span className={`inbox-status ${item.status.toLowerCase()}`}>{item.status}</span><span className="row-arrow">→</span></button>)}</div>}</div>
}

function matchesInboxFilter(item: InboxItem, filter: (typeof inboxFilters)[number]) {
  const types: Record<string, InboxItem['type']> = { Transactions: 'Transaction', Receipts: 'Missing Receipt', 'Client Questions': 'Client Question', Reconciliation: 'Reconciliation', Bills: 'Bill', 'Month End': 'Month End' }
  return item.type === types[filter]
}

function SummaryCard({ value, label, tone }: { value: string; label: string; tone: string }) {
  return <div className={`summary-card ${tone}`}><strong>{value}</strong><span>{label}</span></div>
}

function ClientRequests({ requests, selectedRequest, onSelect, onBack, onUpdate }: { requests: ClientRequest[]; selectedRequest: ClientRequest | null; onSelect: (request: ClientRequest) => void; onBack: () => void; onUpdate: (request: ClientRequest) => void }) {
  if (selectedRequest) return <ClientRequestDetail request={selectedRequest} onBack={onBack} onUpdate={onUpdate} />
  const activeRequests = requests.filter((request) => request.status !== 'Resolved')
  return <div className="page-content"><section className="welcome-row"><div><h2>Client Requests</h2><p className="muted">Questions waiting for ABC Plumbing's answers.</p></div><span className="attention-summary"><strong>{activeRequests.length}</strong> active requests</span></section>{activeRequests.length === 0 ? <div className="empty-state"><span>✓</span><h2>You're all caught up.</h2><p className="muted">All client questions have been resolved.</p></div> : <div className="request-card-grid">{activeRequests.map((request) => <button className="request-card" key={request.id} onClick={() => onSelect(request)}><div className="request-card-top"><span className="company-avatar">AB</span><span><strong>{request.client}</strong><small>Created {request.dateCreated}</small></span><span className={`inbox-status ${request.status.toLowerCase().replaceAll(' ', '-')}`}>{request.status}</span></div><div className="request-card-related"><strong>{request.relatedTransaction}</strong><span>{request.relatedAmount}</span></div><p>{request.question}</p><span className="row-arrow">→</span></button>)}</div>}</div>
}

function ClientRequestDetail({ request, onBack, onUpdate }: { request: ClientRequest; onBack: () => void; onUpdate: (request: ClientRequest) => void }) {
  const answers = ['Materials', 'Equipment', 'Office', 'Personal', 'Other']
  return <div className="page-content"><button className="back-button" onClick={onBack}>← All requests</button><section className="review-header"><div><p className="eyebrow">CLIENT REQUEST · ABC PLUMBING</p><h2>{request.relatedTransaction}</h2><p className="muted">Created {request.dateCreated} · {request.relatedAmount}</p></div><span className={`inbox-status ${request.status.toLowerCase().replaceAll(' ', '-')}`}>{request.status}</span></section><section className="request-detail-layout"><div className="panel request-question"><h2>Question for the client</h2><p className="request-question-text">{request.question}</p><p className="muted">{request.client}</p>{request.answer ? <div className="answer-box"><small>Client answer</small><strong>{request.answer}</strong></div> : <div className="answer-options"><p className="muted">Simulate a client answer:</p>{answers.map((answer) => <button className="category-button" key={answer} onClick={() => onUpdate({ ...request, status: 'Answered', answer })}>{answer}<span>→</span></button>)}</div>}</div><div className="panel request-details"><h2>Request details</h2><div className="detail-list"><span><small>Client</small><strong>{request.client}</strong></span><span><small>Date created</small><strong>{request.dateCreated}</strong></span><span><small>Related transaction</small><strong>{request.relatedTransaction || 'None'}</strong></span><span><small>Status</small><strong>{request.status}</strong></span></div>{request.status === 'Answered' && <button className="primary-button resolve-button" onClick={() => onUpdate({ ...request, status: 'Resolved' })}>Mark Resolved <span>✓</span></button>}{request.status === 'Resolved' && <div className="resolved-note">✓ This request is resolved.</div>}</div></section></div>
}

const invoiceFilters = ['All', 'Open', 'Overdue', 'Paid'] as const
const billFilters = ['All', 'Open', 'Due Soon', 'Overdue', 'Needs Review', 'Paid'] as const

function Receivables({ invoices, selectedInvoice, onSelect, onBack, onUpdate, onAskClient }: { invoices: Invoice[]; selectedInvoice: Invoice | null; onSelect: (invoice: Invoice) => void; onBack: () => void; onUpdate: (invoice: Invoice) => void; onAskClient: (question: string, transaction: string, amount: string) => void }) {
  const [filter, setFilter] = useState<(typeof invoiceFilters)[number]>('All')
  if (selectedInvoice) return <InvoiceDetail invoice={selectedInvoice} onBack={onBack} onUpdate={onUpdate} onAskClient={onAskClient} />
  const outstanding = invoices.reduce((total, invoice) => total + invoice.amount - invoice.amountPaid, 0)
  const filtered = filter === 'All' ? invoices : invoices.filter((invoice) => invoice.status === filter)
  return <div className="page-content"><section className="welcome-row"><div><h2>Accounts Receivable</h2><p className="muted">ABC Plumbing · Money customers owe you.</p></div><span className="count-pill">{invoices.length} invoices</span></section><div className="finance-summary-grid"><SummaryCard value={formatMoney(outstanding)} label="Total Outstanding" tone="red" /><SummaryCard value={formatMoney(4780)} label="Current" tone="green" /><SummaryCard value={formatMoney(2840)} label="1-30 Days Overdue" tone="amber" /><SummaryCard value={formatMoney(0)} label="31-60 Days Overdue" tone="blue" /><SummaryCard value={formatMoney(0)} label="60+ Days Overdue" tone="purple" /></div><div className="filter-row">{invoiceFilters.map((option) => <button className={`filter-button ${filter === option ? 'active' : ''}`} key={option} onClick={() => setFilter(option)}>{option}<span>{option === 'All' ? invoices.length : invoices.filter((invoice) => invoice.status === option).length}</span></button>)}</div><div className="panel finance-list-panel"><div className="finance-list-heading"><span>Customer</span><span>Invoice</span><span>Invoice date</span><span>Due date</span><span>Original</span><span>Remaining</span><span>Status</span><span /></div>{filtered.map((invoice) => <button className="finance-list-row" key={invoice.id} onClick={() => onSelect(invoice)}><strong>{invoice.customer}</strong><span>{invoice.number}</span><span>{invoice.invoiceDate}</span><span>{invoice.dueDate}</span><span>{formatMoney(invoice.amount)}</span><strong>{formatMoney(invoice.amount - invoice.amountPaid)}</strong><span className={`inbox-status ${invoice.status.toLowerCase().replaceAll(' ', '-')}`}>{invoice.status}</span><span className="row-arrow">→</span></button>)}</div></div>
}

function InvoiceDetail({ invoice, onBack, onUpdate, onAskClient }: { invoice: Invoice; onBack: () => void; onUpdate: (invoice: Invoice) => void; onAskClient: (question: string, transaction: string, amount: string) => void }) {
  const remaining = invoice.amount - invoice.amountPaid
  const markPayment = () => onUpdate({ ...invoice, amountPaid: invoice.amount, status: 'Paid' })
  return <div className="page-content"><button className="back-button" onClick={onBack}>← All invoices</button><section className="review-header"><div><p className="eyebrow">ACCOUNTS RECEIVABLE · ABC PLUMBING</p><h2>{invoice.customer}</h2><p className="muted">{invoice.number} · Due {invoice.dueDate}</p></div><span className={`inbox-status ${invoice.status.toLowerCase().replaceAll(' ', '-')}`}>{invoice.status}</span></section><section className="finance-detail-layout"><div className="panel"><h2>Invoice details</h2><div className="detail-list"><span><small>Customer</small><strong>{invoice.customer}</strong></span><span><small>Invoice number</small><strong>{invoice.number}</strong></span><span><small>Invoice date</small><strong>{invoice.invoiceDate}</strong></span><span><small>Due date</small><strong>{invoice.dueDate}</strong></span><span><small>Amount</small><strong>{formatMoney(invoice.amount)}</strong></span><span><small>Amount paid</small><strong>{formatMoney(invoice.amountPaid)}</strong></span><span><small>Amount remaining</small><strong>{formatMoney(remaining)}</strong></span><span><small>Status</small><strong>{invoice.status}</strong></span></div></div><div className="panel finance-actions"><h2>Payment history</h2><p className="muted">{invoice.amountPaid > 0 ? `Payment received: ${formatMoney(invoice.amountPaid)}` : 'No payments recorded yet.'}</p><button className="primary-button" disabled={remaining === 0} onClick={markPayment}>Mark Payment Received <span>✓</span></button><button className="secondary-button" onClick={() => onAskClient('When can we expect payment for this invoice?', invoice.number, formatMoney(remaining))}>Ask Client About Invoice <span>→</span></button></div></section></div>
}

function Payables({ bills, selectedBill, onSelect, onBack, onUpdate, onAskClient }: { bills: Bill[]; selectedBill: Bill | null; onSelect: (bill: Bill) => void; onBack: () => void; onUpdate: (bill: Bill) => void; onAskClient: (question: string, transaction: string, amount: string) => void }) {
  const [filter, setFilter] = useState<(typeof billFilters)[number]>('All')
  if (selectedBill) return <BillDetail bill={selectedBill} onBack={onBack} onUpdate={onUpdate} onAskClient={onAskClient} />
  const outstanding = bills.reduce((total, bill) => total + bill.amount - bill.amountPaid, 0)
  const filtered = filter === 'All' ? bills : bills.filter((bill) => bill.status === filter)
  return <div className="page-content"><section className="welcome-row"><div><h2>Accounts Payable</h2><p className="muted">ABC Plumbing · Bills your company needs to pay.</p></div><span className="count-pill">{bills.length} bills</span></section><div className="finance-summary-grid"><SummaryCard value={formatMoney(outstanding)} label="Total Bills Due" tone="red" /><SummaryCard value={formatMoney(986.44)} label="Due This Week" tone="amber" /><SummaryCard value={formatMoney(286)} label="Overdue" tone="purple" /><SummaryCard value={formatMoney(210)} label="Paid This Month" tone="green" /></div><div className="filter-row">{billFilters.map((option) => <button className={`filter-button ${filter === option ? 'active' : ''}`} key={option} onClick={() => setFilter(option)}>{option}<span>{option === 'All' ? bills.length : bills.filter((bill) => bill.status === option).length}</span></button>)}</div><div className="panel finance-list-panel"><div className="finance-list-heading"><span>Vendor</span><span>Bill</span><span>Bill date</span><span>Due date</span><span>Amount</span><span>Remaining</span><span>Status</span><span /></div>{filtered.map((bill) => <button className="finance-list-row" key={bill.id} onClick={() => onSelect(bill)}><strong>{bill.vendor}</strong><span>{bill.number}</span><span>{bill.billDate}</span><span>{bill.dueDate}</span><span>{formatMoney(bill.amount)}</span><strong>{formatMoney(bill.amount - bill.amountPaid)}</strong><span className={`inbox-status ${bill.status.toLowerCase().replaceAll(' ', '-')}`}>{bill.status}</span><span className="row-arrow">→</span></button>)}</div></div>
}

function BillDetail({ bill, onBack, onUpdate, onAskClient }: { bill: Bill; onBack: () => void; onUpdate: (bill: Bill) => void; onAskClient: (question: string, transaction: string, amount: string) => void }) {
  const remaining = bill.amount - bill.amountPaid
  return <div className="page-content"><button className="back-button" onClick={onBack}>← All bills</button><section className="review-header"><div><p className="eyebrow">ACCOUNTS PAYABLE · ABC PLUMBING</p><h2>{bill.vendor}</h2><p className="muted">{bill.number} · Due {bill.dueDate}</p></div><span className={`inbox-status ${bill.status.toLowerCase().replaceAll(' ', '-')}`}>{bill.status}</span></section><section className="finance-detail-layout"><div className="panel"><h2>Bill details</h2><div className="detail-list"><span><small>Vendor</small><strong>{bill.vendor}</strong></span><span><small>Bill number</small><strong>{bill.number}</strong></span><span><small>Bill date</small><strong>{bill.billDate}</strong></span><span><small>Due date</small><strong>{bill.dueDate}</strong></span><span><small>Amount</small><strong>{formatMoney(bill.amount)}</strong></span><span><small>Amount paid</small><strong>{formatMoney(bill.amountPaid)}</strong></span><span><small>Amount remaining</small><strong>{formatMoney(remaining)}</strong></span><span><small>Category</small><strong>{bill.category}</strong></span><span><small>Status</small><strong>{bill.status}</strong></span></div></div><div className="panel finance-actions"><h2>Bill actions</h2><p className="muted">Update this fake bill as you work through it.</p><button className="primary-button" disabled={remaining === 0} onClick={() => onUpdate({ ...bill, amountPaid: bill.amount, status: 'Paid' })}>Mark Bill Paid <span>✓</span></button><button className="secondary-button" onClick={() => onAskClient('Can you clarify this bill?', bill.number, formatMoney(remaining))}>Ask Client <span>→</span></button></div></section></div>
}

const transactionFilters = ['All', 'Needs Review', 'Categorized', 'Matched', 'Needs Receipt'] as const

function Transactions({ transactions, selectedTransaction, onSelect, onBack, onUpdate, onRequestInformation }: { transactions: Transaction[]; selectedTransaction: Transaction | null; onSelect: (transaction: Transaction) => void; onBack: () => void; onUpdate: (transaction: Transaction) => void; onRequestInformation: (transaction: Transaction) => void }) {
  const [filter, setFilter] = useState<(typeof transactionFilters)[number]>('All')

  if (selectedTransaction) return <TransactionReview transaction={selectedTransaction} onBack={onBack} onUpdate={onUpdate} onRequestInformation={onRequestInformation} />

  const filteredTransactions = filter === 'All' ? transactions : transactions.filter((transaction) => transaction.status === filter)
  const attentionCount = transactions.filter((transaction) => transaction.status === 'Needs Review' || transaction.status === 'Needs Receipt').length

  return <div className="page-content"><section className="welcome-row"><div><h2>Transactions</h2><p className="muted">Review ABC Plumbing's recent activity one item at a time.</p></div><span className="attention-summary"><strong>{attentionCount}</strong> need attention</span></section><div className="filter-row" aria-label="Transaction filters">{transactionFilters.map((filterOption) => <button className={`filter-button ${filter === filterOption ? 'active' : ''}`} key={filterOption} onClick={() => setFilter(filterOption)}>{filterOption}<span>{filterOption === 'All' ? transactions.length : transactions.filter((transaction) => transaction.status === filterOption).length}</span></button>)}</div><div className="panel transaction-panel"><div className="transaction-heading"><span>Date</span><span>Payee</span><span>Description</span><span>Amount</span><span>Category</span><span>Status</span><span /></div>{filteredTransactions.map((transaction) => <button className="transaction-row" key={transaction.id} onClick={() => onSelect(transaction)}><span>{transaction.date}</span><strong>{transaction.payee}</strong><span>{transaction.description}</span><strong>{transaction.amount}</strong><span>{transaction.category}</span><span className={`transaction-status ${statusClass(transaction.status)}`}>{transaction.status}</span><span className="row-arrow">→</span></button>)}</div></div>
}

function TransactionReview({ transaction, onBack, onUpdate, onRequestInformation }: { transaction: Transaction; onBack: () => void; onUpdate: (transaction: Transaction) => void; onRequestInformation: (transaction: Transaction) => void }) {
  const categories = ['Office Supplies', 'Materials', 'Equipment', 'Utilities', 'Meals', 'Travel', 'Personal / Ask Client', 'Other']
  const chooseCategory = (category: string) => onUpdate({ ...transaction, category, status: 'Categorized' })
  const requestInformation = () => onRequestInformation(transaction)

  return <div className="page-content"><button className="back-button" onClick={onBack}>← All transactions</button><section className="review-header"><div><p className="eyebrow">TRANSACTION REVIEW</p><h2>{transaction.payee}</h2><p className="muted">{transaction.date} · {transaction.amount}</p></div><span className={`transaction-status ${statusClass(transaction.status)}`}>{transaction.status}</span></section><section className="review-layout"><div className="panel review-details"><h2>Transaction details</h2><div className="detail-list"><span><small>Payee</small><strong>{transaction.payee}</strong></span><span><small>Date</small><strong>{transaction.date}</strong></span><span><small>Amount</small><strong>{transaction.amount}</strong></span><span><small>Description</small><strong>{transaction.description}</strong></span><span><small>Current category</small><strong>{transaction.category}</strong></span><span><small>Status</small><strong>{transaction.status}</strong></span></div></div><div className="panel review-choice"><h2>What was this purchase for?</h2><p className="muted">Choose a category to clean up this transaction.</p><div className="category-grid">{categories.map((category) => <button className={`category-button ${transaction.category === category ? 'selected' : ''}`} key={category} onClick={() => chooseCategory(category)}>{category}{transaction.category === category && <span>✓</span>}</button>)}</div>{transaction.suggestedCategory && transaction.status === 'Needs Review' && <div className="suggestion-box"><div><small>Suggested category</small><strong>{transaction.suggestedCategory}</strong><span>{transaction.confidence}% confidence</span></div><button className="primary-button" onClick={() => chooseCategory(transaction.suggestedCategory!)}>Accept suggestion <span>✓</span></button></div>}<button className="secondary-button" onClick={requestInformation}>Request More Information <span>→</span></button></div></section></div>
}

function statusClass(status: Transaction['status']) {
  return status.toLowerCase().replaceAll(' ', '-')
}

function MonthEnd({ checklist, completed, onUpdate, onComplete, onNavigate }: { checklist: MonthEndItem[]; completed: boolean; onUpdate: (item: MonthEndItem) => void; onComplete: () => void; onNavigate: (destination: 'Transactions' | 'Reconcile') => void }) {
  const completedCount = checklist.filter((item) => item.status === 'Complete').length
  const progress = Math.round((completedCount / checklist.length) * 100)
  const attentionCount = checklist.filter((item) => item.status !== 'Complete').length
  const [selectedItemId, setSelectedItemIdState] = useState<string | null>(null)
  const selectedItem = checklist.find((item) => item.id === selectedItemId)
  const setSelectedItemId = (nextId: string | null) => {
    if (selectedItemId && nextId === null) {
      const item = checklist.find((checklistItem) => checklistItem.id === selectedItemId)
      if (item && item.status !== 'Complete') onUpdate({ ...item, status: 'Complete' })
    }
    setSelectedItemIdState(nextId)
  }

  return <div className="page-content"><section className="month-end-hero"><div><p className="eyebrow">ABC PLUMBING · AUGUST 2026</p><h2>Month End</h2><p className="muted">Finish the monthly checklist and get the books ready.</p></div><div className="month-progress-summary"><span>Month-End Progress</span><strong>{completed ? '100%' : `${progress}%`} Complete</strong><div className="large-progress"><span style={{ width: `${completed ? 100 : progress}%` }} /></div></div></section>{completed ? <div className="ready-banner"><div><h2>August books are ready</h2><p className="muted">ABC Plumbing's August 2026 month end is complete.</p></div><span>✓</span></div> : <div className="month-attention-summary"><strong>{attentionCount}</strong> {attentionCount === 1 ? 'item needs' : 'items need'} attention</div>}<section className="panel month-checklist"><div className="panel-heading"><div><h2>Month-end checklist</h2><p className="muted">Click an item to see its current status.</p></div><span className="count-pill">{completedCount} of {checklist.length} complete</span></div><div className="month-items">{checklist.map((item) => <button className={`month-item ${item.status.toLowerCase().replaceAll(' ', '-')}`} key={item.id} onClick={() => setSelectedItemId(selectedItemId === item.id ? null : item.id)}><span className={`month-check ${item.status === 'Complete' ? 'checked' : ''}`}>{item.status === 'Complete' ? '✓' : item.status === 'Needs Attention' ? '!' : ''}</span><span className="month-item-label"><strong>{item.label}</strong>{selectedItemId === item.id && item.explanation && <span className="month-explanation">{item.explanation}</span>}</span><span className={`month-status ${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span><span className="row-arrow">{selectedItemId === item.id ? '⌃' : '→'}</span></button>)}</div>{selectedItem?.explanation && selectedItem.relatedView && <div className="month-related-action"><div><strong>{selectedItem.explanation}</strong><span>Take care of this item in the related section.</span></div><button className="secondary-button" onClick={() => onNavigate(selectedItem.relatedView!)}>{selectedItem.relatedLabel} <span>→</span></button></div>}</section><button className="primary-button complete-month-button" disabled={progress !== 100 || completed} onClick={onComplete}>{completed ? 'Month End Complete' : 'Complete Month End'} <span>{completed ? '✓' : '→'}</span></button></div>
}

function Reconcile({ selectedAccount, onSelect, onBack }: { selectedAccount: ReconciliationAccount | null; onSelect: (account: ReconciliationAccount) => void; onBack: () => void }) {
  if (selectedAccount) return <ReconciliationWorkspace account={selectedAccount} onBack={onBack} onUpdate={onSelect} />

  return <div className="page-content"><section className="welcome-row"><div><h2>Reconcile</h2><p className="muted">Make sure each account matches its statement.</p></div><span className="count-pill">ABC Plumbing</span></section><div className="reconciliation-account-grid">{reconciliationAccounts.map((account) => <button className="reconciliation-account-card" key={account.id} onClick={() => onSelect(account)}><div className="account-card-header"><span className="account-icon">$</span><span><strong>{account.name}</strong><small>Last reconciled {account.lastReconciled}</small></span><span className="row-arrow">→</span></div><div className="account-card-details"><span><small>Statement ending</small><strong>{account.statementEnding}</strong></span><span><small>QuickBooks balance</small><strong>{formatMoney(account.quickBooksBalance)}</strong></span><span><small>Statement balance</small><strong>{formatMoney(account.statementBalance)}</strong></span></div><div className="account-card-footer"><span className={`transaction-status ${account.status === 'Ready to complete' ? 'matched' : 'needs-review'}`}>{account.status}</span><span className={account.quickBooksBalance === account.statementBalance ? 'success-text' : 'attention-number'}>Difference {formatMoney(account.statementBalance - account.quickBooksBalance)}</span></div></button>)}</div></div>
}

function ReconciliationWorkspace({ account, onBack, onUpdate }: { account: ReconciliationAccount; onBack: () => void; onUpdate: (account: ReconciliationAccount) => void }) {
  const [completed, setCompleted] = useState(false)
  const toggleTransaction = (transactionId: string) => onUpdate({ ...account, transactions: account.transactions.map((transaction) => transaction.id === transactionId ? { ...transaction, cleared: !transaction.cleared } : transaction) })
  const clearedBalance = account.transactions.reduce((balance, transaction) => transaction.cleared ? balance + (transaction.type === 'Deposit' ? transaction.amount : -transaction.amount) : balance, 0)
  const totalTransactionChange = account.transactions.reduce((balance, transaction) => balance + (transaction.type === 'Deposit' ? transaction.amount : -transaction.amount), 0)
  const isBalanced = Math.abs(account.statementBalance - (account.quickBooksBalance - totalTransactionChange + clearedBalance)) < 0.005
  const beginningBalance = account.quickBooksBalance - totalTransactionChange
  const displayedClearedBalance = beginningBalance + clearedBalance
  const actualDifference = account.statementBalance - displayedClearedBalance
  const likelyProblems = account.possibleProblems || ['No likely problems found.']

  return <div className="page-content"><button className="back-button" onClick={onBack}>← All accounts</button><section className="reconcile-header"><div><p className="eyebrow">ABC PLUMBING · RECONCILIATION</p><h2>{account.name.toUpperCase()}</h2><p className="muted">Statement ending {account.statementEnding}</p></div><span className={`reconcile-status ${isBalanced ? 'ready' : 'problem'}`}>{isBalanced ? 'Ready to Complete' : "Something doesn't match."}</span></section><section className="reconcile-summary"><BalanceItem label="Beginning balance" value={formatMoney(beginningBalance)} /><BalanceItem label="Statement ending balance" value={formatMoney(account.statementBalance)} /><BalanceItem label="Cleared balance" value={formatMoney(displayedClearedBalance)} /><BalanceItem label="Difference" value={formatMoney(actualDifference)} tone={isBalanced ? 'good' : 'bad'} /></section>{!isBalanced && <div className="problem-panel"><div><h2>Something doesn't match.</h2><p className="muted">Check these common causes:</p><ul>{['Missing transaction', 'Duplicate transaction', 'Wrong transaction amount', 'Transaction not cleared'].map((cause) => <li key={cause}>{cause}</li>)}</ul></div><button className="secondary-button problem-button" onClick={() => document.getElementById('likely-problems')?.scrollIntoView({ behavior: 'smooth' })}>Find the Problem <span>→</span></button></div>}<section className="panel reconciliation-workspace"><div className="panel-heading"><div><h2>Transactions included</h2><p className="muted">Check each transaction that cleared the bank.</p></div><span className="count-pill">{account.transactions.filter((transaction) => transaction.cleared).length} cleared</span></div><div className="reconcile-transaction-heading"><span>Cleared</span><span>Date</span><span>Payee</span><span>Amount</span><span>Type</span></div>{account.transactions.map((transaction) => <button className="reconcile-transaction-row" key={transaction.id} onClick={() => toggleTransaction(transaction.id)}><span className={`clear-check ${transaction.cleared ? 'checked' : ''}`}>{transaction.cleared ? '✓' : ''}</span><span>{transaction.date}</span><strong>{transaction.payee}</strong><span>{formatMoney(transaction.amount)}</span><span className={transaction.type === 'Deposit' ? 'success-text' : ''}>{transaction.type}</span></button>)}</section>{!isBalanced && <div className="likely-problems" id="likely-problems"><h2>Likely problem transactions</h2>{likelyProblems.map((problem) => <p key={problem}>! {problem}</p>)}</div>}<button className="primary-button complete-button" disabled={!isBalanced || completed} onClick={() => setCompleted(true)}>{completed ? 'Reconciliation Complete' : 'Complete Reconciliation'} <span>{completed ? '✓' : '→'}</span></button></div>
}

function BalanceItem({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return <div className={`balance-item ${tone || ''}`}><small>{label}</small><strong>{value}</strong></div>
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function ClientDashboard({ client, onBack, onTransactions, onReconcile, onMonthEnd, onReceivables, onPayables }: { client: Client; onBack: () => void; onTransactions: () => void; onReconcile: () => void; onMonthEnd: () => void; onReceivables: () => void; onPayables: () => void }) {
  return <div className="page-content"><button className="back-button" onClick={onBack}>← All clients</button><section className="client-hero"><div><span className="status-badge warning">Needs attention</span><h2>{client.name}</h2><p className="muted">Books for {client.month}</p></div><button className="primary-button" onClick={onTransactions}>Review transactions <span>→</span></button></section><section className="metrics-grid finance-grid"><MetricCard label="Income" value={client.income} note="This month" tone="green" /><MetricCard label="Expenses" value={client.expenses} note="This month" tone="amber" /><MetricCard label="Profit" value={client.profit} note="This month" tone="blue" /><MetricCard label="Bank balance" value={client.bankBalance} note="As of today" tone="purple" /><MetricCard label="Accounts receivable" value={client.accountsReceivable} note="To collect" tone="green" /><MetricCard label="Accounts payable" value={client.accountsPayable} note="To pay" tone="red" /></section><section className="content-grid"><div className="panel"><div className="panel-heading"><div><h2>Bookkeeping status</h2><p className="muted">A short list of what is left to do.</p></div></div><div className="status-list"><StatusRow label="Transactions needing review" value="14" tone="red" /><StatusRow label="Uncategorized transactions" value="3" tone="amber" /><StatusRow label="Reconciliation" value="Ready" tone="green" /><StatusRow label="Missing receipts" value="1" tone="amber" /><StatusRow label="Client questions" value="1 waiting" tone="purple" /><StatusRow label="Month-end progress" value={`${client.monthEnd}%`} tone="blue" /></div></div><div className="panel action-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p className="muted">Choose the next thing to work on.</p></div></div><div className="action-grid"><button onClick={onTransactions}>Review transactions <span>→</span></button><button onClick={onReconcile}>Reconcile accounts <span>→</span></button><button onClick={onPayables}>Review bills <span>→</span></button><button onClick={onReceivables}>Review invoices <span>→</span></button><button onClick={onMonthEnd}>Month end <span>→</span></button><button>Reports <span>→</span></button></div></div></section></div>
}

function MetricCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) { return <div className={`metric-card ${tone}`}><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note}</span></div> }
function WorkRow({ item }: { item: typeof todaysWork[number] }) { return <button className="work-row"><span className={`work-icon ${item.tone}`}>{item.tone === 'red' ? '!' : item.tone === 'amber' ? '◷' : '✓'}</span><span className="work-copy"><strong>{item.title}</strong><span>{item.client} · {item.detail}</span></span><span className="row-arrow">→</span></button> }
function StatusRow({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="status-row"><span className={`status-check ${tone}`}>{tone === 'green' ? '✓' : '!'}</span><span>{label}</span><strong className={tone}>{value}</strong><span className="row-arrow">→</span></div> }

export default App
