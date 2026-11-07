import { bigint, integer, timestamp, numeric, type AnyPgColumn } from "drizzle-orm/pg-core";
import { orgMembers } from "./education";
import { sql } from "drizzle-orm";

/**
 * Conventions for the relational (normalized) schema:
 *  - Primary keys are `bigint GENERATED ALWAYS AS IDENTITY`.
 *  - Money is stored as integer halalas (1 SAR = 100 halalas) in `*_halalas` bigint columns. Never floats.
 *  - Quantities are `numeric(14,3)`; rates/percentages are `numeric(6,3)`.
 *  - Status/type columns are `text` with CHECK constraints (easier to evolve than ENUM types).
 *  - Foreign keys are RESTRICT by default (financial history must not vanish); child line tables CASCADE.
 *  - Every mutable table has created_at/updated_at (updated_at maintained by a trigger, see migration 0003).
 */
export const pk = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
export const fkCol = (name: string) => bigint(name, { mode: "number" });
export const halalas = (name: string) => bigint(name, { mode: "number" });
export const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "number" });
export const rate = (name: string) => numeric(name, { precision: 6, scale: 3, mode: "number" });

/** VAT helpers implemented in SQL (migration 0001) so generated columns and queries share one rounding rule. */
export const vatNet = (price: string, vatRate: string, inclusive: string) => sql.raw(`vat_net(${price}, ${vatRate}, ${inclusive})`);
export const vatGross = (price: string, vatRate: string, inclusive: string) => sql.raw(`vat_gross(${price}, ${vatRate}, ${inclusive})`);

/** Reference to the application account (legacy org_members table, integer serial id). */
export const memberFk = (name: string) => integer(name).references(() => orgMembers.id);

export type PgRef = () => AnyPgColumn;
