# Importing the legacy records into the relational database

`lib/db/scripts/import-legacy.mjs` copies every legacy record (`education_records`, owner `org:main`) into the relational tables.
Personal workspaces are NOT imported (they are private sandboxes). The web app keeps reading the legacy tables until you decide to switch
(see "Cut-over"); importing does not change what users see.

## What it does
| Legacy kind | Relational table(s) | Notes |
|---|---|---|
| branch, room | `branches`, `rooms` (+ one warehouse per branch) | head office = the branch named "المركز الرئيسي" |
| diploma, level, subject | `diplomas`, `levels`, `subjects`, `subject_prerequisites` | duration text parsed to months (flagged if guessed); fees VAT-exclusive unless `--prices-include-vat` |
| student, instructor | `students`, `student_subjects`, `instructors`, `instructor_subjects` | invalid e-mails dropped |
| session, attendance, grade | `class_sessions`, `session_students`, `attendance_records`, `grades` | grades need a subject with the same name in the student's diploma |
| asset | `assets`, `asset_maintenance` | maintenance date becomes a scheduled maintenance |
| expense, invoice (electricity) | `expenses`, `electricity_meters`, `utility_invoices` | expenses become CONFIRMED (history); unknown categories -> "أخرى" and reported |
| installment, payment | `installments`, `payments`, `payment_allocations` | payments allocated to installments oldest-due first, like the old ledger |

Guarantees
- **Same ids:** every relational row keeps its legacy id, so `org_members.linked_record_id`, identity cards and any stored link keep working.
- **Idempotent:** master data is upserted; money documents are inserted once and never rewritten (`RC-IMP-<id>`, `EXP-IMP-<id>`). Run it again any time.
- **Safe:** one transaction, one savepoint per record. A bad record is skipped with a reason; `--dry-run` rolls everything back.
- **Provable:** the report compares legacy and relational counts and money totals (payments, expenses, installments, electricity) to the halala and checks that
  allocations never exceed a payment. If anything differs the whole import is rolled back and the exit code is 2.

## Runbook
```bash
export DATABASE_URL=postgres://...            # the migrated database (pnpm --filter @workspace/db run migrate first)
# 1) rehearse: prints the reconciliation, writes nothing
pnpm --filter @workspace/db run import-legacy -- --dry-run --report=import-dry.json
# 2) read import-dry.json: "skipped" lists every record that cannot be imported and why; "notes" lists assumptions and guesses
# 3) fix the source data (or accept the skips), then import for real
pnpm --filter @workspace/db run import-legacy -- --report=import-report.json
```
Options: `--actor-email=a@b.c` (the account the audit columns of historical money documents point to; default: first active super_admin),
`--prices-include-vat` (legacy fees already contain VAT).

## Assumptions to confirm with the accountant
- Legacy amounts have no VAT split, so net = amount and VAT = 0 on imported expenses and utility bills.
- The payment method was never recorded; imported receipts say "cash".
- A term ("فصل") in a diploma duration is counted as 4 months.

## Cut-over (not done yet)
The API routes still read `education_records`. Moving a module over means: import, reconcile, switch that module's routes to the relational
tables behind the same API contract, keep the legacy table read-only for one release, then archive it. Do it module by module; start with
branches/rooms (already mirrored by `legacy-sync`), then curriculum, then people and timetable, finally finance.
