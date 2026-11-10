# Phase 12, Step 1: Storage Audit and PostgreSQL Plan

Status: Step 1 audit with implementation and verification updates through Step 5.
Audit date: 2026-11-04, against commit `d61039a` (branch `main`).

> **Step 2 update (same day):** the storage stores are now covered by a shared memory/PostgreSQL test suite. It found and fixed a real defect in all six PostgreSQL stores' update statements. See [section H](#h-step-2-storage-verification-results). Where sections A to G say PostgreSQL behaviour is unverified, that describes the state **before** Step 2; section H is the current state.
>
> **Step 4 update (2026-11-09):** versioned migrations were added for the six stores. Section A is the original Step 1 inventory; section I records the current migration architecture, adoption checks and test results. PostgreSQL was tested only against a disposable local database.
>
> **Step 5 update (2026-11-09):** Bookkeeping Review decisions now use an authenticated server API and append-only PostgreSQL storage in migration 002. Section A row 14 and section J describe the current design, transition handling, tests and authorization limitations. Step 5A PostgreSQL verification remains blocked (section J.4); Step 5B Playwright stabilization and verification are recorded in section J.6.

How to read this document:

- **Verified** means I read the code that does it (file named). It does not mean it was run against a live database.
- **Assumed** means inferred or not checkable from the repository.
- PostgreSQL store durability was tested against disposable local databases for earlier steps. No production database or Render setup has been accessed; Step 5 PostgreSQL integration coverage still needs to run against the test database or CI service.

---

## A. Current storage inventory

### A.1 Summary table

Legend: Refresh = survives a browser page refresh; Restart = survives a server restart; Device = visible from another browser or device; Scoped = records carry a client id; Server-validated = the server checks the write; Versioned = optimistic concurrency.

"Restart (no DB)" assumes `DATABASE_URL` is unset, which is the case in the developer's local `.env` (variable names inspected; no values read). "Restart (with DB)" is what the code is written to do and is **not verified by a test**.

| # | Data | Stored where | Refresh | Restart (no DB) | Restart (with DB) | Device | Scoped | Server-validated | Versioned | Code |
|---|------|--------------|---------|-----------------|-------------------|--------|--------|------------------|-----------|------|
| 1 | Demo company books (ledger, invoices, bills, statements, base transactions) | Source code fixtures, generated at build and load time | Yes | Yes | Yes | Yes (same build) | Yes | n/a | n/a | `shared/demoBooks.ts`, `shared/demoCompanyBooks.ts`, `src/services/demoDataService.ts`, `src/services/demoCompanyData.ts` |
| 2 | Manual demo transactions ("entries") | Server store: memory, or Postgres `demo_entries` (JSONB) | Yes | **No** | Yes (unverified) | Yes | Yes (`client_id`) | Yes: period-closed check, known-company check, account checks | Yes (`version`) | `server/demoEntries.ts`, `server/demoEntryStore.ts`, `src/services/demoEntryService.ts` |
| 3 | Demo journal entries | Memory or `demo_journals` | Yes | **No** | Yes (unverified) | Yes | Yes | Yes (balanced entries, closed-period check) | Yes | `server/demoJournals.ts`, `server/demoJournalStore.ts`, `src/services/demoJournalService.ts` |
| 4 | Customer and vendor payment records | Memory or `demo_payment_books` | Yes | **No** | Yes (unverified) | Yes | Yes | Yes (closed-period check, reversal rules) | Yes | `server/demoPayments.ts`, `server/demoPaymentStore.ts`, `src/services/demoPaymentService.ts` |
| 5 | Workpapers (demo) | Memory or `demo_workpapers` | Yes | **No** | Yes (unverified) | Yes | Yes | Yes | Yes | `server/demoWorkpapers.ts`, `server/demoWorkpaperStore.ts`, `src/services/demoWorkpaperService.ts` |
| 6 | Reconciliations (demo and QuickBooks source) | Memory or `reconciliation_records` (statement lines, matches and transactions inside JSONB) | Yes | **No**, but seed records are re-created at startup | Yes (unverified) | Yes | Yes (`source` + `client_id` + account + period) | Yes: completion re-computed on the server; QuickBooks completion re-reads QuickBooks | Yes | `server/reconciliations.ts`, `server/reconciliationStore.ts`, `server/reconciliationData.ts`, `shared/reconciliation.ts` |
| 7 | Month End sign-offs, closing and reopening history | Memory or `month_end_records` | Yes | **No**, seed records re-created | Yes (unverified) | Yes | Yes (`source` + `client_id` + period) | Yes: close re-validates checklist; closed months reject changes | Yes | `server/monthEnd.ts`, `server/monthEndStore.ts`, `shared/monthEnd.ts` |
| 8 | Demo seed scenario records | Re-inserted at every server start if missing, never overwritten | n/a | Yes (regenerated) | Yes | Yes | Yes | n/a | n/a | `server/demoSeed.ts`, `shared/demoMonthEnd.ts` |
| 9 | Demo reset | Server deletes the chosen clients' rows in all six stores, then re-seeds; Postgres variant uses a transaction (`BEGIN`/`COMMIT`/`ROLLBACK`) | n/a | n/a | n/a | n/a | Yes (validated client ids, no duplicates) | Yes | n/a | `server/demoReset.ts`, `src/services/demoResetService.ts` |
| 10 | Client requests (Client Requests tab) and their messages | **Browser memory only** (React `useState`) | **No** | No | No | No | Field `clientId` exists but nothing enforces it | **No server route exists** | No | `src/App.tsx` (`requests`, `setRequests`) |
| 11 | Document metadata (Recent Documents) | Browser memory only | **No** | No | No | No | Field only | No server route | No | `src/App.tsx` (`documents`) |
| 12 | Client portal audit events ("Demo Activity History") | Browser memory only, capped at 200 | **No** | No | No | No | Field only | No | No | `src/App.tsx` (`portalAudit`) |
| 13 | Demo transaction edits (categorization, splits, status), and "All clients" edits | Browser memory only (`transactions`, `companyEdits`) | **No** | No | No | No | Keyed by `clientId/transactionId` | No server route for demo categorization (no such service in `src/services`) | No | `src/App.tsx` |
| 14 | Bookkeeping Review decisions (reviewing, dismissed, reopened, with fingerprint and reason) | Server memory without `DATABASE_URL`, or append-only PostgreSQL `review_decisions` (migration 002). Existing browser key is retained only for explicit export; it is not read as authority or written by the app. | Yes | No without DB | Yes when migration 002 is applied | Yes when DB is shared | Source and client IDs; API permits only known demo IDs or the one Sandbox ID | Yes for shape, source, known client and required fields; no per-client permissions or independent proof that a browser finding matches current books | Yes, per-finding append version and stale-write rejection | `server/reviewDecisions.ts`, `server/reviewDecisionStore.ts`, `src/services/reviewDecisionService.ts`, `src/services/reviewFindings.ts` |
| 15 | Automation rules | Browser `localStorage`, key `ledgerops-automation-rules-v1` | Yes | Yes (browser side) | Yes (browser side) | **No** | `clientId` per rule | No | No | `src/services/automationStore.ts` |
| 16 | Automation audit events | `localStorage`, key `ledgerops-automation-audit-v1` | Yes | Yes (browser side) | Yes (browser side) | **No** | `clientId` per event | No | No | `src/services/automationStore.ts` |
| 17 | Recurring-reminder decisions | `localStorage`, key `ledgerops-recurring-decisions-v1` | Yes | Yes (browser side) | Yes (browser side) | **No** | `clientId` | No | No | `src/services/automationStore.ts` |
| 18 | Audit Log (Settings, transaction-update attempts) | Browser memory only | **No** | No | No | No | Partially | No | No | `src/App.tsx` (`auditLog`) |
| 19 | Selected client, period, view, filters | Browser memory only | No | n/a | n/a | No | n/a | n/a | n/a | `src/App.tsx` |
| 20 | Cross-tab reset signal | `localStorage` key `ledgerops-demo-reset` (list of client ids) | n/a | n/a | n/a | No | Yes | n/a | n/a | `src/App.tsx` |
| 21 | Sign-in sessions | Postgres `user_sessions` (created by `connect-pg-simple`), or in-memory store when `DATABASE_URL` is unset | Yes (cookie) | **No** without DB | Yes (unverified) | n/a | n/a | Yes | n/a | `server/sessionStore.ts`, `server/app.ts` |
| 22 | OIDC login transaction (PKCE state), QuickBooks OAuth `state` | Inside the session | n/a | follows session | follows session | n/a | n/a | Yes (single use, TTL) | n/a | `server/app.ts` |
| 23 | **QuickBooks access and refresh tokens** | **One module-level variable in server memory** (`let tokens`), shared by the whole server process | n/a | **No, always lost** (even with a DB) | **No** | n/a | **No: one global connection, not per user** | Yes (Sandbox-only enforced) | n/a | `server/quickbooks.ts` |
| 24 | QuickBooks company data | Not stored by LedgerOps; fetched live from the Sandbox each time | re-fetched | re-fetched | re-fetched | re-fetched | one Sandbox company | Read-only except guarded line-category update | SyncToken | `server/quickbooks.ts`, `src/services/quickBooksService.ts` |
| 25 | Users, roles, permissions | No table. Access = email in `AUTH_ALLOWED_EMAILS` env var; user identity copied into the session | n/a | n/a | n/a | n/a | **No per-client permissions** | n/a | n/a | `server/config.ts`, `server/app.ts` |
| 26 | Secrets and configuration | `.env` (ignored by Git) or Render environment | n/a | n/a | n/a | n/a | n/a | n/a | n/a | `server/config.ts`, `.env.example` |

