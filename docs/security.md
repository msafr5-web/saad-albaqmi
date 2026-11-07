# Security hardening and OTP confirmation

## What changed in phase 0

| Area | Change | Where |
|---|---|---|
| HTTP headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, strict CSP for the JSON API, HSTS in production | `middlewares/security.ts`, `vercel.json` (static site) |
| CORS | No cross-origin access unless the origin is listed in `CORS_ALLOWED_ORIGINS` (was: any origin with credentials) | `middlewares/security.ts` |
| Rate limiting | 300 requests/min per client (all `/api`), 60 writes/min, OTP routes 20/min and 10 verifications/min per challenge | `middlewares/security.ts`, `app.ts` |
| Abuse quota | Personal workspaces capped at `PERSONAL_RECORD_LIMIT` (default 2000) records | `routes/education.ts` |
| Admin audit | Role/branch changes and revocations (`PATCH /team/:id`) are now written to the audit table | `routes/team.ts` |
| Database pool | Small pool, connect and statement timeouts, error handler | `lib/db/src/index.ts` |
| Health | `/api/readyz` also checks the database | `routes/health.ts` |
| Migrations | Versioned SQL migrations replace `drizzle-kit push` | `lib/db/drizzle` |
| CI | Typecheck, migrate, 31 schema checks, access, cost and OTP checks on PostgreSQL 16 | `.github/workflows/ci.yml` |
| Installs | `vercel.json` uses `--frozen-lockfile` (verified: the lockfile is in sync) | `vercel.json` |

### Limits you should know

- **The rate limiter is in memory.** On serverless each instance counts separately, so it stops bursts and brute force from
  one client but is not a global guarantee. Add a platform firewall/WAF rule for hard limits.
- **`TRUST_PROXY_HOPS=1`** assumes exactly one proxy in front of the API (Vercel/Replit). If a CDN is added, raise it, or
  client IPs in the audit trail will be wrong.
- **No Content-Security-Policy for the web app yet.** The app loads Clerk scripts and inline styles; a policy needs testing in
  a real browser (start with `Content-Security-Policy-Report-Only`). The API itself already sends a strict CSP.
- **Existing money data is still stored as JSON numbers** in `education_records`. Integer halalas apply to the relational
  tables (see `docs/database.md`).

## OTP confirmation of financial operations

Every revenue or expense record (kinds `payment`, `expense`, `invoice`, `installment`) created, edited or deleted by a member
of the shared organization must be confirmed by a one-time code emailed to the person doing it. Personal workspaces and demo
mode are unaffected. **Off by default** (`OTP_FINANCE_REQUIRED=false`) because the web app does not show the confirmation dialog
yet; turn it on only when all of this is true: migrations applied, `RESEND_*` and `OTP_HMAC_SECRET` set, dialog shipped.

### Flow

1. `POST /api/otp/challenges` with `{ "action": "record.create", "subjectType": "payment", "subject": { …the exact record… } }`
   → `201 { challengeId, expiresAt, destination }`; the code is emailed (6 digits, 5 minutes, single use).
2. `POST /api/otp/challenges/{id}/verify` with `{ "code": "123456" }` → `200 { verified: true }`
   (wrong code `401`, expired `410`, exhausted or reused `409`; 5 attempts).
3. Repeat the original request (`POST/PATCH/DELETE /api/records…`) with the header `X-OTP-Challenge: <challengeId>`.
   Without a valid challenge the server answers **`428`** with `{ error, otpRequired: true, otpAction }` so the client knows to prompt.

`subject` must equal what the real request will send: for `record.create` `{ kind, name, branchId, status, details }` (name trimmed,
`branchId` null when absent); for `record.update` the same plus `id`; for `record.delete` `{ id }`.

### Guarantees

- The code is never stored; only an HMAC of `(challenge id, member, action, document hash, code)`.
- A code is bound to the user, the action and the **exact document**: changing the amount after the code was sent invalidates it.
- A verified code is spent once (`consumed_at`), within 10 minutes. Undeliverable email cancels the challenge (**fail closed**).
- Every confirmed operation appends an `audit_events` row **in the same transaction**: actor, role, branch, before/after, OTP
  sent and verified times, the IP/user-agent of the person who requested the code and of the one who confirmed it, and a content
  hash. The ledger is hash-chained and append-only; `SELECT * FROM verify_audit_chain();` must return no rows.
- IP addresses are personal data. They are kept in `audit_events` / `otp_challenges` for security review only and are never
  printed on documents sent to suppliers. Restrict who can read `v_audit_workflow`.

### Not a legal signature

An OTP proves that the holder of the mailbox (and a logged-in session) confirmed the operation. It is not a qualified electronic
signature. If a dispute needs legal weight, ask a lawyer about the Saudi e-transactions law before relying on it.

### Email-only weakness and the roadmap

If a user signs in with an email code to the same mailbox, this OTP is not an independent second factor. It still defeats an
unattended logged-in session and gives a precise audit trail. Next steps: SMS or authenticator (TOTP) for high-value actions,
in-app approval inside the NFC/virtual card for the mobile app, and an emergency path approved by the top administrator with its
own audit entry for the day email is down.

## Environment variables

See `.env.example`. Secrets (`CLERK_SECRET_KEY`, `RESEND_API_KEY`, `OTP_HMAC_SECRET`, `DATABASE_URL`) live only in the hosting
provider's secret store, never in the repository.

## Self-hosted mode (no Clerk, no e-mail provider)

`AUTH_MODE=local` (API) with `VITE_AUTH_MODE=local` (web build) replaces the two external services:

- **Sign-in:** e-mail + password stored as a scrypt hash (`local_accounts`), HttpOnly SameSite=Lax session cookie whose SHA-256 is stored
  in `local_sessions` (14 days), 5 wrong passwords lock the account for 15 minutes, same-origin check on every write.
- **No self-registration.** The first administrator is created at `/sign-in?setup=1` with `ORG_OWNER_EMAIL` and the one-time
  `OWNER_SETUP_TOKEN` (server-side secret). Other members are invited in the Team page, then the administrator presses
  "إصدار/إعادة كلمة مرور" and hands over a random temporary password (shown once; the member must change it at first sign-in).
- **OTP without e-mail** (`OTP_CHANNEL=app`, default in local mode): the code is derived from `OTP_HMAC_SECRET`, never stored, and shown
  only in the member's own **بطاقتي** screen (open it on the phone, type the code on the computer). Same binding to user, action and exact
  document, same single use, same audit trail. If the request and the code are viewed in the same browser session the code proves a
  deliberate second step, not a second device; use the phone for real separation.
- Forgotten password: an administrator re-issues it. Lost administrator access: re-run `saad-deploy` after deleting the owner's row in `local_accounts`.
- Switch back to Clerk by setting `AUTH_MODE=clerk`/`VITE_AUTH_MODE` empty and the Clerk keys; accounts are not migrated between modes.
