# Procurement API and screens (standard path)

Roles: `procurement_officer` (buys: suppliers, RFQ, quotes, award recommendation, purchase order) and `warehouse_keeper` (stock and
purchase requests) were added next to the original six. A procurement officer or warehouse keeper belongs to one branch; a
procurement officer without a branch works for the whole organization (head office). Branch managers approve; the General Manager
(`super_admin`) can do everything.

| Step | Endpoint | Who | Enforced rule |
|---|---|---|---|
| Supplier | `POST /api/procurement/suppliers`, `POST …/suppliers/:id/approve` | buyer creates; branch manager / admin approves | VAT number `^3\d{13}3$`, unique; only approved suppliers can quote or be ordered |
| Purchase request | `POST /api/procurement/requests` | keeper, manager, buyer | refused when the item is stocked above its minimum; links and moves the reorder alert to `in_progress` |
| RFQ | `POST …/requests/:id/rfq` | buyer | at least 3 approved suppliers, deadline in the future |
| Quotation | `POST …/rfqs/:id/quotations` | buyer | invited suppliers only, every request line priced, one per supplier, VAT number copied from the supplier register |
| Evaluation | `POST …/quotations/:id/evaluate` | buyer, manager | scores 0-100 (technical, quality, commercial) |
| Comparison | `GET …/rfqs/:id/comparison` | readers in scope | totals before/after VAT, lowest flagged, scores |
| Award | `POST …/rfqs/:id/award` | buyer | 3 quotes from 3 suppliers; not the cheapest ⇒ written justification (10+ chars) |
| Award approval | `POST …/rfqs/:id/award/approve` | branch manager of that branch, an approved delegate, or admin | OTP when enabled; approver ≠ recommender |
| Purchase order | `POST …/rfqs/:id/purchase-order` | buyer | only after approved award; entity VAT number required (branch `vat_number` or setting `entity.vat_number`); OTP; frozen once prepared |
| PO approval | `POST …/orders/:id/approve` | branch manager / delegate / admin | approver ≠ preparer; delegation must be `approved`, inside its dates, scope `purchase_approval`/`all`; stores the document hash |

Delegation: a row in `approval_delegations` (proposed by HR, approved by the General Manager, different people) lets the
delegate approve for the delegator's branch during its window. There is no screen for creating delegations yet; HR and the GM
use SQL or a future screen.

Web screens: `/inventory` (balances, alerts with "create purchase request", consumption indicator, inbox, movements, reorder
levels, new items) and `/procurement` (requests, RFQ panel with quote entry, comparison, award and PO preparation, purchase
orders with approval, suppliers). The OTP dialog appears automatically for the steps that require it.

Not built yet: small direct-purchase path, PO PDF template and email to the supplier, goods receipt (posting to stock with quality
check), supplier invoice and three-way match, delegation screen, tolerance settings screen, email for reorder alerts.