### A.2 Verified facts behind the table

1. **Six server stores already have a Postgres implementation**, each behind an interface with a memory twin (`Memory*Store` / `Postgres*Store`). `server/index.ts` picks Postgres only when `DATABASE_URL` is set. Each store creates its own table lazily with `CREATE TABLE IF NOT EXISTS`. Verified in `server/index.ts` and the `server/*Store.ts` files.
2. **Tables are one-row-per-record with a `data jsonb` blob**, plus a few indexed columns (`id`, `client_id`, `version`, `status`, timestamps). Optimistic concurrency is `UPDATE ... WHERE id = $1 AND version = $n`, and inserts use `ON CONFLICT DO NOTHING` (for example `demoEntryStore.ts`). Verified by reading.
3. **No automated test runs any `Postgres*Store`.** A search of `server/*.test.ts` found no reference to a Postgres store class. The only `DATABASE_URL` matches in tests are configuration checks and the string "Temporary local development records" shown to the user. All route tests and Playwright runs use the memory stores. **Durability against a real database is therefore unverified.**
4. **At the time of this original Step 1 audit**, no migration system existed: schema was created on first use inside each store, and `demoReset.ts` repeated table creation. This was replaced in Phase 12 Step 4; see section I.
5. **The frontend never writes bookkeeping data to the server for requests, documents, portal audit, demo transaction edits, or the Audit Log.** These live in `useState` in `src/App.tsx`. A page refresh resets them (the app re-seeds them from fixtures). This matches the Phase 10 and 11 finding that the Demo Activity History and Audit Log are temporary.
6. **Automation rules and their audit events use `localStorage`** and survive only in the same browser. Clearing site data deletes them. Review decisions previously used a browser key; Step 5 replaced it as the authority with authenticated server storage (section J). The old browser value is retained only for explicit untrusted export and is not imported.
7. **QuickBooks tokens are held only in process memory** (`let tokens` in `server/quickbooks.ts`) and are global to the process: whoever is signed in sees the same QuickBooks connection. They are lost on every restart and redeploy, so a user must reconnect. They are never written to Postgres, the session, or disk. This is safer than plaintext storage but not multi-user safe.
8. **Authentication.** Real sessions require OIDC sign-in and an allow-listed email. Session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, idle 8 hours, absolute 12 hours (`server/config.ts`, `server/app.ts`). All demo routes use `requireDemoAuth` + `requireCsrf`. QuickBooks routes use `requireAuth` + `requireCsrf` and are never reachable with the development bypass.
9. **Server-side actor stamping.** History entries use `request.session.user.email`, falling back to `'unknown'` (verified in `server/*.ts`). Under the local bypass the actor is therefore `unknown`.
10. **Closed-period protection is server-enforced** for entries, journals and payments (`PERIOD_CLOSED`, HTTP 409) and for Month End changes (`CLOSED`). Verified in `server/demoEntries.ts`, `demoJournals.ts`, `demoPayments.ts`, `monthEnd.ts`.
11. **Client id validation is uneven.** Entries accept only the five known demo companies (`demoEntries.ts`). Reset validates against the known set (`demoReset.ts`). Reconciliation lookup only checks that `clientId` matches `/^[\w-]{1,60}$/`, so it accepts any well-formed id for `source=demo` (`reconciliations.ts`). Whether that can create a record for an unknown client was not tested.

### A.3 Assumptions (not verified)

- The Render production database exists and `DATABASE_URL` is set there. Nothing in the repository proves it, and I did not connect to any database.
- JSONB documents written by the current stores are small enough that row size is not a concern. Not measured.
- `connect-pg-simple` creates `user_sessions` correctly on the Render Postgres version in use.
- Production traffic is one firm with a handful of users. Nothing in the code states this.

---

## B. Data-loss and security risks

Ranked. Severity is my judgment, not a scored model.

### Data-loss risks

| ID | Risk | Evidence | Severity |
|----|------|----------|----------|
| R1 | **Postgres persistence has never been tested.** Schemas, concurrency updates and reset transactions run only against memory fakes in tests. A typo in SQL would only appear in production. | No test references a `Postgres*Store` | High |
| R2 | **Client requests, documents, portal audit, demo transaction edits and the Audit Log are lost on every refresh.** Bookkeepers can lose categorizations and client communications they believe are saved. | `useState` only in `src/App.tsx` | High (for any real use) |
| R3 | **Automation rules and automation audit remain only in one browser's `localStorage`.** Review decisions have been moved to the server; old browser decisions are not automatically imported and must be exported and reviewed explicitly. | `automationStore.ts`, section J | High |
| R4 | **Without `DATABASE_URL` all server-side records vanish on restart**, including manual entries, payments, journals, reconciliations and month-end sign-offs. The UI labels this as temporary (verified in Phase 10), but the failure mode is easy to hit locally. | `MemoryXStore` classes, `server/index.ts` | Medium (disclosed) |
| R5 | **No migrations or schema versioning.** Any later column change needs ad hoc SQL against production. | Lazy `CREATE TABLE IF NOT EXISTS` per store | Medium |
| R6 | **No backup or restore procedure is documented or tested.** Assumed to rely on whatever Render offers. | No such document found | Medium |
| R7 | **Derived state is rebuilt in the browser from several stores** (ledger = fixtures + entries + journals + payments). A partially failed save can show a state the server did not accept until refresh. Phase 11 added fetching all five companies' records on All Clients. | `src/App.tsx` | Medium |
| R8 | **JSONB-only records have no relational integrity.** Nothing prevents a payment referencing a missing invoice, or a reconciliation referencing a missing account, beyond application code. | Store schemas | Medium |
| R9 | **Reset deletes by client id across six tables.** Postgres reset is transactional, but the memory reset snapshots and restores (verified in `demoReset.ts`). A real-database failure path is untested. | `demoReset.ts` | Medium |

### Security risks (reported only; none changed)

