# Inventory API (organization members only)

Built on the relational tables (`items`, `warehouses`, `stock_levels`, `stock_movements`, `reorder_alerts`, `notifications`).
The database enforces the invariants (append-only ledger, no negative stock, one open alert per item and warehouse); the API adds
authorization, validation, notifications and audit.

| Method and path | Purpose |
|---|---|
| `GET /api/inventory/catalogue` | categories, units, active items, warehouses in the caller's scope |
| `POST /api/inventory/items` | create an item; code is `<CATEGORY>-0001`, sequential per category, never reused |
| `PUT /api/inventory/stock-levels` | set minimum / maximum / reorder quantity per warehouse and item (audited with the previous value) |
| `POST /api/inventory/movements` | `opening`, `receipt`, `issue` (needs room or department and a purpose), `adjustment` (direction + reason) |
| `GET /api/inventory/balances?warehouseId=` | balances with `needs_reorder` |
| `GET /api/inventory/alerts` | open reorder alerts in scope |
| `GET /api/inventory/consumption?warehouseId=&from=&to=` | issued quantity per month, room and item (the consumption indicator) |
| `GET /api/notifications`, `POST /api/notifications/:id/read` | in-app inbox |

Rules: every branch has its own warehouse; writes are limited to `super_admin` and `branch_manager` of that branch (dedicated
warehouse-keeper and procurement roles come with the procurement module); `coordinator` and `finance` read. Reaching the minimum
opens one alert and notifies every administrator and that branch's manager once. Only consumables are stocked; assets live in
the asset register. With `OTP_FINANCE_REQUIRED=true` every movement needs a confirmed OTP (`X-OTP-Challenge`, action
`stock.movement`), as described in `docs/security.md`.

Not built yet: web screens for these endpoints, email for reorder alerts (inbox only), stock transfers and stock counts API.
