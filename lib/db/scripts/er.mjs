// Generates the database documentation FROM THE LIVE DATABASE (never drawn by hand), so it always matches reality:
//   docs/database/er/overview.mmd            domain map (foreign keys between domains)
//   docs/database/er/<domain>.mmd            one full ER diagram per domain (all columns, keys, cardinality)
//   docs/database/er/full-map.mmd            every table and every relationship on one canvas (keys only)
//   docs/database/saad_albaqmi.dbml          complete schema for dbdiagram.io / DBML tools
//   docs/database/data-dictionary.md         tables, columns, keys, checks, indexes, Arabic purpose
// Usage: DATABASE_URL=postgres://... node scripts/er.mjs [outDir]      (render .mmd to SVG/PNG with mermaid-cli, see docs/database.md)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DOMAINS, TABLE_DOMAIN, TABLE_COMMENT } from "./table-comments.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "../../../docs/database"));
fs.mkdirSync(path.join(out, "er"), { recursive: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const q = async (text) => (await c.query(text)).rows;

// ---- introspection ----------------------------------------------------------------------------------------------------
const tables = (await q(`select c.relname name, obj_description(c.oid) comment from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`));
const names = tables.map((t) => t.name);
const unmapped = names.filter((n) => !TABLE_DOMAIN.has(n));
if (unmapped.length) throw new Error(`Tables without a domain/description in scripts/table-comments.mjs: ${unmapped.join(", ")}`);
const columns = (await c.query(`select table_name t, column_name c, ordinal_position pos, data_type, udt_name, character_maximum_length len, numeric_precision p, numeric_scale s, is_nullable = 'YES' nullable, column_default def, is_identity = 'YES' ident, is_generated = 'ALWAYS' gen, generation_expression genexpr
  from information_schema.columns where table_schema = 'public' and table_name = any($1::text[]) order by table_name, ordinal_position`, [names])).rows;
const cons = await q(`select rel.relname t, con.conname name, con.contype type, pg_get_constraintdef(con.oid) def, con.confdeltype del, ref.relname ref,
    (select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) cols,
    (select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) refcols
  from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace n on n.oid = rel.relnamespace left join pg_class ref on ref.oid = con.confrelid where n.nspname = 'public' order by 1, 2`);
const indexes = await q(`select tablename t, indexname name, indexdef def from pg_indexes where schemaname = 'public' order by 1, 2`);
const views = await q(`select viewname name from pg_views where schemaname = 'public' order by 1`);
const triggers = await q(`select event_object_table t, trigger_name name, action_timing || ' ' || string_agg(event_manipulation, '/') ev from information_schema.triggers where trigger_schema = 'public' group by 1, 2, action_timing order by 1, 2`);

const colsOf = new Map(names.map((n) => [n, columns.filter((x) => x.t === n)]));
const pk = new Map(); const uniq = new Map(); const fks = [];
for (const k of cons) {
  if (k.type === "p") pk.set(k.t, k.cols);
  if (k.type === "u" && k.cols.length === 1) uniq.set(`${k.t}.${k.cols[0]}`, true);
  if (k.type === "f") fks.push({ child: k.t, cols: k.cols, parent: k.ref, parentCols: k.refcols, name: k.name, onDelete: { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" }[k.del] });
}
for (const i of indexes) { const m = /CREATE UNIQUE INDEX \S+ ON public\.(\S+) USING btree \((\w+)\)$/.exec(i.def); if (m) uniq.set(`${m[1]}.${m[2]}`, true); }   // unique and not partial
const nullable = (t, col) => colsOf.get(t).find((x) => x.c === col).nullable;
const isFk = new Set(fks.flatMap((f) => f.cols.map((col) => `${f.child}.${col}`)));

const ty = (x) => {
  const u = x.udt_name;
  if (u === "int8") return "bigint"; if (u === "int4") return "int"; if (u === "int2") return "smallint";
  if (u === "numeric") return x.p ? `numeric(${x.p},${x.s})` : "numeric";
  if (u === "timestamptz") return "timestamptz"; if (u === "timestamp") return "timestamp";
  if (u === "text" || u === "varchar") return x.len ? `varchar(${x.len})` : "text";
  if (x.data_type === "ARRAY") return `${u.replace(/^_/, "")}[]`;
  return u;
};
const flags = (t, col) => [pk.get(t)?.includes(col) ? "PK" : null, isFk.has(`${t}.${col}`) ? "FK" : null, uniq.has(`${t}.${col}`) && !pk.get(t)?.includes(col) ? "UK" : null].filter(Boolean).join(",");
const domainOf = (t) => TABLE_DOMAIN.get(t);
const domainTitle = new Map(DOMAINS.map(([id, title]) => [id, title]));

// ---- Mermaid ----------------------------------------------------------------------------------------------------------------
const mmdSafe = (s) => s.replace(/["<>]/g, " ").trim();
// Audit/user columns (created_by, approved_by, ...) all point to org_members; drawing them would bury the real structure, so diagrams
// omit those edges (the data dictionary lists every one of them).
const USER_TABLE = "org_members";
function entity(t, { keysOnly = false, stub = false } = {}) {
  const rows = colsOf.get(t).filter((x) => !stub || pk.get(t)?.includes(x.c)).filter((x) => !keysOnly || flags(t, x.c)).map((x) => {
    const f = flags(t, x.c).replace(/,/g, ", ");
    return `    ${ty(x).replace(/[(),\[\]]/g, "_")} ${x.c}${f ? " " + f : ""}${x.gen ? ' "generated"' : ""}`;
  });
  return `  ${t} {\n${rows.join("\n")}\n  }`;
}
function relation(f) {
  const optional = f.cols.some((col) => nullable(f.child, col));
  const oneToOne = f.cols.length === 1 && (uniq.get(`${f.child}.${f.cols[0]}`) || pk.get(f.child)?.join() === f.cols[0]);
  const left = optional ? "|o" : "||";                      // parent side: exactly one / zero-or-one
  const right = oneToOne ? "o|" : "o{";                     // child side
  return `  ${f.parent} ${left}--${right} ${f.child} : "${f.cols.join('+')}"`;
}
function diagram(tablesIn, opts = {}) {
  const set = new Set(tablesIn);
  const rels = fks.filter((f) => (set.has(f.child) || (opts.all && set.has(f.parent))) && (f.parent !== USER_TABLE || opts.keepUsers));
  const external = new Set(rels.flatMap((f) => [f.child, f.parent]).filter((t) => !set.has(t)));
  const lines = ["erDiagram", ...tablesIn.map((t) => entity(t, opts)), ...[...external].map((t) => entity(t, { stub: true })), ...[...new Set(rels.map(relation))]];
  return lines.join("\n") + "\n";
}

const domainTables = new Map(DOMAINS.map(([id]) => [id, names.filter((n) => domainOf(n) === id)]));
for (const [id, list] of domainTables) fs.writeFileSync(path.join(out, "er", `${id}.mmd`), `%% ${domainTitle.get(id)} - edges to org_members (created_by/approved_by/...) are omitted
` + diagram(list, { keepUsers: id === "legacy" }));
fs.writeFileSync(path.join(out, "er", "full-map.mmd"), "%% Every table and relationship (key columns only)\n" + diagram(names, { keysOnly: true, all: true }));

// domain overview: number of foreign keys between domains
const edge = new Map();
for (const f of fks) { const a = domainOf(f.child), b = domainOf(f.parent); if (a !== b) edge.set(`${a}>${b}`, (edge.get(`${a}>${b}`) ?? 0) + 1); }
const overview = ["flowchart LR", ...DOMAINS.map(([id, title]) => `  ${id}["${mmdSafe(title) || id}<br/>(${domainTables.get(id).length} جدولًا)"]`),
  ...[...edge].map(([k, n]) => { const [a, b] = k.split(">"); return `  ${a} -- "${n} FK" --> ${b}`; })];
fs.writeFileSync(path.join(out, "er", "overview.mmd"), overview.join("\n") + "\n");

// ---- DBML ---------------------------------------------------------------------------------------------------------------------
const dbml = [`// ${names.length} tables. Generated from the live database by lib/db/scripts/er.mjs — do not edit by hand.`, `Project saad_albaqmi { database_type: 'PostgreSQL' }`, ""];
for (const [id, title] of DOMAINS) dbml.push(`TableGroup ${id} { ${domainTables.get(id).join(" ")} } // ${title}`);
dbml.push("");
for (const t of names) {
  dbml.push(`Table ${t} {`);
  for (const x of colsOf.get(t)) {
    const s = [pk.get(t)?.includes(x.c) && pk.get(t).length === 1 ? "pk" : null, !x.nullable && !pk.get(t)?.includes(x.c) ? "not null" : null, uniq.has(`${t}.${x.c}`) && !pk.get(t)?.includes(x.c) ? "unique" : null, x.ident ? "increment" : null,
      x.def && !x.ident ? `default: \`${x.def.replace(/`/g, "")}\`` : null, x.gen ? `note: 'generated: ${String(x.genexpr).replace(/'/g, "")}'` : null].filter(Boolean);
    dbml.push(`  ${x.c} ${ty(x).replace(/\[\]/, "[]")}${s.length ? ` [${s.join(", ")}]` : ""}`);
  }
  if (pk.get(t)?.length > 1) dbml.push(`  indexes { (${pk.get(t).join(", ")}) [pk] }`);
  dbml.push(`  Note: '${(TABLE_COMMENT.get(t) ?? "").replace(/'/g, "")}'`, "}", "");
}
for (const f of fks) dbml.push(`Ref: ${f.child}.${f.cols.length === 1 ? f.cols[0] : `(${f.cols.join(", ")})`} > ${f.parent}.${f.parentCols.length === 1 ? f.parentCols[0] : `(${f.parentCols.join(", ")})`} [delete: ${f.onDelete.toLowerCase()}]`);
fs.writeFileSync(path.join(out, "saad_albaqmi.dbml"), dbml.join("\n") + "\n");

// ---- Data dictionary -----------------------------------------------------------------------------------------------------------
const md = [`# قاموس بيانات قاعدة \`saad_albaqmi\``, "",
  `مولَّد آليًا من القاعدة الحية بواسطة \`lib/db/scripts/er.mjs\`؛ لا يُعدَّل يدويًا. **${names.length} جدولًا، ${fks.length} علاقة (مفتاح أجنبي)، ${views.length} عروضًا، ${triggers.length} محفّزًا.**`, "",
  "الرموز: **PK** مفتاح أساسي، **FK** مفتاح أجنبي، **UK** فريد. المبالغ بالهللات (`*_halalas`) والكميات `numeric(14,3)`.", "",
  "## فهرس المجالات", "", "| المجال | الجداول |", "|---|---|", ...DOMAINS.map(([id, title]) => `| ${title} | ${domainTables.get(id).map((t) => `[\`${t}\`](#${t})`).join("، ")} |`), ""];
for (const [id, title] of DOMAINS) {
  md.push(`## ${title}`, "", `المخطط: \`er/${id}.mmd\` (و\`er/${id}.svg\` عند التوليد).`, "");
  for (const t of domainTables.get(id)) {
    md.push(`### ${t}`, "", TABLE_COMMENT.get(t), "", "| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |", "|---|---|---|---|---|---|");
    for (const x of colsOf.get(t)) {
      const f = fks.find((k) => k.child === t && k.cols.includes(x.c));
      md.push(`| \`${x.c}\` | ${ty(x)} | ${x.nullable ? "نعم" : "لا"} | ${x.gen ? `مولَّد: \`${String(x.genexpr).replace(/\|/g, "\\|")}\`` : x.ident ? "هوية تلقائية" : x.def ? `\`${x.def.replace(/\|/g, "\\|")}\`` : ""} | ${flags(t, x.c)} | ${f ? `\`${f.parent}.${f.parentCols[f.cols.indexOf(x.c)]}\` (${f.onDelete})` : ""} |`);
    }
    const checks = cons.filter((k) => k.t === t && k.type === "c"), uq = cons.filter((k) => k.t === t && k.type === "u" && k.cols.length > 1);
    if (pk.get(t)?.length > 1) md.push("", `**مفتاح أساسي مركّب:** (${pk.get(t).join(", ")})`);
    if (uq.length) md.push("", ...uq.map((k) => `- فريد مركّب: (${k.cols.join(", ")})`));
    if (checks.length) md.push("", "**قيود التحقق:**", ...checks.map((k) => `- \`${k.name}\`: \`${k.def.replace(/^CHECK /, "").replace(/\|/g, "\\|")}\``));
    const idx = indexes.filter((i) => i.t === t && !cons.some((k) => k.name === i.name));
    if (idx.length) md.push("", "**الفهارس:**", ...idx.map((i) => `- \`${i.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\.\S+ USING /, (m, u) => (u ? "فريد " : "") )}\``));
    const trg = triggers.filter((r) => r.t === t); if (trg.length) md.push("", "**محفّزات:** " + trg.map((r) => `\`${r.name}\` (${r.ev})`).join("، "));
    md.push("");
  }
}
md.push("## عروض التقارير", "", views.map((v) => `- \`${v.name}\``).join("\n"), "");
fs.writeFileSync(path.join(out, "data-dictionary.md"), md.join("\n"));

fs.writeFileSync(path.join(out, "model.json"), JSON.stringify({
  stats: { tables: names.length, relationships: fks.length, views: views.map((v) => v.name), triggers: triggers.length },
  domains: DOMAINS.map(([id, title]) => ({ id, title, tables: domainTables.get(id).map((t) => ({ name: t, comment: TABLE_COMMENT.get(t), columns: colsOf.get(t).length, references: [...new Set(fks.filter((f) => f.child === t).map((f) => f.parent))] })) })),
}, null, 1));
console.log(JSON.stringify({ tables: names.length, relationships: fks.length, views: views.length, triggers: triggers.length, domains: DOMAINS.length, out }));
await c.end();
