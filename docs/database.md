# Database — `saad_albaqmi` (PostgreSQL 15+)

The relational database of the Saad Al-Baqmi educational platform. It sits **next to** the four legacy JSONB tables the
running application still uses, so nothing in production changes until each module is moved over deliberately.

| | |
|---|---|
| Database name | `saad_albaqmi` |
| Engine | PostgreSQL 15 or newer (uses `UNIQUE … NULLS NOT DISTINCT`, generated columns, `btree_gist`, `pgcrypto`). Verified on 16 (CI) and 18 (local). |
| Migrations | `lib/db/drizzle/*.sql`, applied in order by `lib/db/scripts/migrate.mjs` (drizzle journal) |
| Schema source | `lib/db/src/schema/*.ts` (Drizzle) — migrations 0001 and 0003 are hand-written SQL for what Drizzle cannot express |
| Tests | `lib/db/tests/schema.check.mjs` (31 checks: constraints, triggers, exclusion rules, views, seeds) |

## Conventions

- **Money is integer halalas** (`*_halalas bigint`, 1 SAR = 100 halalas). No floats anywhere in the new schema. VAT is
  computed by one SQL function pair (`vat_net`, `vat_gross`) and by generated columns, so rounding is identical everywhere.
- **Keys:** `bigint GENERATED ALWAYS AS IDENTITY`. Foreign keys are `RESTRICT` (history must not disappear); line tables `CASCADE`.
- **Statuses** are `text` + `CHECK` (cheaper to evolve than ENUMs). Document numbers come from `next_doc_no('PO')`
  (`PO-2026-000123`, gap-free inside the business transaction).
- **Immutability:** `stock_movements` and `audit_events` are append-only (triggers); confirmed `payments`/`expenses` cannot
  change (only `confirmed → reversed`); issued purchase orders and their lines freeze after preparation; payroll lines lock
  once the run is approved.
- **Integrity in the database, not only in the app:** no double booking of rooms/instructors (exclusion constraints), room
  capacity, no negative stock, award needs three suppliers, PO needs an approved award and an approved supplier with a
  well-formed VAT number, segregation of duties (preparer ≠ approver), one bill per meter and month, one supplier invoice
  number per supplier.
- **VAT number format** `^3[0-9]{13}3$` (15 digits, starts and ends with 3) is enforced; whether a number is really
  registered must still be checked against the tax authority's lookup.

## Domains

| Domain | Tables |
|---|---|
| Organization | `branches`, `org_settings`, `documents`, `document_sequences`, `notifications` |
| HR | `departments`, `job_titles`, `employees`, `leave_types`, `leave_requests`, `approval_delegations`, `shifts`, `employee_shifts`, `payroll_runs`, `payroll_lines` |
| Facilities and curriculum | `electricity_meters`, `rooms`, `asset_categories`, `assets`, `asset_maintenance`, `diplomas`, `levels`, `subjects`, `subject_prerequisites` |
| People and timetable | `students`, `student_subjects`, `instructors`, `instructor_subjects`, `instructor_evaluations`, `session_recurrences`, `class_sessions`, `session_students`, `attendance_records`, `grades` |
| Finance and tax | `tax_rates`, `sales_invoices`, `sales_invoice_lines`, `installments`, `payments`, `payment_allocations`, `expense_categories`, `expenses`, `utility_invoices`, `branch_budgets`, `cost_report_snapshots` |
| Inventory | `item_categories`, `units`, `items`, `warehouses`, `stock_levels`, `stock_movements`, `stock_transfers`, `stock_transfer_lines`, `stock_counts`, `stock_count_lines`, `reorder_alerts` |
| Procurement | `suppliers`, `supplier_categories`, `purchase_requests`, `purchase_request_lines`, `rfqs`, `rfq_suppliers`, `quotations`, `quotation_lines`, `quotation_evaluations`, `procurement_exceptions`, `rfq_awards`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `supplier_invoices`, `supplier_invoice_lines`, `match_tolerances`, `supplier_payments`, `purchase_limits`, `direct_purchase_policies` |
| Security | `otp_challenges`, `audit_events`, `identity_cards`, `presence_events` |
| Legacy (unchanged) | `education_records`, `education_audit`, `org_members`, `cost_policies` |

Reporting views: `v_stock_balances`, `v_reorder_status`, `v_consumption_monthly`, `v_student_ledger`,
`v_branch_budget_status`, `v_purchase_period_usage`, `v_vat_sales`, `v_vat_purchases`, `v_audit_workflow`.

```mermaid
erDiagram
  branches ||--o{ rooms : has
  branches ||--o{ warehouses : has
  branches ||--o{ students : enrols
  branches ||--o{ employees : employs
  diplomas ||--o{ levels : contains
  levels ||--o{ subjects : contains
  students ||--o{ installments : owes
  students ||--o{ payments : pays
  payments ||--o{ payment_allocations : "settles"
  installments ||--o{ payment_allocations : "settled by"
  rooms ||--o{ class_sessions : hosts
  instructors ||--o{ class_sessions : teaches
  class_sessions ||--o{ session_students : seats
  items ||--o{ stock_movements : "moves in"
  warehouses ||--o{ stock_movements : holds
  warehouses ||--o{ reorder_alerts : "raises"
  purchase_requests ||--o{ rfqs : "asks quotes"
  rfqs ||--o{ quotations : receives
  rfqs ||--o| rfq_awards : "is awarded"
  purchase_requests ||--o{ purchase_orders : "becomes"
  suppliers ||--o{ purchase_orders : receives
  purchase_orders ||--o{ goods_receipts : "received by"
  purchase_orders ||--o{ supplier_invoices : "billed by"
  org_members ||--o{ otp_challenges : confirms
  otp_challenges ||--o{ audit_events : "evidence for"
```

