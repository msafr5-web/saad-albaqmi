import { defineConfig } from "drizzle-kit";

/**
 * Run drizzle-kit from lib/db (the pnpm scripts do). Paths are relative to that directory.
 * `generate` needs no database; `push`/`studio` need DATABASE_URL.
 * DB_SCHEMA_ENTRY lets `generate` read a subset of the schema (used once to create the legacy baseline migration).
 */
export default defineConfig({
  schema: process.env.DB_SCHEMA_ENTRY ?? "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/saad_albaqmi" },
});
