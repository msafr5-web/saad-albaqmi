// Applies every pending migration in lib/db/drizzle to DATABASE_URL, in order, inside drizzle's journal.
// Safe to run repeatedly. Run it BEFORE deploying code that uses new tables.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const dir = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(dir, "../drizzle") });
  console.log("Migrations applied.");
} finally {
  await pool.end();
}
