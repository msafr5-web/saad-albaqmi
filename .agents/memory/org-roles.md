---
name: Org roles and first-admin bootstrap
description: How shared-institute membership and the first administrator are established
---
First admin comes from env var ORG_OWNER_EMAIL (owner-defined, matched to a Clerk-verified email, set separately in dev and production). Without it nobody becomes admin; registration never grants org access.
**Why:** task required no auto-admin for every sign-up; Clerk dev/prod user stores are separate.
**How to apply:** invites are DB rows claimed by verified email; revoked rows are never auto-restored. Run `pnpm --filter @workspace/api-server run check:access` after changing scoping rules.
