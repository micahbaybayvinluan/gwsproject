# GWS-ERP — Get Wheysted Supplements Internal System

Inventory, sales and accounting for Get Wheysted Supplements / Prothin: main warehouse, company branches, franchises, dealers, agents and online channels, replacing the three disconnected Excel workbooks (`inventory.xlsm`, `SAles Report Sample.xlsx`, `ACCTG PROGRAM - FORMAT.xlsm`).

One data model, one codebase, two phases:

| Phase | Scope | Status in this build |
|---|---|---|
| **1 — Operations** | Users/roles/overrides, approval engine, audit log, notifications; products, tiers, suppliers, locations; batches with expiry, receiving + cost approval, pull-out/transfer-in with in-transit and receiver confirmation, returns, consignment in/out; sales (all channels/modes), agents, AR/PDC + credit notes, midnight close + post-close edits, cash count; branch expenses; min-stock & expiry alerts; actual count → 7-day discrepancy case → final report + charge form; Daily Branch Sales Report, inventory reports, forms to xlsx/PDF; Excel imports | Implemented end to end and covered by the test suite |
| **2 — Finance** | Chart of accounts import + branch templating, beginning balances, automatic journal entries R1–R14, manual vouchers, period lock, TB / IS / BS / NI-per-branch / Cash Flow / schedules, depreciation, payroll (HR + Accounting Head close), franchise P&L | Implemented; auto-posting is behind the `gl.auto_posting_enabled` setting (off by default) so Phase 1 can go live first |

The three source workbooks are in `/seed/` and are loaded by the seed step: **1,120 products** with brands, FRANCHISEE/DEALER/RETAILER prices and the Warehouse opening quantities from `inventory.xlsm`; the **full chart of accounts (601 accounts) with FY2026 beginning balances** (balanced to the peso) from `ACCTG PROGRAM - FORMAT.xlsm`. The Daily Branch Sales Report export fills a copy of `SAles Report Sample.xlsx` (`api/templates/daily-sales-report.xlsx`), so the FRONT sheet is produced by the sample's own formulas and matches it cell for cell. See `seed/README.md`.

## Repository layout

```
api/     NestJS 11 + Prisma 6 + PostgreSQL 16 (src/<module>/…, prisma/schema.prisma, prisma/seed.ts, test/e2e.spec.ts)
web/     React 18 + Vite + Tailwind 4 + TanStack Query/Table (src/pages/*, e2e/ Playwright smoke test)
seed/    Place the three source workbooks here (see seed/README.md)
docs/    decisions.md (things decided beyond the spec), ops/backup.sh
docker-compose.yml   Postgres, Redis, MinIO (+ bucket init), ClamAV, api, web, daily backup
.github/workflows/ci.yml   typecheck → unit + e2e (Vitest) → build → Playwright smoke
```

## Quick start (development)

Prerequisites: Node 22, pnpm 10, Docker (or local Postgres 16 + Redis 7).

```bash
pnpm install
cp .env.example api/.env                      # edit DATABASE_URL / REDIS_URL if not using compose
docker compose up -d postgres redis            # add "minio minio-init clamav" for S3 storage + virus scanning
pnpm --filter @gws/api prisma:generate
pnpm --filter @gws/api prisma:deploy           # applies prisma/migrations
pnpm --filter @gws/api prisma:seed             # roles, locations, tiers, test users + products, opening stock and chart of accounts from /seed
pnpm dev                                       # api on :4000 (nest start --watch), web on :5173 (vite)
```

