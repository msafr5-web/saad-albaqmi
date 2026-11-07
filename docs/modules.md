# Modules and status (branch feat/phase0-database-foundation)

| Module | Backend | Screens | Tests (CI) | Notes |
|---|---|---|---|---|
| Database `saad_albaqmi` (80+ tables, migrations) | done | — | `check:schema` (31) | docs/database.md |
| Hardening, OTP, hash-chained audit | done | OTP dialog | `check:otp` | OTP off by default (`OTP_FINANCE_REQUIRED`) |
| Roles: warehouse keeper, procurement officer, HR officer | done | team, nav | `check:access` | contract + generated files edited by hand |
| Legacy -> relational bridge (branches, rooms, warehouses) | done | — | `check:inventory` | same ids; one-way |
| Inventory | done | `/inventory` | `check:inventory` | alerts, consumption, inbox |
| Procurement: suppliers -> request -> RFQ -> 3 quotes -> award -> PO | done | `/procurement` | `check:procurement` | approval by branch manager or approved delegate |
| Fulfilment: send/print PO, goods receipt, invoice + 3-way match, approval, expense, payment | done | order panel | `check:fulfilment` | printable HTML (save as PDF in browser) |
| HR: departments, employees, leave, delegations | done | `/hr` | `check:hr` | no payroll runs screen yet |
| Digital card (bank-card style), rotating QR, NFC tag, gate/room/student attendance | done | `/card`, `/attendance` | `check:cards` | docs/cards.md; iPhone uses QR |
| Budgets (monthly) + alerts, weekly expenses, sales invoices (VAT inclusive/exclusive), VAT report | done | `/fiscal` | `check:fiscal` | VAT display only (trial period) |

## Not built yet
- Small direct-purchase path (General Manager approval under limits), purchase limits screen, match-tolerance settings screen.
- Native mobile app (the web app is installable on all phones), push notifications, shift/lateness rules.
- Server-side PDF for the purchase order (the printable page is HTML), email for reorder and budget alerts (inbox only).
- Payroll runs screen, student fees invoices tied to diplomas (the diploma form still uses the legacy JSONB record), importer from legacy JSONB.
- ZATCA e-invoicing integration; OpenAPI entries and generated hooks for the newer endpoints (they use a small fetch wrapper).
- Browser verification of the new screens (typecheck passes; no browser/Clerk login was available while building).
