# Internal requests and tasks

Replaces ad-hoc e-mail and chat tasking with one screen (`/requests`). A manager sends a task to an employee; the system stamps the four
stages itself and derives every duration (nothing is typed by hand).

| Stage | Stamped when | Stored in |
|---|---|---|
| 1. Sent | the manager creates the request | `sent_at` |
| 2. Received | the assignee opens it for the first time (later opens change nothing) | `received_at`, `receive_seconds` |
| 3. Responded | the assignee answers with a note and optional links | `responded_at`, `response_seconds` |
| 4. Closed | the manager reviews and approves | `closed_at`, `total_seconds` (sent to closed) |

Also: `cancelled` (manager, with a mandatory reason). An answer given without opening the screen first counts as received at the same moment.

## Who sees what
- **General Manager / branch manager:** dashboard (counts, average stage times, "awaiting your closing", per-employee performance), all requests
  in their scope with filters and search, a side panel with the four-stage timeline, create / close / cancel. Branch managers only reach their branch's employees.
- **Every other administrative role** (finance, coordinator, warehouse keeper, procurement officer, HR officer): "طلباتي" only: the requests addressed to them.
  The assignee is matched by the employee record's linked account or its e-mail, so the employee must have an e-mail in HR and be invited in "فريق العمل".
- Instructors and students have no access.

## Rules enforced by the database and the API
- The assignee can answer; only a manager in scope can close or cancel; nobody closes a request addressed to themselves; a manager cannot send to themselves.
- Stages cannot be skipped or reversed (`CHECK` on status/timestamps and on time order); the event timeline is append-only (`forbid_mutation`).
- "Late" = the due date passed while the request is still waiting for the employee's answer, or the answer came after the due date.
- Notifications: an in-app row plus an e-mail (when SMTP is configured) to the assignee on creation, and to the manager when the answer arrives.
  No SMS (it needs a paid gateway); the mobile number is stored for the manager's reference.
- Audit: `request.create`, `request.close`, `request.cancel` in `audit_events`.

## API (`/api/requests`)
`GET /catalogue`, `GET /stats`, `GET /?scope=managed|mine&status=&assigneeId=&q=`, `GET /:id`, `POST /`, `POST /:id/open`, `POST /:id/respond`, `POST /:id/close`, `POST /:id/cancel`.

## Not included (by design, to stay within the brief)
File upload (answers carry links to the proof), reassignment, comments, recurring tasks, SMS.