Full stack in containers: `docker compose up --build` (web on http://localhost:5173, API on :4000, MinIO console :9001).

### The real data (§15 migration plan)

Steps 1, 2, 3 and 5 of the migration plan (products, chart of accounts, opening stock at the Warehouse, beginning balances) run inside `prisma:seed` from the workbooks in `/seed/`. Re-running the seed is safe: it never duplicates and posts opening stock once. What is still manual:

- **Product costs**: `inventory.xlsm` has an empty COST column, so opening stock is posted at ₱0 and no standard cost exists. Admin enters costs via **Catalogue → Price Changes** (cost column) or the Imports → Products template; receiving with Head Auditor cost approval sets them from then on.
- **Daily Inventory Report** (Reports → Inventory Reports): any date range, viewable per day or for the whole period, with Beg / Receive / Transfer In / Returns / Pull Out / Sales / Other Out / Adj / End per product. Roles with `cost.view` automatically get the costed version (Transfer In Cost, Pull Out Cost, Cost of Sales, End Value); everyone else gets quantities only. Available to every role that has inventory access (all except HR Staff, per §5.4), always limited to the user's own location(s). API: `GET /api/stock/daily-inventory`, `GET /api/reports/daily-inventory.xlsx`.
- **Opening stock at branches** (the workbook only has the Warehouse): Imports → "Opening stock per location" template.
- **Open AR**: Imports → "Open AR" template.
- **27 products flagged for review** (promo bundles, ambiguous names): Catalogue → Products, filter by the "review" badge.

Every importer is also available in the UI (**Catalogue → Imports**) with template downloads and per-row error reporting; `.xlsm` uploads are accepted.

## Test accounts (created by the seed)

See **SIMULATION-GUIDE.md** for the full account list (one per branch and franchise) and a 16-step walk-through across every role.

All seeded users share the password `ChangeMe!2026` (override with `SEED_PASSWORD`) and demo company IDs DEMO-001…; each accepts the accountability statement at first sign-in. Accounts created by Admin must set their own password. Roles marked 2FA must enrol a TOTP authenticator on first login (the login screen shows the secret / otpauth link).

| Username | Role | Scope | 2FA |
|---|---|---|---|
| `admin` | ADMIN (owner) | all | yes |
| `ext.auditor` | EXTERNAL_AUDITOR (read-only, sees FS + cost) | all | yes |
| `head.auditor` | HEAD_AUDITOR | all | yes |
| `asst.auditor` | ASST_AUDITOR | all | |
| `audit.assoc` | AUDIT_ASSOCIATE | reports only | |
| `wh.incharge` | WAREHOUSE_IN_CHARGE | Warehouse | |
| `wh.assoc` | WAREHOUSE_ASSOCIATE | Warehouse | |
| `sales.westave` / `sales.dasma` | SALES_ASSOCIATE | West Ave / Dasmariñas | |
| `fr.mayon.assoc` | FRANCHISE_SALES_ASSOCIATE | Mayon | |
| `fr.mayon.owner` | FRANCHISE_OWNER | Mayon | |
| `custom.user` | CUSTOM (build from overrides) | — | |
| `acct.head` | ACCOUNTING_HEAD | finance | yes |
| `acct.assoc` | ACCOUNTING_ASSOCIATE | finance | |
| `hr.staff` | HR_STAFF | payroll only | |
| `field.auditor` | FIELD_AUDITOR | West Ave, CSR | |

## Tests

```bash
pnpm test          # api: 55 unit tests (redaction per role, posting rules R1–R14, approval routing, importers, sales report builder, daily inventory report)
                   #      + 27 end-to-end tests over HTTP against the real DB (receive → cost approve → transfer → confirm → FEFO sale →
                   #        special price → AR/credit note → reports → post-close edit needing Head+Asst → bulk approvals →
                   #        count → discrepancy → charge form → HR → alerts → scoping/redaction → Phase 2 posting, period lock, opening balances →
                   #        warehouse → franchise transfer, In-Charge edits accepted/rejected by the preparer, draft forms, receiver ticks,
                   #        personal accounts: ID + own password + accountability statement, one session per account)
pnpm --filter @gws/web test:e2e   # Playwright smoke test of the daily close on a phone viewport (set PLAYWRIGHT_CHROMIUM_PATH to reuse a local Chromium)
pnpm typecheck && pnpm build
```

The e2e suite expects a seeded database (`prisma:seed`) and creates its own products/documents with unique names; CI runs it on a fresh Postgres service.

## Architectural security rules (§3) and where they live

1. **Cost/margin/supplier-name redaction** in the serialization layer: `api/src/common/redaction.ts` (`redactForRole`, global `RedactionInterceptor`); sensitive field list `COST_FIELDS`; tested for all 15 roles in `redaction.spec.ts` and on live endpoints in `test/e2e.spec.ts`.
2. **Mandatory branch scoping**: `api/src/common/prisma.service.ts` — a Prisma query extension rejects reads on location-carrying models that lack a `locationId` filter when the request user is location-scoped (roles in `LOCATION_SCOPED_ROLES`). Services use `ScopeService.locationFilter()`.
3. **Audit log on every state change**: `AuditInterceptor` (all POST/PUT/PATCH/DELETE) plus richer before/after rows written by services; exports, logins, failed logins, permission changes and approvals are logged.
4. **No hard deletes** on transactional tables: `voidedAt/voidedBy/voidReason` everywhere; journal corrections are reversals.

Sessions are server-side in Redis (30 min idle; 12 h for sales/franchise roles), passwords argon2, TOTP mandatory for Admin, External Auditor, Head Auditor, Accounting Head. Uploads are size-, magic-byte- and ClamAV-checked (`CLAMAV_REQUIRED=true` to fail closed).

## Accountability and editing rules (owner requests, 2026-09-25)

- **One person per account.** Every account names its person (full name + company ID; required when Admin creates a user). A new person replaces the temporary password and accepts an accountability statement before doing anything; the acceptance, IP and statement text are audit-logged. Changing the name or ID on an account requires the new person to accept again.
- **One device at a time.** A completed sign-in (after 2FA where required) signs out every other session of that account; the old device sees "signed out because your account signed in on another device", and the person gets a notification. Users & Roles shows recent sign-ins (IP and device).
- **Everything is tagged.** Documents show "Prepared by / received by" names, a "Who did what" panel (every action with name, company ID, role and time), and printed forms carry the preparer, approvers and receiver. Audit Log filters by person.
- **Drafts.** Receiving and transfer drafts can be printed (stamped DRAFT) and edited by their preparer before submission; only the preparer submits a draft (Admin and auditors can too). Drafts belong to the sending location: the receiving location sees the document once it is submitted and prints a Transfer-In copy.
- **Receiving side ticks.** The receiving location confirms each line with a tick ("arrived complete") or "tick all"; an unticked line needs the counted quantity and a note when short.
- **Warehouse edits need the preparer's acceptance.** The Warehouse In-Charge (and Admin) can change a receiving or transfer that someone else prepared while it is a draft or awaiting approval; the change is sent to the preparer as a person-addressed "Warehouse edit" and applies only when they accept. A submitted document goes back through approval after an accepted edit.
- **Warehouse transfers** go from the warehouse to any branch, franchise or consignee; the Warehouse Associate and In-Charge both see every destination.

## Decisions to confirm with the owner

Implemented as stated in the spec's ASSUMPTION notes (§18); each is a one-line change if the owner decides otherwise.

1. Sales associates can see **warehouse on-hand quantities** (never cost) so they can request transfers.
2. Franchise **associates cannot alter prices**; the Franchise Owner sells at their own retail price and SPECIAL_PRICE approval does not apply to franchise retail.
3. Cash-count variance at close is **recorded but not blocking**.
4. Cost **decreases do not revalue** stock; only increases post to "Other Income – Price Increase" (R12), and the approval screen labels this as non-standard.
5. Supplier **freebies are booked to Other Income** (R2) rather than lowering average cost.
6. **Consignment-in is off-balance-sheet** by default (`consignment_in_on_balance_sheet=false`); flip the setting for the legacy treatment.
7. Dasmariñas and Vito Cruz are seeded as **company branches**; their legacy "AR – Franchise …" accounts are imported and left for old balances.
8. Untagged (main) expenses in NI-per-branch are allocated **pro-rata to revenue** (`gl.ni_allocation_basis`, `EQUAL` also available).
9. The AGENT tier **defaults to the DEALER price** when no AGENT price row exists.
10. The product import loads **all rows** of `DAILY INVTY COUNT` and flags ambiguous ones for Head Auditor review; deactivate rather than skip.
11. Transfer **overages are rejected**; the receiver can only confirm ≤ sent.
12. **One SalesDoc per DR/SI number** per branch (duplicate DR → 400).
13. The **24 h auto-approve on unchanged cost** is the only auto-approval enabled by default; transfer and special-price thresholds exist in Settings but are off.

Further choices made where the spec was silent are logged in `docs/decisions.md`.

## Operations notes

- Jobs (BullMQ): midnight close 00:00 Manila, nightly min-stock/expiry alerts, auto-approve every 15 min, cost-approval reminders hourly, discrepancy deadline daily, AR overdue daily, email digest daily, price-change notices daily, month-end depreciation. Disable with `DISABLE_JOBS=true` (tests do).
- Backups: the `backup` compose service runs `docs/ops/backup.sh` (daily `pg_dump` to the `gws-backups` bucket, 30-day retention).
- PDF rendering needs Chromium (`PUPPETEER_EXECUTABLE_PATH`); without it the PDF endpoints return the same document as HTML.
- Email digests need `SMTP_URL`; without it the in-app bell still works.

## What the workbooks revealed (decided while importing)

- The chart of accounts uses the numbering 1xxx cash/AR, 2xxx inventory/advances-to, 3xxx fixed assets, 4xxx liabilities, 5xxx equity, 6xxx revenue, 7xxx direct cost, 8xxx OPEX; generated codes follow the same ranges.
- Account titles follow the workbook's exact wording ("Cash on Hand- West Ave", "Rider/Driver Expense (Gas) - Imus"), so accounts generated for a new branch look identical to the imported ones. Typos in the source ("Sales - Imus Ave Dealers", "Globe/PLDT (Internet) -CSR") are matched to the right template.
- "Spoilage, Damage, Expired & Others" and the supplement tasting accounts sit under Operating Expenses in the workbook, so that is where the system posts them.
- Accumulated depreciation is shown as a negative asset in the workbook; the import books it as a credit so the opening trial balance balances.
