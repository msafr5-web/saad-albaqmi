# صرح د. سعد البقمي التعليمي

Arabic RTL educational branch and resource management web application with installable PWA support.

## Run & Operate

- Web workflow: `artifacts/saad-albaqmi: web`
- API workflow: `artifacts/api-server: API Server`
- `pnpm run typecheck` — full workspace typecheck
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API contracts
- `pnpm --filter @workspace/db run create-db | migrate | check:schema` — create database `saad_albaqmi`, apply versioned migrations, run 31 constraint checks (see `docs/database.md`)
- `pnpm --filter @workspace/db run push` — development schema only; never against production (use `migrate`)
- `pnpm --filter @workspace/api-server run check:otp` — OTP service and audit ledger (needs a scratch database and `ALLOW_DB_TESTS=1`)
- `node scripts/create-pwa-icons.mjs` — reproduce PNG installation icons

## Sources and scope

- User-supplied PRD and SWOT are in `attached_assets/`.
- Arabic analysis and explicit first-release limitations: `د.سعد البقمي/تحليل-المتطلبات.md`.
- Web app: `artifacts/saad-albaqmi/`, at `/`.
- Shared API: `artifacts/api-server/`, at `/api`.
- API contract: `lib/api-spec/openapi.yaml`.
- Database schema: legacy JSONB tables in `lib/db/src/schema/education.ts`; relational schema (80+ tables, halalas, FKs, triggers) in `lib/db/src/schema/*.ts`, migrations in `lib/db/drizzle`; docs in `docs/database.md` and `docs/security.md`.

## Product decisions

- The user selected an installable web application, not native store apps.
- Anonymous visitors see synthetic read-only examples, never private records.
- Signed-in users get isolated personal workspaces, initially empty. This is not shared institutional RBAC; do not imply that all six PRD roles are already supported.
- Demo fixtures never populate personal workspaces. Do not grant shared administrator access to arbitrary signups.
- Financial totals are cumulative entered amounts, not recognized accounting profit. Utility allocation, depreciation and student cost models require approved business policies.
- No payment gateway is configured. Payment records represent externally collected amounts.
- PWA worker does not cache private APIs, student records or financial records. Offline navigation explains that connectivity is required.

- NFC page (`/nfc`) uses Web NFC: Chrome on Android over HTTPS only. Reads UID and NDEF, writes text/URL/vCard/Wi-Fi (as `WIFI:` text), read-only lock only if `makeReadOnly` exists. No password lock, tag type/capacity, or background tasks. Scan history stays in localStorage.

- Visual identity comes from the user's H. Saudi Skills Institute logo: near-black ink (#0e100f) with a pink-red-orange-yellow-green spectrum; accent is red-orange. Mark is redrawn as SVG (`public/logo-mark.svg`); the supplied 400px lockup is `public/brand/lockup.png` (low resolution, use on light backgrounds only). Default system fonts, no web fonts.

## Stack and conventions

- pnpm, React/Vite, TypeScript, Tailwind, Express, PostgreSQL/Drizzle.
- Replit-managed Clerk with canonical production proxy and cookie auth.
- OpenAPI-first generated hooks and validators; regenerate after every contract edit.
- Structured pino logging; never log credentials, sessions or record payloads.
- Scheduling and related mutations use owner-scoped transaction locks; preserve concurrency safety.

## Before institutional use

Complete verified administrator onboarding, team invitations and branch-scoped authorization; approved cost/utility/depreciation models; detailed curricula and trainer dues; recovery, security and performance validation.

## Financial confirmation (OTP)

Money records created/edited/deleted by organization members can require an emailed OTP (`OTP_FINANCE_REQUIRED=true`, off by default). The API answers 428 with the exact subject to confirm; the web app shows `components/otp-gate.tsx`. Each confirmation is appended to the hash-chained `audit_events` ledger with OTP times and IPs. Details: `docs/security.md`.
