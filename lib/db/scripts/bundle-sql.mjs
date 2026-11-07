// Concatenates the versioned migrations into ONE standalone script that builds the whole database on an empty PostgreSQL 15+ server:
//   node scripts/bundle-sql.mjs > docs/database/saad_albaqmi_full.sql
//   psql -U postgres -c 'CREATE DATABASE saad_albaqmi ENCODING UTF8 TEMPLATE template0'
//   psql -U postgres -d saad_albaqmi -f docs/database/saad_albaqmi_full.sql
// Day-to-day work should still use `pnpm --filter @workspace/db run migrate`, which also records the journal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta/_journal.json"), "utf8"));
const parts = journal.entries.map((e) => `-- ===== ${e.tag} =====\n` + fs.readFileSync(path.join(dir, `${e.tag}.sql`), "utf8").replace(/\r\n/g, "\n").replace(/^\s*--> statement-breakpoint\s*$/gm, "").replace(/--> statement-breakpoint/g, ""));
process.stdout.write(`-- saad_albaqmi: complete schema (tables, constraints, triggers, views, reference data, Arabic table comments).
-- Generated from lib/db/drizzle by lib/db/scripts/bundle-sql.mjs. Requires PostgreSQL 15+ with the pgcrypto and btree_gist extensions.
-- Run inside the database "saad_albaqmi" (CREATE DATABASE saad_albaqmi ENCODING 'UTF8' TEMPLATE template0).
${String.raw`\set ON_ERROR_STOP on`}
BEGIN;
${parts.join("\n")}
COMMIT;
`);
