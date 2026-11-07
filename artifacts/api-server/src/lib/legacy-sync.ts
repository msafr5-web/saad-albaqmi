import { sql } from "drizzle-orm";
import { db, ORG_OWNER_ID } from "@workspace/db";

/**
 * One-way bridge from the legacy JSONB records (the source of truth for branches and rooms until the full migration) to the
 * relational tables that inventory and procurement use. Relational rows get THE SAME ID as the legacy record, so a member's
 * branch scope (org_members.branch_id = legacy branch record id) keeps working without a mapping table. Safe to run repeatedly.
 * Also guarantees one warehouse per branch (business decision) and repairs the identity sequences after explicit-id inserts.
 */
const ROOM_TYPES: Record<string, string> = { "قاعة": "classroom", "نظري": "classroom", "معمل": "lab", "عملي": "lab", "ورشة": "workshop", "مكتب": "office" };
const num = (v: unknown, min: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n >= min ? n : fallback; };

let lastRun = 0;

export async function syncOrganization(opts: { force?: boolean } = {}) {
  if (!opts.force && Date.now() - lastRun < 60_000) return null;      // catalogue reads call this; do the work at most once a minute per instance
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('legacy-sync'))`);
    const rows = (await tx.execute(sql`select id, kind, name, branch_id, status, details from education_records where owner_id = ${ORG_OWNER_ID} and kind in ('branch','room') order by id`)).rows as
      { id: number; kind: string; name: string; branch_id: number | null; status: string; details: Record<string, unknown> }[];
    let branchCount = 0, roomCount = 0;
    const hasHead = Number((await tx.execute(sql`select count(*)::int as n from branches where is_head_office`)).rows[0]!.n) > 0;
    let headAssigned = hasHead;
    for (const r of rows.filter((x) => x.kind === "branch")) {
      const head = !headAssigned && /المركز الرئيسي/.test(r.name);
      if (head) headAssigned = true;
      await tx.execute(sql`insert into branches (id, code, name, city, is_head_office, status) overriding system value
        values (${r.id}, ${"BR-" + r.id}, ${r.name}, ${String(r.details.city ?? "—")}, ${head}, ${r.status === "closed" ? "inactive" : "active"})
        on conflict (id) do update set name = excluded.name, city = excluded.city, status = excluded.status`);
      branchCount++;
    }
    const branchIds = new Set(rows.filter((x) => x.kind === "branch").map((x) => x.id));
    for (const r of rows.filter((x) => x.kind === "room")) {
      if (r.branch_id == null || !branchIds.has(r.branch_id)) continue;
      const type = ROOM_TYPES[String(r.details.type ?? "")] ?? "classroom";
      await tx.execute(sql`insert into rooms (id, branch_id, code, name, room_type, area_m2, capacity, power_kw, status) overriding system value
        values (${r.id}, ${r.branch_id}, ${"RM-" + r.id}, ${r.name}, ${type}, ${num(r.details.area, 0.01, 1)}, ${Math.max(1, Math.floor(num(r.details.capacity, 1, 1)))}, ${r.details.powerKw == null ? null : num(r.details.powerKw, 0, 0)},
                ${r.status === "maintenance" ? "maintenance" : r.status === "closed" ? "inactive" : "active"})
        on conflict (id) do update set name = excluded.name, room_type = excluded.room_type, area_m2 = excluded.area_m2, capacity = excluded.capacity, power_kw = excluded.power_kw, status = excluded.status`);
      roomCount++;
    }
    const wh = await tx.execute(sql`insert into warehouses (branch_id, code, name)
      select b.id, 'WH-' || b.code, 'مستودع ' || b.name from branches b where not exists (select 1 from warehouses w where w.branch_id = b.id)`);
    await tx.execute(sql`select setval(pg_get_serial_sequence('branches', 'id'), greatest((select coalesce(max(id), 1) from branches), 1))`);
    await tx.execute(sql`select setval(pg_get_serial_sequence('rooms', 'id'), greatest((select coalesce(max(id), 1) from rooms), 1))`);
    return { branches: branchCount, rooms: roomCount, warehousesCreated: wh.rowCount ?? 0 };
  });
  lastRun = Date.now();
  return out;
}
