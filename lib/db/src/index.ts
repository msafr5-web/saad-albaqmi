import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const int = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isInteger(n) && n > 0 ? n : fallback; };

/**
 * Serverless functions open one pool per instance, so keep it small (DB_POOL_MAX, default 5) and fail fast instead of
 * hanging. Use your provider's pooled connection string (pgbouncer / Neon pooler) in production.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: int("DB_POOL_MAX", 5),
  idleTimeoutMillis: int("DB_IDLE_TIMEOUT_MS", 10_000),
  connectionTimeoutMillis: int("DB_CONNECT_TIMEOUT_MS", 5_000),
  statement_timeout: int("DB_STATEMENT_TIMEOUT_MS", 15_000),
});
// An idle client erroring must not crash the process.
pool.on("error", (err) => { console.error("postgres pool error", err.message); });
export const db = drizzle(pool, { schema });

export * from "./schema";