| ID | Risk | Evidence | Severity |
|----|------|----------|----------|
| S1 | **Business data in the browser.** Review decisions, rules and their descriptions persist in plaintext `localStorage`, readable by any script on the origin and by anyone using the same browser profile. Current data is fictional demo data; real client data would need this moved. | `localStorage` keys above | High if real data is ever used |
| S2 | **Demo endpoints are authenticated but not authorized per client.** Any allow-listed user can read and write every company's records, and `clientId` comes from the request. There are no roles. | `server/app.ts`, `config.ts` | Medium now, High before multiple staff or real clients |
| S3 | **Local bypass exposes all demo routes unauthenticated on 127.0.0.1.** Guarded by an explicit opt-in, `NODE_ENV=development`, loopback-only checks and refusal on Render/CI markers (`server/config.ts`, `server/app.ts`). Covered by earlier bypass tests; not re-run for this audit. Risk is operator error on a shared machine. | `devBypassRefusal` | Low to Medium |
| S4 | **QuickBooks tokens are global and in memory.** One shared connection for all signed-in users; no per-user or per-firm separation. If persisted later, they must be encrypted at rest. Refresh-token handling beyond expiry is not implemented (expired access token ends the connection until reconnect). | `server/quickbooks.ts` | Medium |
| S5 | **Audit history is mutable.** History lives as an array inside each JSON record. Anyone with database access, or any code path that rewrites the record, can alter it. No hash chaining, no append-only table. | `monthEnd.ts`, `reconciliations.ts` | Medium |
| S6 | **Audit coverage is incomplete.** Server audit exists only inside records (entries, payments, reconciliations, month end). Sign-in, QuickBooks connection, reset, and review decisions have no server-side durable audit. The browser Audit Log is not an audit trail. | A.1 rows 14, 18 | Medium |
| S7 | **Session store table is auto-created by the library** with whatever privileges `DATABASE_URL` has. The app uses one connection string for sessions, bookkeeping data and DDL, so it needs full schema rights. | `server/sessionStore.ts`, stores | Medium |
| S8 | **Several `pg.Pool` instances.** Each store creates its own pool from the same URL, so connection count scales with the number of stores. Risk of exhausting a small Render plan. | Each `Postgres*Store` constructor | Low to Medium |
| S9 | **Request body limits and rate limiting.** `express.json()` is used with default limits and no rate limiter was found. Not tested. | `server/app.ts` | Low to Medium |
| S10 | **Cross-origin configuration was not reviewed in detail.** `server/app.ts` uses CORS; the allowed origins and the GitHub Pages deployment were not verified in this audit. Cookies rely on SameSite and CSRF tokens. | `server/app.ts` | Unknown |
| S11 | **Inconsistent client-id validation** between routes (A.2 item 11). | A.2 | Low to Medium |

---

## C. Recommended PostgreSQL structure

Design goals: keep the existing ledger rules and server validation exactly as they are, move browser-only data to the server, give every row an owner, and make history append-only.

### C.1 Principles

1. **PostgreSQL is the system of record for LedgerOps-created data.** QuickBooks data stays in QuickBooks and is never copied into demo tables.
2. **Every business row carries `firm_id`, `client_id` and `data_source`** (`demo` or `quickbooks`). Unique keys and foreign keys include them, so a demo record can never collide with a QuickBooks record.
3. **Keep the existing records as JSONB while the shared TypeScript rules stay the source of truth**, but promote the fields used for filtering, joins and integrity to real columns. Do not re-implement ledger math in SQL.
4. **Optimistic concurrency stays** (`version` column, compare-and-set), now enforced uniformly by one shared repository helper.
5. **History is append-only** in its own table. Records keep a summary; the table is the evidence.
6. **One migration tool, one place for schema.** Stores stop creating their own tables.

### C.2 Proposed tables

Names are suggestions. Existing table names are kept where they exist so Phase 1 can adopt them in place.

**Identity and access**

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `firms` | The bookkeeping firm (tenant). | `id`, `name`, `created_at` |
| `users` | People who sign in. Replaces the email allow-list over time. | `id`, `firm_id`, `oidc_subject` (unique), `email`, `display_name`, `status`, `created_at` |
| `roles` / `user_roles` | Owner, Bookkeeper, Reviewer, Read-only. | `user_id`, `role` |
| `clients` | Each client company. Demo companies get `data_source = 'demo'`. | `id`, `firm_id`, `name`, `data_source`, `status` |
| `client_access` | Which users may see which clients. This is the real isolation control. | `user_id`, `client_id`, `permission` (`read`/`write`/`approve`) |
| `user_sessions` | Unchanged (managed by `connect-pg-simple`). | existing |

**Accounting records** (existing tables, extended)

| Table | Holds | Notes |
|-------|-------|-------|
| `demo_entries` | Manual transactions | Add `firm_id`; keep `version`, `status`, `data jsonb`. |
| `demo_journals` | Journal entries (draft/posted/reversed) | Add a check that posted entries balance, computed from `data`, as a database-level guard in addition to the shared TypeScript rule. |
| `demo_payment_books` | Payments per invoice or bill | Add `document_id`, `kind` columns so payments can be joined to documents. |
| `demo_workpapers` | Workpapers | As is. |
| `transaction_edits` (new) | Categorization, split and status changes for demo transactions, keyed by `client_id` + base transaction id. | Replaces browser-only `companyEdits`. Includes `version`, `edited_by`, `edited_at`. |
| `ledger_postings` (optional, later) | Debit and credit lines normalized from entries, journals and payments. | Only if reporting performance or integrity checks require it; the TypeScript ledger remains authoritative until then. |

**Reconciliations and Month End** (existing tables)

| Table | Notes |
|-------|-------|
| `reconciliation_records` | Keep `source`, `client_id`, `account_id`, `period_end`, `status`, `version`. Add a unique index on (`source`, `client_id`, `account_id`, `period_end`). |
| `month_end_records` | Keep `source`, `client_id`, `period`, `status`, `version`. Add a unique index on (`source`, `client_id`, `period`). |
| `reconciliation_events`, `month_end_events` (new) | Append-only history (completed, reopened, signed off, closed, reopened with reason). Written in the same transaction as the record update. |

**Client communications**

| Table | Notes |
|-------|-------|
| `client_requests` | `id`, `client_id`, `type`, `status`, `due_date`, `related_record_id`, `amount_cents`, `version`, `created_by`. |
| `request_messages` | Append-only conversation, with `author_role` (bookkeeper or simulated client). |
| `documents` | **Metadata only**: name, type, size, `request_id`, status. No file bytes and no upload endpoint in this phase. A later phase that stores real files needs its own security design (virus scanning, size limits, private object storage). |

**Review and automation**

| Table | Notes |
|-------|-------|
| `review_decisions` | Append-only. `client_id`, `data_source`, `finding_id`, `finding_type`, `status`, `reason`, `fingerprint`, `actor_id`, `decided_at`. The latest row per finding is current. Replaces the 500-item `localStorage` list. |
| `automation_rules` | `client_id`, name, conditions and action (JSONB), priority, enabled, `version`. |
| `recurring_decisions` | Per client, append-only. |

**Audit**

| Table | Notes |
|-------|-------|
| `audit_events` | One append-only table for every important action: `id`, `firm_id`, `client_id`, `data_source`, `actor_id`, `action`, `entity_type`, `entity_id`, `before` / `after` summaries, `reason`, `at`, `prev_hash`, `hash`. |

Audit integrity: the application role gets `INSERT` and `SELECT` only on `audit_events` (no `UPDATE` or `DELETE`), and each row stores a SHA-256 hash over its content and the previous row's hash per client, so tampering is detectable. A nightly job verifies the chain.

**QuickBooks connection** (only if reconnect-after-restart becomes a requirement)