## ER diagram and documentation (generated from the live database)

Everything below is produced by `pnpm --filter @workspace/db run er` against a migrated database, so it can never drift from the schema
(the command fails if a table has no Arabic description in `lib/db/scripts/table-comments.mjs`; the same descriptions are stored in the
database as `COMMENT ON TABLE`, migration 0004).

| File | What it is |
|---|---|
| `docs/database/ER-diagram-saad-albaqmi.pdf` | 31-page reference: reading guide, domain map, one full ER diagram per domain with a table-by-table description, and the all-tables map |
| `docs/database/er/overview.svg` | map of the 13 domains and the foreign keys between them |
| `docs/database/er/<domain>.svg` / `.mmd` | full ER diagram per domain (all columns, types, PK/FK/UK, cardinality); Mermaid source alongside |
| `docs/database/er/full-map.svg` | every table and all 195 relationships on one canvas (key columns only) |
| `docs/database/saad_albaqmi.dbml` | the complete schema for dbdiagram.io / DBML tools |
| `docs/database/data-dictionary.md` | every table: columns, types, defaults, generated expressions, keys, checks, indexes, triggers (Arabic) |
| `docs/database/saad_albaqmi_full.sql` | ONE standalone script that builds the whole database on an empty PostgreSQL 15+ server |

Build the database from the standalone script:

```bash
psql -U postgres -c "CREATE DATABASE saad_albaqmi ENCODING 'UTF8' TEMPLATE template0"
psql -U postgres -d saad_albaqmi -f docs/database/saad_albaqmi_full.sql
```

(or, with the journal, `pnpm --filter @workspace/db run create-db && pnpm --filter @workspace/db run migrate`). Regenerate the script after a new
migration with `pnpm --filter @workspace/db run bundle-sql > docs/database/saad_albaqmi_full.sql`.

Render the diagrams after changing the schema: `npx @mermaid-js/mermaid-cli -i docs/database/er/<domain>.mmd -o docs/database/er/<domain>.svg`
(the full map needs `--size 9000` for PNG). Edges to `org_members` (created_by / approved_by ...) are left out of the drawings and listed in the dictionary.

## Creating and migrating

```bash
# 1. Local server (or any PostgreSQL 15+):  docker compose up -d db
export DATABASE_URL=postgres://saad:saad_dev_password@localhost:5432/saad_albaqmi

pnpm --filter @workspace/db run create-db    # creates "saad_albaqmi" if missing (needs ADMIN_DATABASE_URL or DATABASE_URL)
pnpm --filter @workspace/db run migrate      # applies pending migrations (idempotent)
pnpm --filter @workspace/db run check:schema # 31 checks, each in a rolled-back transaction
```

### Production rollout (existing database)

1. Take a backup/snapshot.
2. `pnpm --filter @workspace/db run migrate` against the production `DATABASE_URL`. Migration 0000 is `IF NOT EXISTS`, so the
   four legacy tables (already created earlier with `drizzle-kit push`) are left alone; 0001–0003 only add objects. This path
   was rehearsed against a database pre-populated with legacy tables and rows.
3. Deploy the code **after** the migration (code that uses OTP or the new tables fails without it).
4. Do not use `db:push` against production any more.

### Changing the schema

Edit `lib/db/src/schema/*.ts`, run `pnpm --filter @workspace/db run generate` (writes the next `NNNN_*.sql`), review it, and add
anything Drizzle cannot express (triggers, exclusion constraints, views) as a custom migration
(`drizzle-kit generate --custom --name …`). Commit the SQL and `drizzle/meta`.

## From legacy JSONB to relational

The app still reads/writes `education_records.details`. The relational schema is ready for each module to move over, one at
a time, behind the same API contract:

1. Write an idempotent importer per module (branches → rooms/assets → diplomas/levels/subjects → students/instructors →
   sessions/attendance/grades → finance), converting SAR numbers to halalas with `Math.round(x * 100)`.
2. Reconcile (row counts and sums per branch) before switching the routes over.
3. Keep `education_records` read-only for one release, then archive it.

New modules (HR, inventory, procurement, tax, identity cards) have no legacy data and should be built directly on the new tables.

## Roles and access (recommended)

Create separate roles instead of using the owner role from the application:

- `saad_app` — `SELECT/INSERT/UPDATE/DELETE` on application tables, `USAGE` on sequences, **no** `TRUNCATE`, no DDL.
- `saad_audit_ro` — `SELECT` on `audit_events`, `otp_challenges`, `v_audit_workflow` only.
- `saad_migrate` — DDL rights, used only by `migrate`.

Revoke `UPDATE/DELETE/TRUNCATE` on `audit_events` and `stock_movements` from every role as a second layer on top of the triggers.
`verify_audit_chain()` returns the first broken row (or nothing); schedule it daily and alert on any result.

## Known limits

- The application does not use the relational tables yet; only OTP challenges and audit events are written by the API
  (when `OTP_FINANCE_REQUIRED=true`).
- Goods-receipt posting to stock, three-way matching and reorder notifications are application logic still to be built on top
  of these tables; the database guards the invariants (no negative stock, no over-receipt, alerts opened automatically).
- PII columns (`national_id`, `iban`, phone, email) rely on the provider's encryption at rest; add application-level
  encryption if the hosting provider cannot guarantee it.
