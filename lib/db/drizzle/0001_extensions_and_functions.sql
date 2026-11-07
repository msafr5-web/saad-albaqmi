-- Extensions and pure functions required by the relational schema (applied BEFORE the tables are created).
-- pgcrypto: SHA-256 for the audit hash chain. btree_gist: exclusion constraints (no double booking).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Saudi VAT split. All three amounts are integers in halalas and share one rounding rule (half away from zero).
--   inclusive = true : `price` already contains VAT  -> net = price / (1 + rate), gross = price
--   inclusive = false: `price` is the net price       -> net = price,            gross = price + VAT
CREATE OR REPLACE FUNCTION vat_net(price bigint, vat_rate numeric, inclusive boolean)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN inclusive THEN round(price::numeric / (1 + vat_rate / 100.0))::bigint ELSE price END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vat_gross(price bigint, vat_rate numeric, inclusive boolean)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN inclusive THEN price ELSE price + round(price::numeric * vat_rate / 100.0)::bigint END
$$;
--> statement-breakpoint

-- Gap-free document numbers such as PO-2026-000123. The row lock is held until the calling transaction ends,
-- so a rolled-back transaction never burns a number.
CREATE OR REPLACE FUNCTION next_doc_no(p_prefix text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  y int := extract(year FROM now())::int;
  n bigint;
BEGIN
  INSERT INTO document_sequences (prefix, year, last_value) VALUES (p_prefix, y, 1)
  ON CONFLICT (prefix, year) DO UPDATE SET last_value = document_sequences.last_value + 1
  RETURNING last_value INTO n;
  RETURN p_prefix || '-' || y || '-' || lpad(n::text, 6, '0');
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END
$$;