| Table | Notes |
|-------|-------|
| `quickbooks_connections` | `firm_id`, `realm_id`, `environment` (`sandbox` only), encrypted `refresh_token` (AES-GCM with a key held outside the database, in the host's secret store), `connected_by`, `connected_at`, `expires_at`. Never returned to the browser. Do not build this until the OAuth lifecycle and encryption key management are agreed. Phase 1 to 4 below do not touch it. |

### C.3 Isolation

- Every repository method takes a `firm_id` and `client_id`, and every query includes both. No query is allowed to take a client id from the request body without first checking `client_access`.
- Add PostgreSQL row-level security (`firm_id = current_setting('app.firm_id')`) as a second line of defense once users and firms exist.
- Demo and QuickBooks rows are separated by `data_source` and by separate `clients` rows. Constraints prevent a demo client from holding `quickbooks` data.

### C.4 Concurrency

- Keep `version` on every mutable record. A write is `UPDATE ... WHERE id = $1 AND version = $2`, returning zero rows on conflict, which surfaces as the existing `CONFLICT` response.
- Wrap "update record + append event" in one transaction.
- Close and reopen of a month take a row lock on the `month_end_records` row (`SELECT ... FOR UPDATE`) so a payment and a close cannot race. Today the closed-month check and the write are separate steps, and I did not test that race.

### C.5 Backup and recovery

- Use the host's automated daily backups plus point-in-time recovery if the plan allows (assumed available on Render paid tiers; confirm).
- Add a documented restore drill: restore to a scratch database, run the integrity checks in section F, compare row counts and audit hash chain.
- Take a logical dump (`pg_dump`) before every migration that changes existing data.
- Define targets before real use: for example RPO 24 hours and RTO 4 hours (open question).

---

## D. Step-by-step implementation phases

Each phase is small, independently shippable, and leaves Demo Mode working. Existing in-memory stores remain the default until a phase's tests pass.

**Phase 0: Prove what already exists (recommended first step)**
1. Add a Postgres test harness that starts a throwaway PostgreSQL (Docker or a local test database; skipped automatically when none is configured).
2. Run the existing six stores' contract tests against both the memory and the Postgres implementation: create, read, update with correct and stale version, list by client, delete clients, and demo reset including a forced mid-reset failure.
3. Fix any defects found. No schema redesign yet.

**Phase 1: Migrations and shared plumbing**
1. Introduce one migration runner (for example `node-pg-migrate` or plain numbered SQL files plus a `schema_migrations` table).
2. Move the existing `CREATE TABLE` statements into migration `001`, byte-for-byte equivalent.
3. Replace per-store lazy DDL with a startup check that the schema version matches. Fail closed with a clear message.
4. Share one `pg.Pool` across stores and sessions.

**Phase 2: Move browser-only review and automation data to the server**
1. Add `review_decisions`, `automation_rules`, `automation_events`, `recurring_decisions` tables with `/api` routes behind `requireDemoAuth` and `requireCsrf`, validated with the same TypeScript types.
2. The frontend reads from the server, writes through it, and on first load offers a one-time import of existing `localStorage` data (kept in place until the import is confirmed).
3. Keep the `localStorage` code path as a read-only fallback for one release.

**Phase 3: Persist client requests, document metadata and demo transaction edits**
1. Tables `client_requests`, `request_messages`, `documents` (metadata only), `transaction_edits`.
2. Server-side validation of status transitions (for example completed requests cannot become overdue, receipts cannot be matched twice) copied from the existing shared logic.
3. Keep "demo metadata, not a real file" labeling.

**Phase 4: Append-only audit and history tables**
1. Add `audit_events` with hash chaining and restricted database privileges.
2. Dual-write: existing in-record `history` arrays stay; new events are also written to the table.
3. Add the verification job, then switch the UI history views to the table.

**Phase 5: Users, client access and roles**
1. Add `firms`, `users`, `clients`, `client_access`. Populate from `AUTH_ALLOWED_EMAILS` on first sign-in. Allow-list still works as a fallback.
2. Enforce `client_access` in every repository call. Add row-level security.
3. Do not change the OIDC flow itself.

**Phase 6: Hardening**
1. Least-privilege database roles (migration role, app role, audit-insert-only).
2. Body-size limits and rate limiting on mutating routes.
3. Backup and restore drill.

**Phase 7: QuickBooks connection persistence (only if required)**
1. Encrypted token storage per firm, Sandbox only, with disconnect and key rotation.
2. Separate security review before starting.

---

## E. Migration and rollback strategy

### E.1 Principles

- **One data type at a time.** Never swap two storage systems in the same release.
- **Feature flag per store** (for example `LEDGEROPS_STORE_<NAME>=memory|postgres`). The default stays `memory` outside production until that store's Postgres tests pass.
- **Expand, then migrate, then contract.** Add new tables and columns first; write to both; switch reads; remove old paths only in a later release.
- **Demo data is fictional and regenerable.** Seed records are rebuilt from code (`demoSeed.ts`), so the demo tables can always be reset to a known-good state with the existing reset feature.
- **QuickBooks data is never imported into demo tables**, and no QuickBooks migration is part of Phases 0 to 4.

### E.2 Per-phase procedure

1. Take a `pg_dump` of the target database.
2. Apply the migration in a scratch database restored from that dump. Run the integrity checks (section F).
3. Apply to production during a quiet period.
4. Turn on dual-write, compare reads for a defined period, then turn on read-from-database.
5. After one stable release, remove the old path.

### E.3 Rollback

| Situation | Action |
|-----------|--------|
| Bad migration, no new data written yet | Run the paired `down` migration, redeploy the previous build. |
| Bad migration after new data was written | Restore the pre-migration dump to a scratch database, copy only the new rows back with a script, then roll back. Never run `down` migrations that drop columns holding new data without a copy. |
| Application bug | Set the store's feature flag back to the previous source. Because the old path is kept for one release (dual-write), reads continue to work. |
| Browser data import (Phase 2) | The original `localStorage` entries are left in place until the user confirms the import, so import can be repeated or abandoned. |

### E.4 What is not safe to roll back

Deleting `localStorage` after import, dropping old columns, and removing `history` arrays from records are one-way steps. Do each in its own release, after backups, and only once the server data has been verified.

---

## F. Tests required before professional use

### F.1 Persistence (database-backed, none exist today)

1. **Store contract suite** run against memory and Postgres for all six existing stores: create, read, versioned update, stale-version rejection, list scoped by client, delete by client.
2. **Restart test**: write records, restart the server process, read them back (the missing proof of R1 and R4).
3. **Reset test**: reset one client and all clients; verify other clients' rows, sessions and the QuickBooks source are untouched; force a failure mid-reset and verify nothing changed.
4. **Migration tests**: apply all migrations to an empty database and to a copy of a populated one; apply `down` and `up` again.
5. **Concurrency tests**: two simultaneous updates to the same version (exactly one succeeds); payment versus month-end close race; double submission of the same payment.

### F.2 Accounting invariants against stored data

- Debits equal credits for every posted entry and journal after a round trip through the database.
- Trial balance and Balance Sheet balance after a restart.
- AR and AP aging agree with the ledger after a restart.
- Closed periods still reject entries, journals, payments and reconciliation changes after a restart.
- Month End cannot close with unresolved blockers when data is loaded from the database.

### F.3 Isolation and security

- A signed-in user without `client_access` to a client gets 403 on every route for that client, for reads and writes.
- Demo and QuickBooks rows never appear in each other's lists (database-level test, not only UI).
- Unknown client ids are rejected on every route (closes S11).
- The development bypass is refused when `NODE_ENV`, `FRONTEND_URL` or deployment markers disagree (the existing test stays and is run in CI).
- CSRF is enforced on every new route.
- No response, log or page contains `DATABASE_URL`, tokens or session secrets.
- Audit table: update and delete attempts by the application role fail; the hash chain verifies; a tampered row is detected.
- Browser storage: after Phase 2, no business records remain in `localStorage` other than the one-time import marker.

### F.4 Browser (Playwright, multi-tab workflows)

- Create a request, a review dismissal, a rule and a categorization; reload; confirm they persist; switch to a second browser context and confirm they appear there.
- Reset demo data; confirm the server and the browser agree.
- Failed save (server error) shows an error and does not show the record as saved.
- Stale data: open the same record in two contexts, save in one, confirm the other receives the conflict message.

### F.5 Operational

- Backup restore drill passes and is timed.
- Startup fails closed when the schema version is wrong or the database is unreachable in production.
- Connection-pool limit test with all stores sharing one pool.

---

## G. Open questions and assumptions

### Open questions

1. **Is a production `DATABASE_URL` set on Render today, and on which plan?** This decides how much backup and point-in-time recovery exists. I could not verify it from the repository.
2. **How many users and clients are expected** (one firm with a few staff, or several firms)? This decides whether `firms` and row-level security are needed now or can wait.
3. **Which roles are needed?** For example Owner, Bookkeeper, Reviewer, Read-only, and whether a real client login is ever planned. The current simulated client view must not become a public endpoint.
4. **Should demo data and real client data ever share a database?** I recommend separate databases or at least separate firms, and no real customer data until Phase 5 is complete.
5. **What retention rules apply** to audit events and closed-period records (for example seven years)?
6. **Recovery targets** (RPO and RTO) acceptable to the firm.
7. **Should QuickBooks tokens survive restarts?** If yes, who holds the encryption key, and is a Sandbox-only connection enough to justify the work?
8. **Real document uploads**: planned or not? Metadata-only storage is recommended until a separate design exists.
9. **Is `unknown` an acceptable actor** under the local bypass, or should the bypass stamp a clear `dev-bypass` actor so bypass-created records are identifiable?

### Assumptions made in this document

- The user base today is one developer using fictional demo data.
- The existing `Postgres*Store` implementations are intended to be used in production but have not been validated.
- Render is the host, as stated in `docs/AUTHENTICATION.md`.
- Existing shared TypeScript accounting rules remain the single source of truth; SQL constraints are an additional guard, not a replacement.
- No credentials, tokens, connection strings or `.env` values were read for this audit; only environment variable names in `.env` and `.env.example` were inspected.

### Not examined

- The Render service configuration and any database that may exist there.
- Behavior of `connect-pg-simple` against a live database.
- Load, performance and row-size limits.
- The GitHub Pages build's runtime behavior.

---

## H. Step 2: storage verification results

Date: 2026-11-04. Scope: verification only. No migration, schema change or behaviour change other than the defect fix described in H.4.

### H.1 Stores covered

| # | Store (interface) | Memory class | PostgreSQL class | Table |
|---|-------------------|--------------|------------------|-------|
| 1 | `DemoEntryStore` | `MemoryDemoEntryStore` | `PostgresDemoEntryStore` | `demo_entries` |
| 2 | `DemoJournalStore` | `MemoryDemoJournalStore` | `PostgresDemoJournalStore` | `demo_journals` |
| 3 | `DemoPaymentStore` | `MemoryDemoPaymentStore` | `PostgresDemoPaymentStore` | `demo_payment_books` |
| 4 | `DemoWorkpaperStore` | `MemoryDemoWorkpaperStore` | `PostgresDemoWorkpaperStore` | `demo_workpapers` |
| 5 | `ReconciliationStore` | `MemoryReconciliationStore` | `PostgresReconciliationStore` | `reconciliation_records` |
| 6 | `MonthEndStore` | `MemoryMonthEndStore` | `PostgresMonthEndStore` | `month_end_records` |
| + | `DemoResetRepository` | `MemoryDemoResetRepository` | `PostgresDemoResetRepository` | all six above |

Not covered: the session store (`connect-pg-simple`, a third-party library) and QuickBooks tokens (memory only, not a store).

### H.2 Tests implemented

- [`server/storageContract.test.ts`](../server/storageContract.test.ts): one contract suite run against every backend that is available. Memory always runs; PostgreSQL runs only against a verified disposable test database.
- [`server/testDatabase.ts`](../server/testDatabase.ts): test-only safety guard and schema isolation (never imported by application code).
- [`server/testDatabase.test.ts`](../server/testDatabase.test.ts): tests for the guard itself (always runs).

Behaviours checked for each client-scoped store (entries, journals, payments, workpapers): create and read, unknown id returns null, returned objects cannot alter stored data, duplicate create is rejected and keeps the original, update with the matching version, stale and impossible versions rejected, simultaneous creates and updates (exactly one wins), client isolation in `list`, deletion of only the requested clients, simulated restart, and a failed write.

Additional checks for the source-scoped stores (reconciliations, Month End): demo and QuickBooks records never mix, demo deletion leaves QuickBooks records alone.

Demo reset (memory and PostgreSQL): reset one company and leave the others and QuickBooks untouched, reset all five and repeat, forced-failure rollback (a QuickBooks record that already uses a seed id makes the seed insert fail; the demo data must be unchanged afterward), and reset persistence across a restart.

### H.3 Safety rules for the PostgreSQL tests

PostgreSQL tests run only when `LEDGEROPS_TEST_DATABASE_URL` is set **and** it passes the guard. The guard refuses, with a reason that never contains the URL or credentials:

- an unset or invalid URL, or a non-`postgres://` URL;
- any host other than `localhost`, `127.0.0.1` or `::1` (so Render and every hosted database are refused);
- a database name that does not contain `test` as its own word (for example `ledgerops_test`), and the names `postgres`, `template0`, `template1`;
- a URL that sets `options` or `schema` itself;
- a URL that points at the same host, port and database as `DATABASE_URL`.

Isolation: each test creates its own schema named `ledgerops_test_<12 hex characters>` and connects with `search_path` set to that schema only, so the stores' `CREATE TABLE IF NOT EXISTS` statements create their tables inside it. After the test, only that schema is dropped (`DROP SCHEMA ... CASCADE`, guarded by a name pattern check). No database is dropped, no table is truncated, and tables in other schemas are never touched. A dedicated test compares row counts of any same-named tables in other schemas before and after the run.

To run them locally, start a throwaway PostgreSQL on this machine, create an empty database named for testing, and set the variable only for that command, for example in PowerShell:

```powershell
$env:LEDGEROPS_TEST_DATABASE_URL = '<postgres URL for a local database named ledgerops_test>'
$env:LEDGEROPS_REQUIRE_POSTGRES = 'true'
node --import tsx server/postgresRequired.check.ts
npx.cmd vitest run server/storageContract.test.ts
Remove-Item Env:LEDGEROPS_TEST_DATABASE_URL
Remove-Item Env:LEDGEROPS_REQUIRE_POSTGRES
```

Do not put either variable in `.env` or commit it. The preflight exits nonzero if the URL is missing or unsafe. `LEDGEROPS_REQUIRE_POSTGRES=true` selects only the PostgreSQL backend; it prevents the contract suite from silently falling back to Memory when the database URL is absent.

### H.4 Results

| Run | Result |
|-----|--------|
| Memory contract tests (default `npm test`) | Pass. 52 tests in the two new files pass. 8 are skipped by design (7 durability-only tests that apply to PostgreSQL, and the PostgreSQL isolation group). |
| PostgreSQL contract tests in the normal development environment | **Skipped**: `LEDGEROPS_TEST_DATABASE_URL is not set.` No PostgreSQL server is installed on this machine, and none was assumed. |
| PostgreSQL contract tests against a disposable real PostgreSQL | **Pass, 99 tests passed, 7 skipped (memory-only)**. I ran them once against a temporary local PostgreSQL 18 (an npm-packaged embedded build) started in a temp folder outside the repository, with a random password and the database `ledgerops_test`. It was stopped and deleted afterward. This is a one-off verification, not something the repository sets up for you. |
| Full unit suite | 957 passed, 8 skipped (905 before this step plus the new tests). |
| Playwright, 4 workers | 239 passed. |
| `tsc -b` | Exit 0. |
| Production build (`npm run build`) | Exit 0 (the usual chunk-size warning only). |

The PostgreSQL run covered all six stores plus reset, and confirmed that the six tables were created only inside the throwaway schema.

### H.5 Defect found and fixed

**Every update of an existing record failed on real PostgreSQL.** All six PostgreSQL stores built their `UPDATE` statements with a parameter list that skipped some placeholders (for example `$2` and `$5`). PostgreSQL rejects this with `could not determine data type of parameter $2`, so any write with `expectedVersion > 0` threw instead of saving. Inserts, reads, lists and deletes were unaffected, which is why the memory tests never showed it. In practice, with `DATABASE_URL` set, anything that edits an existing record would have returned an error: for example completing a reconciliation, signing off Month End, recording a second payment against an invoice or bill, reversing a journal, or editing a workpaper.

Fix: the `UPDATE` placeholders were renumbered so each statement uses a contiguous set of parameters. Version checking (`WHERE id = $1 AND version = $n`) is unchanged, and no table, column or in-memory behaviour changed. Files: `demoEntryStore.ts`, `demoJournalStore.ts`, `demoPaymentStore.ts`, `demoWorkpaperStore.ts`, `monthEndStore.ts`, `reconciliationStore.ts`. This is the only change to application code in this step. It is uncommitted and easy to revert, but I recommend keeping it.

I could not determine from the repository whether the Render deployment has a database configured; if it does, this defect was live there.

### H.6 Confirmed persistence behaviour

Verified against a real PostgreSQL (disposable, loopback only):

- Records survive recreating all store instances after the old connection pools are closed (a simulated server restart), and can then be updated using their stored version.
- Stale writers are rejected and the stored data is unchanged; of two simultaneous creates, or two simultaneous updates, exactly one wins.
- Clients, and demo versus QuickBooks sources, stay separate in listing and deletion.
- A write the database cannot store (a missing client id) rejects and leaves no partial row.
- Demo reset runs in one transaction. A forced mid-reset failure rolls back completely.

### H.7 Memory versus PostgreSQL differences (documented, not changed)

| Behaviour | Memory | PostgreSQL |
|-----------|--------|-----------|
| Survives a restart | No (`durable = false`) | Yes (verified) |
| A record missing required columns (for example `clientId`) | Accepted silently | Rejected (`NOT NULL`) |
| Reset failure recovery | Compensating re-insert from a snapshot | Real transaction rollback |
| Ordering of lists | Sorted in code (entries, journals, payments) or insertion order (reconciliations, Month End) | Sorted in SQL (`ORDER BY`); reconciliations and Month End are newest period first |
| Stored data | Cloned object | JSON round trip (fields set to `undefined` disappear) |

Reconciliation and Month End `list` ordering is not covered by the contract tests because the two backends order differently; the application should not rely on it without sorting.

Not supported by any store, so not tested: deleting a single record, listing across all clients, optimistic-concurrency on deletion, and transactions spanning more than reset.

### H.8 Remaining storage risks (status after Step 4)

1. Reset, entries, journals, payments, workpapers, reconciliations and Month End are verified on a throwaway local PostgreSQL database and by the dedicated GitHub Actions workflow. The production database (if any) has not been checked, and the missing-schema, permissions and pool-size behaviour on Render is unverified.
2. PostgreSQL tests are skipped locally unless a developer explicitly configures a safe test database. CI requires the PostgreSQL tests and rejects skipped coverage. The workflow has not yet run on GitHub for this unpushed worktree.
3. Risks R2, R3 and the security items S1 to S11 in section B are unchanged: client requests, documents, portal audit, demo transaction edits, review decisions and automation rules are still browser-only.
4. Step 4 adds versioned migrations for the six stores; see section I. Existing production schema compatibility remains unverified because no production database was accessed.
5. Audit history is still stored inside the mutable records.
6. `PostgresDemoResetRepository` no longer creates tables itself; migrations prepare the schema before reset. Compatible legacy schema adoption and incompatible-schema rejection are covered by migration tests.
7. Interaction races between stores (for example a payment racing a Month End close) were not tested.

### H.9 Recommended next implementation step

1. After this work is pushed, verify the PostgreSQL workflow on GitHub and make it a required branch-protection check if branch protection is configured.
2. Before any production rollout, back up and inspect the target schema, then follow the explicit migration approval and adoption procedure in section I.
3. The next application-storage implementation can move browser-only review decisions to a server store using the established store and migration patterns.

### H.10 Step 3: automated PostgreSQL workflow

- **Workflow:** `PostgreSQL storage tests`, at [`.github/workflows/postgres-storage-tests.yml`](../.github/workflows/postgres-storage-tests.yml).
- **Triggers:** pull requests and pushes to any branch, limited to changes under `server/**`, `shared/**`, this audit document, the workflow itself, package manifests, or TypeScript configs. It is an independent test workflow: it has no deployment steps and does not edit or call the existing GitHub Pages deployment workflow.
- **Database:** the job starts a disposable `postgres:18-alpine` service with a dedicated `ledgerops_test` database and test-only credentials. It sets only `LEDGEROPS_TEST_DATABASE_URL`; it does not set or read `DATABASE_URL` or any Render secret. The URL is held in the job environment and is not echoed. PostgreSQL service health is checked before job steps proceed.
- **Preflight:** `node --import tsx server/postgresRequired.check.ts` verifies the explicit test URL passes the existing loopback, database-name, and application-database-safety rules. It prints only a generic success message or a sanitized refusal reason.
- **Command at Step 3:** `npx vitest run server/storageContract.test.ts --reporter=json --outputFile "$POSTGRES_TEST_REPORT"` with `LEDGEROPS_REQUIRE_POSTGRES=true`. Step 4 extends the job to include `server/migrations.test.ts`.
- **Failure reporting:** Vitest prints readable failures and writes a JSON report for the coverage checker, which runs even when tests fail. On failure, a separate allowlisted report containing only counts, known test filenames, test positions and statuses is uploaded for three days; free-form test names, errors, paths and credentials are excluded. If sanitization fails, no report is uploaded. Temporary reports are removed after artifact handling.
- **Isolation and cleanup:** the contract suite creates a uniquely named schema inside the dedicated database, verifies same-named tables in other schemas are unchanged, then drops only its generated schema. It does not drop the database, truncate existing tables or access a remote host.
- **What it verifies:** all six PostgreSQL stores' insert/read/update behavior, version and stale-write checks, concurrent writes, client/source isolation, deletion, storage across recreated store instances, failed writes, and demo reset including forced transactional rollback. No application behavior is changed by the workflow.
- **What it does not verify:** Render or production database configuration, live migration/deployment behavior, `connect-pg-simple` session storage, QuickBooks token handling, database backups/restore, performance/load, or races spanning different stores. GitHub has not run this workflow yet; its result can only be reported after a future push or pull request triggers it.

---

## I. Step 4: versioned PostgreSQL migrations

Date: 2026-11-09. No production or Render database was contacted. Existing application records were not modified by the implementation or test run.

### I.1 Migration architecture

- Migration source files live under `server/migrations/`, ordered with zero-padded numeric versions and stable names. Versions 001 and 002 are applied in order; see section J for the review-decision schema.
- `server/migrations.ts` runs migrations in order in a single transaction and records `version`, `name`, SHA-256 `checksum`, and `applied_at` in `ledgerops_schema_migrations`.
- A transaction-scoped PostgreSQL advisory lock serializes concurrent migration processes. The lock, migration SQL, and history insert are in one transaction; failed migrations roll back before the connection is released.
- Each run checks that recorded versions are contiguous, known, and match the current migration name and checksum. It refuses to modify the database when history is unknown, has a gap, or differs from source. An applied migration must not be edited; changes belong in a new forward version.
- The initial migration creates the six legacy tables and indexes using `IF NOT EXISTS`. There are no automatic `DROP`, `TRUNCATE`, `ALTER`, or data rewrite statements. No automatic down migrations are provided.
- Stores no longer issue DDL. Non-production application startup awaits migration completion before constructing or using PostgreSQL stores and before demo seeding. Memory-store startup is unchanged.
- Production application startup is **check-only**: it verifies migration history and fails closed if the schema is missing or behind. It does not apply schema changes. An operator must run the explicit migration command under the deployment approval policy before deploying/starting the new application version.

### I.2 Migration 001: legacy schema represented

The migration preserves existing table names and column definitions. Each table has `id text PRIMARY KEY`; the listed columns are `NOT NULL`; `updated_at` remains `timestamptz NOT NULL DEFAULT now()`. Index definitions match the existing store implementations.

| Table | Other columns | Non-primary index |
|-------|---------------|------------------|
| `demo_entries` | `client_id text`, `status text`, `version integer`, `created_at timestamptz`, `data jsonb`, `updated_at timestamptz` | `demo_entries_client (client_id, created_at)` |
| `demo_journals` | `client_id text`, `status text`, `version integer`, `created_at timestamptz`, `data jsonb`, `updated_at timestamptz` | `demo_journals_client (client_id, created_at)` |
| `demo_payment_books` | `client_id text`, `version integer`, `data jsonb`, `updated_at timestamptz` | `demo_payment_books_client (client_id, id)` |
| `demo_workpapers` | `client_id text`, `period text`, `version integer`, `created_at timestamptz`, `data jsonb`, `updated_at timestamptz` | `demo_workpapers_client (client_id, period, created_at)` |
| `reconciliation_records` | `source text`, `client_id text`, `account_id text`, `period_end date`, `status text`, `version integer`, `data jsonb`, `updated_at timestamptz` | `reconciliation_records_lookup (source, client_id, account_id, period_end)` |
| `month_end_records` | `source text`, `client_id text`, `period text`, `status text`, `version integer`, `data jsonb`, `updated_at timestamptz` | `month_end_records_lookup (source, client_id, period)` |

These six tables and their primary/non-primary indexes are the complete application-store scope of migration 001. The `user_sessions` table is separately created by `connect-pg-simple` and is not included.

### I.3 Existing database adoption and mismatch handling

Before migration 001 runs, the runner examines same-named relations in the active schema:

1. If no store tables exist, it creates all six tables and indexes.
2. Any present table must be a regular table with the exact ordered columns, data types, `NOT NULL` state, `updated_at` default, primary key, and named index definitions expected above. The validator permits PostgreSQL's internal representation of `NOT NULL` constraints and does not remove or rewrite it.
3. If all present tables pass validation, the migration creates only missing tables/indexes and records the baseline. Existing rows remain in place. `CREATE ... IF NOT EXISTS` does not replace existing objects.
4. A missing required index, unexpected table constraint, different column, type, default or primary key, or a same-named view causes a clear error. No baseline is recorded, and the migration transaction rolls back. The migration does not attempt to repair or drop it.
5. If old deployments have partial tables (for example reset-created tables without indexes), migration refuses automatic repair. Such schemas must be assessed and reconciled manually after a backup.

The checker verifies expected indexes but preserves extra non-conflicting indexes. A DBA should review unusual extra indexes/constraints before adopting a database.

### I.4 How to create and apply migrations

1. Add the next sequential file under `server/migrations/`, for example `003_add_example_field.ts`, and export its `version`, stable `name`, SQL in `up`, and a validator if needed. Add it to the ordered `migrations` array in `server/migrations.ts`.
2. Do not edit an applied migration. Checksums make edits to version 001 detectable. New changes require a new version.
3. Add migration tests to `server/migrations.test.ts`; cover empty schema, adoption, failure without data loss and reruns as applicable.
4. For a local disposable development database, run `npm run db:migrate:source` (or build first and run `npm run db:migrate`). The command reads `DATABASE_URL` from the process or ignored local `.env`; it never prints the URL.
5. The production server never migrates on startup. A production operator must first review and back up the intended database, then run `npm run build` and `npm run db:migrate` with both `LEDGEROPS_PRODUCTION_MIGRATIONS_APPROVED=true` and `--approve-production`. Both approvals are required before the CLI opens a database connection. Run this as a reviewed release/pre-deploy action; do not add it to automatic application startup.
6. Confirm the command reports the expected version and start the application. Production startup verifies that every migration is applied and checksums match.
7. To diagnose a migration without committing schema changes, run the compiled CLI with `--diagnose` and the same two production approvals. It executes pending migration SQL and validation in one transaction, then rolls the transaction back on success. On failure it reports only the migration number, step, and PostgreSQL SQLSTATE (or `null` when the failure was not a PostgreSQL error). This is an explicit diagnostic execution, not a read-only check; do not use it as an automatic retry, and stop if rollback is reported as unconfirmed.

Migration 001 is adoptive for compatible existing tables, but the explicit production step is still mandatory. Normal application startup does not infer approval.

### I.5 Tests implemented and results

`server/migrations.test.ts` covers clean schema creation and repeated-run idempotency, altered-checksum rejection, concurrent attempts from independent pools, adoption of compatible legacy tables while retaining a stored row, incompatible store schema rejection with existing table/data unchanged, incompatible migration tracking table rejection, and the dual production approval policy.

The Step 3 CI workflow runs both `server/storageContract.test.ts` and `server/migrations.test.ts` against its disposable PostgreSQL 18 service. The report checker rejects skipped tests and verifies the required storage and migration cases. The same test-database safety checks and isolated schema from section H remain in force.

Step 4 local verification used a disposable embedded PostgreSQL 18 instance outside the repository. Results: all 57 PostgreSQL storage and migration tests passed, with no skips. The full unit suite, browser suite, TypeScript checks and production build are reported in the Phase 12 Step 4 completion response. No GitHub Actions run has occurred from this local change.

### I.6 Rollback and recovery

- Before applying: take and verify a database backup. Migration 001 makes no record changes and has no destructive down migration.
- If preflight detects incompatible schema: stop. Do not bypass the validator. Compare against the definitions above, inspect the existing schema, take a backup, and have a DBA prepare a separately reviewed/manual reconciliation. Rerun only after the actual schema is verified to match; do not edit migration 001.
- If a migration fails: the migration transaction rolls back its DDL and tracking insert. Failure is surfaced; the application must not continue with partially applied changes.
- After successful migration, the previous application version remains compatible with these unchanged six store schemas. If the new application version must be rolled back, redeploy it; leave migration history and tables intact.
- Later migrations that change or transform data need their own backup, restore and compatibility plan. The runner provides no automatic destructive rollback. Prefer a forward corrective migration or restore from a verified backup.

### I.7 Production rollout considerations and remaining risks

- The GitHub Actions workflow verifies PostgreSQL 18 behavior in an isolated CI service; it does not prove Render database version, privileges, backups or current table/index definitions.
- No live database or Render settings were inspected. Existing production adoption must be scheduled and reviewed explicitly, after confirming the deployed database's actual schema and taking a backup.
- Production startup now fails closed if version 001 has not been explicitly applied. A production release therefore needs a reviewed migration step before the new server starts; the existing deployment workflow is not modified to run it.
- The migration role needs permission to create the tracking table, store tables and indexes. Runtime stores need ordinary read/write privileges. Separating migration and runtime DB roles remains future hardening.
- The old store DDL has been removed. Any tool/test constructing a PostgreSQL store directly must run migrations first. Memory stores are unaffected.
- The `user_sessions` table is outside this migration set. Automation data, requests and documents also remain outside it, as described in sections A and B. Review decisions are covered by migration 002 (section J).

---

## J. Step 5: persistent Bookkeeping Review decisions

Date: 2026-11-09. No production or Render database was contacted. No QuickBooks OAuth or write behavior was changed.

### J.1 Migration 002 and storage lifecycle

- `server/migrations/002_review_decisions.ts` adds `review_decisions` after migration 001. It records a UUID decision ID, source, client ID, finding ID and fingerprint, finding type, issue and description, priority, decision status, optional reason, server-derived actor subject/label, server timestamp and per-finding version.
- Required fields, field lengths, allowed enum values, known demo/Sandbox ownership, positive versions, dismissal reasons and unique `(source, client_id, finding_id, version)` sequences are enforced in PostgreSQL. History/source indexes support scoped listing.
- An append-only database trigger rejects `UPDATE` and `DELETE`. Store/API code exposes listing and append operations only. Reopening or changing a decision adds a new version; it does not replace the earlier event.
- PostgreSQL append serializes writes for the same source/client/finding, compares `expectedVersion`, and inserts the next version in one transaction. Competing stale writes receive HTTP 409. Memory storage implements the same interface for local development without a database, but is explicitly non-durable.
- Demo reset does not delete review history. Resolved findings continue to be inferred from live findings and the latest server decision; historical events are retained.

### J.2 API and authorization

- `GET /api/review-decisions/demo` lists demo history across all five known demo clients for All Clients; optional `clientId` narrows it to a known demo client.
- `POST /api/review-decisions/demo` appends a validated demo decision and requires the standard CSRF token. Both routes require the existing signed-in session or the existing verified localhost-only demo bypass.
- `GET` and `POST /api/review-decisions/quickbooks` use a separate router behind real authentication and CSRF. The development bypass cannot use these routes. The API accepts only `quickbooks-sandbox` as the source's client ID.
- The server checks source/client pairing, known client IDs, finding type/status/priority, expected-version range, required dismissal reason, non-empty fields and field lengths. It generates decision ID, timestamp and actor fields. OIDC subject/email come from the server session; a local bypass is labeled by server code and is not represented as an authenticated user.
- **Authorization limitation:** the current OIDC policy allowlists users globally and has no enforceable per-client permission model. The API limits records to known demo company IDs and retains the existing globally authorized demo access, but an authorized user can read/write decisions for every demo company. This does not constitute per-client authorization and is not suitable for multiple firms or client-facing access.
- **Finding-evidence limitation:** current demo review findings and their fingerprints are produced in frontend state. The API validates the submitted structure and ownership ID but cannot independently prove that a submitted finding/fingerprint corresponds to current server-side accounting records. Treat these decisions as bookkeeping workflow metadata, not trusted evidence or a tamper-proof audit trail. The database trigger prevents ordinary row mutation through DML, but database owners can alter schema or disable triggers.

### J.3 Frontend and existing browser data transition

- `src/App.tsx` loads decision history from the API for the selected source. Demo responses include all clients so All Clients filtering, dismissals and resolved history use each decision's stored client. Demo and QuickBooks decisions remain source-separated, and the decision key includes source, client and finding ID.
- Review, dismiss and reopen actions append through the API. UI state changes only after the server returns success. Loading, saving, errors and stale-version conflicts are visible; failed API requests do not fall back to `localStorage` or report a save.
- Existing `ledgerops-review-decisions-v1` browser data is left untouched and is not automatically read/imported or overwritten. The explicit **Export legacy browser decisions** button downloads the raw stored value. The export is untrusted: review every record, confirm its client attribution and current finding, and re-enter only validated decisions through the normal interface. There is no bulk import endpoint. This keeps transition separate from normal writes and avoids silently trusting old client-provided IDs, actors, timestamps or fingerprints.
- When `DATABASE_URL` is unset, the server uses memory storage and reports that the data will be lost on restart. Durable cross-device behavior requires a configured PostgreSQL database with migration 002 applied.

### J.4 Tests and verification

- `server/reviewDecisions.test.ts` covers input validation, known-client/source separation, CSRF, local bypass limits, real-session actor identity and stale writes.
- `server/reviewDecisionStore.test.ts` covers append-only lifecycle history, version checks, client/source isolation, recreated-store persistence, concurrent stale-write rejection, database boundary constraints and update/delete rejection.
- `src/services/reviewFindings.test.ts` covers lifecycle/fingerprint behavior, source/client key isolation and preserving legacy local data for export.
- `e2e/review.spec.ts` covers API-backed decisions across reload, dismiss/reopen, stale fingerprints, All Clients, save/load errors, retry, and explicit legacy export without automatic import.
- The PostgreSQL CI workflow runs the review store tests with the existing migration/storage suites and rejects skipped PostgreSQL tests. The Step 5A local unit suite passed (972 passed, 21 skipped, including PostgreSQL-gated tests); TypeScript checks and the production build passed. The focused Bookkeeping Review browser suite passed (11 tests, 4 workers).
- Step 5A initially had intermittent full-suite browser failures with Vite React preamble errors. Step 5B's root cause and three consecutive passing full-suite runs are recorded in section J.6.
- **Step 5A PostgreSQL verification is blocked, not passed.** `LEDGEROPS_TEST_DATABASE_URL` was unset; `psql`, `pg_ctl`, Docker and Podman were unavailable; WSL could not be invoked; and `127.0.0.1:5432` was closed. No approved temporary local database was available, so no PostgreSQL connection or installation was attempted. The PostgreSQL-gated integration tests therefore skipped.
- Migration and store test cases exist for fresh migration, migration 001→002, repeat application, checksum mismatch, concurrency, compatible-data preservation, incompatible-schema rejection, append-only history, isolation, stale/concurrent writes, and recreated stores. They were **not verified against a real PostgreSQL server** in this run. No Step 5A PostgreSQL bugs were confirmed or fixed. No GitHub Actions run occurred for this worktree; no production readiness is inferred.
- Coverage distinction: the migration adoption test preserves an existing baseline-store record; there is no dedicated test that inserts a `review_decisions` row and then proves that rerunning migration 002 preserves it. API-level tests validate server-generated identity/time and reject malformed input, but these were not exercised through PostgreSQL; DB-boundary tests do not individually cover every invalid fingerprint/decision value requested in Step 5A.

### J.6 Step 5B Playwright stabilization

- **Root cause:** the browser suite ran the app through Vite's development React Fast Refresh transform. That transform wraps TSX modules with a runtime that expects the React preamble inserted into the HTML; intermittent page/module initialization during parallel tests reached the runtime before the preamble was available. Failures appeared in unrelated tests as missing workspace content, accompanied by `@vitejs/plugin-react can't detect preamble` from `MissingTransaction.tsx`. The underlying issue was test-server React Refresh initialization, not accounting or review behavior.
- `vite.config.ts` now has a dedicated `e2e` mode that disables HMR/Fast Refresh (which browser tests do not need) and forces API calls to same-origin, so tests cannot inherit `.env.production`'s Render API origin. The Vite config establishes the command-appropriate `NODE_ENV` before initializing the React plugin, avoiding late environment changes after the plugin reads it.
- `playwright.config.ts` starts a fresh Vite server in `e2e` mode, bound to `127.0.0.1:5199`; strict port binding and `reuseExistingServer: false` prevent accidentally testing against another or partially initialized server. Previously observed development-server processes were not listening on the Playwright port; no process was terminated.
- Verification after the fix: the complete Playwright suite passed **three consecutive runs with 4 workers**, **242 passed / 0 failed on each run**. There were no React preamble or socket-collision errors in those runs. The full unit suite passed (**972 passed, 21 skipped**); TypeScript checks passed; production build passed. The build retains the existing non-blocking large-chunk warning.
- PostgreSQL verification remains **blocked** as documented above. The Playwright changes do not enable or claim PostgreSQL verification.

### J.5 Remaining limits and next steps

- Run the dedicated PostgreSQL CI workflow, or provide an explicitly configured disposable local test database, before claiming Step 5A verification. Confirm migration 002 compatibility and trigger behavior there.
- No migration or transition has been applied to a production database. Production rollout remains subject to the explicit Step 4 approval process, a reviewed backup, schema inspection and rollback plan.
- Implement firm/client membership and route-level authorization before any multi-firm deployment or access by clients. Move review finding generation/evidence to trusted server-side records before treating decision notes as authoritative accounting audit evidence.
- Existing browser records are not automatically discarded, but they remain confined to that browser until exported; no automatic import or bulk merge is supported.
