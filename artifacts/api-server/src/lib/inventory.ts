import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, items, itemCategories, units, warehouses, stockLevels, stockMovements, reorderAlerts, rooms, notifications } from "@workspace/db";
import type { Member } from "./education-access";
import { DomainError } from "./education-validation";
import { consumeChallenge, otpEnabled } from "./otp";
import { recordAudit } from "./audit";
import { syncOrganization } from "./legacy-sync";

/**
 * Inventory service. The database guarantees the invariants (append-only ledger, no negative stock, one open reorder alert
 * per item and warehouse, automatic alert opening/closing); this layer adds authorization, validation, notifications and audit.
 * Writes: super_admin, branch_manager and warehouse_keeper (own branch). Reads also: finance, coordinator, procurement_officer.
 */
const WRITE_ROLES: string[] = ["super_admin", "branch_manager", "warehouse_keeper"];
const READ_ROLES: string[] = [...WRITE_ROLES, "finance", "coordinator", "procurement_officer"];
/** Roles that may have no branch and then see every warehouse. */
const ORG_WIDE: string[] = ["finance", "procurement_officer"];

export const canReadInventory = (m: Member) => READ_ROLES.includes(m.role);
const inScope = (m: Member, branchId: number) => m.role === "super_admin" || m.branchId === branchId || (ORG_WIDE.includes(m.role) && m.branchId == null);
const deny = (msg = "ليست لديك صلاحية على هذا المستودع"): never => { throw new DomainError(msg, 403); };
const pgCode = (e: unknown) => ((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code);
const pgMessage = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message ?? "");

const positive = (v: unknown, what: string, max = 1e9) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > max) throw new DomainError(`${what} غير صحيحة`);
  return v;
};
const text = (v: unknown, what: string, max = 200, required = true) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s && required) throw new DomainError(`${what} مطلوب`);
  if (s.length > max) throw new DomainError(`${what} طويل جدًا`);
  return s || null;
};

async function loadWarehouse(id: unknown, m: Member, write: boolean) {
  if (!Number.isInteger(id)) throw new DomainError("المستودع غير صحيح");
  const [w] = await db.select().from(warehouses).where(eq(warehouses.id, id as number));
  if (!w || w.status !== "active") throw new DomainError("المستودع غير موجود", 404);
  if (!inScope(m, w.branchId) || (write && !WRITE_ROLES.includes(m.role))) deny();
  return w;
}

// ---------- Catalogue ---------------------------------------------------------------------------------------------
export async function listCatalogue(m: Member) {
  if (!canReadInventory(m)) deny();
  await syncOrganization();                                   // branches/rooms still live in the legacy records; mirror them (throttled)
  const [cats, uns, its, whs, rms] = await Promise.all([
    db.select().from(itemCategories).orderBy(asc(itemCategories.name)),
    db.select().from(units).orderBy(asc(units.name)),
    db.select().from(items).where(eq(items.isActive, true)).orderBy(asc(items.itemCode)),
    db.select().from(warehouses).where(eq(warehouses.status, "active")).orderBy(asc(warehouses.code)),
    db.select({ id: rooms.id, branchId: rooms.branchId, name: rooms.name, roomType: rooms.roomType }).from(rooms).where(eq(rooms.status, "active")).orderBy(asc(rooms.name)),
  ]);
  const branchRows = (await db.execute(sql`select id::int as id, name from branches where status = 'active' order by id`)).rows as { id: number; name: string }[];
  return {
    categories: cats, units: uns, items: its,
    warehouses: whs.filter((w) => inScope(m, w.branchId)),
    rooms: rms.filter((r) => inScope(m, r.branchId)),
    branches: branchRows.filter((b) => inScope(m, b.id)),
  };
}

/** Item codes look like LAB-0001: category code + a per-category counter that is never reused. */
export async function createItem(m: Member, input: { name?: unknown; categoryId?: unknown; unitId?: unknown; itemType?: unknown; description?: unknown }) {
  if (!WRITE_ROLES.includes(m.role)) deny("إنشاء الأصناف متاح للإدارة العليا ومديري الفروع وأمناء المستودعات");
  const name = text(input.name, "اسم الصنف")!;
  const itemType = typeof input.itemType === "string" ? input.itemType : "consumable";
  if (!["consumable", "asset", "service"].includes(itemType)) throw new DomainError("نوع الصنف غير صحيح");
  if (!Number.isInteger(input.categoryId) || !Number.isInteger(input.unitId)) throw new DomainError("اختر التصنيف والوحدة");
  return db.transaction(async (tx) => {
    const [cat] = await tx.select().from(itemCategories).where(eq(itemCategories.id, input.categoryId as number));
    const [unit] = await tx.select().from(units).where(eq(units.id, input.unitId as number));
    if (!cat || !unit) throw new DomainError("التصنيف أو الوحدة غير موجودة");
    const prefix = `ITM-${cat.code}`;
    const n = (await tx.execute(sql`insert into document_sequences (prefix, year, last_value) values (${prefix}, 0, 1)
      on conflict (prefix, year) do update set last_value = document_sequences.last_value + 1 returning last_value`)).rows[0] as { last_value: string };
    const itemCode = `${cat.code}-${String(n.last_value).padStart(4, "0")}`;
    const [row] = await tx.insert(items).values({ itemCode, name, categoryId: cat.id, unitId: unit.id, itemType, description: text(input.description, "الوصف", 500, false), createdBy: m.id }).returning();
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, action: "item.create", subjectType: "item", subjectId: row!.id, subjectNo: itemCode, after: { name, itemType } });
    return row!;
  });
}

// ---------- Reorder policy ----------------------------------------------------------------------------------------
/** The manager decides the minimum; changes are audited with the previous value. */
export async function setStockLevel(m: Member, input: { warehouseId?: unknown; itemId?: unknown; minQty?: unknown; maxQty?: unknown; reorderQty?: unknown; leadTimeDays?: unknown }) {
  const w = await loadWarehouse(input.warehouseId, m, true);
  if (!Number.isInteger(input.itemId)) throw new DomainError("الصنف غير صحيح");
  const minQty = typeof input.minQty === "number" && Number.isFinite(input.minQty) && input.minQty >= 0 && input.minQty <= 1e9 ? input.minQty : (() => { throw new DomainError("الحد الأدنى غير صحيح"); })();
  const maxQty = input.maxQty == null ? null : positive(input.maxQty, "الحد الأقصى");
  const reorderQty = input.reorderQty == null ? null : positive(input.reorderQty, "كمية إعادة الطلب");
  if (maxQty != null && maxQty < minQty) throw new DomainError("الحد الأقصى أقل من الحد الأدنى");
  const lead = input.leadTimeDays == null ? null : Number.isInteger(input.leadTimeDays) && (input.leadTimeDays as number) >= 0 && (input.leadTimeDays as number) <= 365 ? (input.leadTimeDays as number) : (() => { throw new DomainError("مدة التوريد غير صحيحة"); })();
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(items).where(eq(items.id, input.itemId as number));
    if (!item || !item.isActive) throw new DomainError("الصنف غير موجود", 404);
    const [prev] = await tx.select().from(stockLevels).where(and(eq(stockLevels.warehouseId, w.id), eq(stockLevels.itemId, item.id)));
    const values = { minQty, maxQty, reorderQty, leadTimeDays: lead, setBy: m.id, updatedAt: new Date() };
    const [row] = prev
      ? await tx.update(stockLevels).set(values).where(and(eq(stockLevels.warehouseId, w.id), eq(stockLevels.itemId, item.id))).returning()
      : await tx.insert(stockLevels).values({ warehouseId: w.id, itemId: item.id, ...values }).returning();
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: w.branchId, action: "stock_level.set", subjectType: "stock_level", subjectId: item.id, subjectNo: item.itemCode, before: prev ? { minQty: prev.minQty, maxQty: prev.maxQty, reorderQty: prev.reorderQty } : null, after: { minQty, maxQty, reorderQty } });
    await openAlertIfBelowMinimum(tx, w.id, item.id, minQty);
    return row!;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Changing the minimum can put an item below it without any movement; open the alert then (the trigger only fires on movements). */
async function openAlertIfBelowMinimum(tx: Tx, warehouseId: number, itemId: number, minQty: number) {
  const bal = Number((await tx.execute(sql`select coalesce(sum(qty_delta),0) as q from stock_movements where warehouse_id = ${warehouseId} and item_id = ${itemId}`)).rows[0]!.q);
  if (bal <= minQty) {
    await tx.execute(sql`insert into reorder_alerts (warehouse_id, item_id, qty_at_trigger, min_qty) values (${warehouseId}, ${itemId}, ${bal}, ${minQty})
      on conflict (warehouse_id, item_id) where status in ('open','in_progress') do nothing`);
    await notifyOpenAlerts(tx, warehouseId, itemId);
  }
}

/** Inbox message for every administrator and the branch manager, once per alert. The alert itself is opened by the database trigger. */
async function notifyOpenAlerts(tx: Tx, warehouseId: number, itemId: number) {
  await tx.execute(sql`insert into notifications (member_id, type, title, body, link, subject_type, subject_id)
    select m.id, 'reorder_alert', 'وصل صنف إلى الحد الأدنى: ' || i.name,
           'الرصيد ' || a.qty_at_trigger::text || ' والحد الأدنى ' || a.min_qty::text || ' في ' || w.name || '. أصدر طلب عرض سعر قبل نفاد الصنف.', '/inventory', 'reorder_alert', a.id
      from reorder_alerts a join items i on i.id = a.item_id join warehouses w on w.id = a.warehouse_id
      join org_members m on m.status = 'active' and (m.role = 'super_admin' or (m.role in ('branch_manager','warehouse_keeper','procurement_officer') and m.branch_id = w.branch_id) or (m.role = 'procurement_officer' and m.branch_id is null))
     where a.warehouse_id = ${warehouseId} and a.item_id = ${itemId} and a.status = 'open'
       and not exists (select 1 from notifications n where n.subject_type = 'reorder_alert' and n.subject_id = a.id and n.member_id = m.id)`);
}

// ---------- Movements ---------------------------------------------------------------------------------------------
export const MOVEMENT_TYPES = ["opening", "receipt", "issue", "adjustment"] as const;
export type MovementInput = {
  warehouseId?: unknown; itemId?: unknown; type?: unknown; qty?: unknown; unitCostHalalas?: unknown;
  roomId?: unknown; departmentId?: unknown; purpose?: unknown; direction?: unknown;
};

/** The document an OTP confirmation is bound to (the server hashes exactly this). */
export function movementSubject(i: MovementInput) {
  return { warehouseId: i.warehouseId, itemId: i.itemId, type: i.type, qty: i.qty, unitCostHalalas: i.unitCostHalalas ?? null, roomId: i.roomId ?? null, departmentId: i.departmentId ?? null, purpose: typeof i.purpose === "string" ? i.purpose.trim() : null, direction: i.direction ?? null };
}

export async function postMovement(m: Member, input: MovementInput, ctx: { challengeId?: string; userAgent?: string | null }) {
  const w = await loadWarehouse(input.warehouseId, m, true);
  const type = input.type as (typeof MOVEMENT_TYPES)[number];
  if (!MOVEMENT_TYPES.includes(type)) throw new DomainError("نوع الحركة غير صحيح");
  if (!Number.isInteger(input.itemId)) throw new DomainError("الصنف غير صحيح");
  const qty = positive(input.qty, "الكمية");
  const cost = input.unitCostHalalas == null ? null : Number.isInteger(input.unitCostHalalas) && (input.unitCostHalalas as number) >= 0 ? (input.unitCostHalalas as number) : (() => { throw new DomainError("تكلفة الوحدة غير صحيحة"); })();
  const purpose = text(input.purpose, "السبب/الغرض", 300, type === "adjustment" || type === "issue");
  let sign = type === "issue" ? -1 : 1;
  if (type === "adjustment") {
    if (input.direction !== "increase" && input.direction !== "decrease") throw new DomainError("حدد اتجاه التسوية");
    sign = input.direction === "decrease" ? -1 : 1;
  }
  let roomId: number | null = null;
  if (type === "issue") {
    if (!Number.isInteger(input.roomId) && !Number.isInteger(input.departmentId)) throw new DomainError("حدد القاعة أو القسم المستلم");
    roomId = Number.isInteger(input.roomId) ? (input.roomId as number) : null;
  }
  try {
    return await db.transaction(async (tx) => {
      const [item] = await tx.select().from(items).where(eq(items.id, input.itemId as number));
      if (!item || !item.isActive) throw new DomainError("الصنف غير موجود", 404);
      if (item.itemType !== "consumable") throw new DomainError("المخزون يخص الأصناف الاستهلاكية؛ الأصول تُسجَّل في سجل الأصول");
      if (roomId != null) {
        const [r] = await tx.select().from(rooms).where(eq(rooms.id, roomId));
        if (!r || r.branchId !== w.branchId) throw new DomainError("القاعة لا تتبع فرع المستودع");
      }
      if (type === "opening") {
        const [prior] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(and(eq(stockMovements.warehouseId, w.id), eq(stockMovements.itemId, item.id))).limit(1);
        if (prior) throw new DomainError("يوجد رصيد للصنف في هذا المستودع؛ استخدم التسوية بعد الجرد", 409);
      }
      const subject = movementSubject(input);
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "stock.movement", subject }) : null;
      const no = (await tx.execute(sql`select next_doc_no('MV') as n`)).rows[0] as { n: string };
      const [row] = await tx.insert(stockMovements).values({
        movementNo: no.n, warehouseId: w.id, itemId: item.id, movementType: type, qtyDelta: sign * qty, unitCostHalalas: cost,
        issuedToRoomId: roomId, issuedToDepartmentId: Number.isInteger(input.departmentId) ? (input.departmentId as number) : null, purpose, createdBy: m.id,
        otpChallengeId: otp?.challengeId ?? null,
      }).returning();
      await notifyOpenAlerts(tx, w.id, item.id);
      if (otp) await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: w.branchId, action: `stock.${type}`, subjectType: "stock_movement", subjectId: row!.id, subjectNo: row!.movementNo, after: subject, otp: { challengeId: otp.challengeId, sentAt: otp.sentAt, verifiedAt: otp.verifiedAt, sentIp: otp.sentIp, verifiedIp: otp.verifiedIp }, userAgent: ctx.userAgent, contentHash: otp.subjectHash });
      const bal = Number((await tx.execute(sql`select coalesce(sum(qty_delta),0) as q from stock_movements where warehouse_id = ${w.id} and item_id = ${item.id}`)).rows[0]!.q);
      return { movement: row!, balance: bal };
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    if (pgCode(e) === "23514" && /insufficient stock/.test(pgMessage(e))) throw new DomainError("الرصيد غير كافٍ لهذه الحركة", 409);
    throw e;
  }
}

// ---------- Reads -------------------------------------------------------------------------------------------------
export async function listBalances(m: Member, warehouseId: unknown) {
  const w = await loadWarehouse(warehouseId, m, false);
  const rows = (await db.execute(sql`
    select i.id::int as item_id, i.item_code, i.name, u.name as unit, coalesce(b.qty_on_hand, 0)::float8 as qty_on_hand,
           sl.min_qty::float8 as min_qty, sl.max_qty::float8 as max_qty, sl.reorder_qty::float8 as reorder_qty,
           coalesce(b.qty_on_hand, 0) <= coalesce(sl.min_qty, -1) as needs_reorder
      from items i join units u on u.id = i.unit_id
      left join v_stock_balances b on b.item_id = i.id and b.warehouse_id = ${w.id}
      left join stock_levels sl on sl.item_id = i.id and sl.warehouse_id = ${w.id}
     where i.is_active and i.item_type = 'consumable' and (b.item_id is not null or sl.item_id is not null)
     order by i.item_code`)).rows;
  return rows;
}

export async function listAlerts(m: Member) {
  if (!canReadInventory(m)) deny();
  const rows = (await db.execute(sql`
    select a.id::int as id, a.warehouse_id::int as warehouse_id, w.name as warehouse, a.item_id::int as item_id, i.item_code, i.name as item_name, a.qty_at_trigger::float8 as qty_at_trigger, a.min_qty::float8 as min_qty, a.status, a.opened_at, w.branch_id::int as branch_id
      from reorder_alerts a join warehouses w on w.id = a.warehouse_id join items i on i.id = a.item_id
     where a.status in ('open','in_progress') order by a.opened_at desc`)).rows as { branch_id: number }[];
  return rows.filter((r) => inScope(m, r.branch_id));
}

/** Monthly issued quantities per room/department/item: the consumption indicator. */
export async function consumption(m: Member, q: { warehouseId?: unknown; from?: unknown; to?: unknown }) {
  const w = await loadWarehouse(q.warehouseId, m, false);
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = iso(q.from) ?? "1970-01-01", to = iso(q.to) ?? "2999-12-31";
  return (await db.execute(sql`
    select to_char(m.month, 'YYYY-MM') as month, m.room_id::int as room_id, r.name as room, m.department_id::int as department_id, i.item_code, i.name as item_name, m.qty_issued::float8 as qty_issued, m.indicative_cost_halalas::float8 as indicative_cost_halalas
      from v_consumption_monthly m join items i on i.id = m.item_id left join rooms r on r.id = m.room_id
     where m.branch_id = ${w.branchId} and m.month between ${from}::date and ${to}::date order by m.month desc, i.item_code`)).rows;
}

export async function listNotifications(m: Member) {
  return db.select().from(notifications).where(eq(notifications.memberId, m.id)).orderBy(desc(notifications.createdAt)).limit(50);
}
export async function markNotificationRead(m: Member, id: number) {
  const r = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.memberId, m.id))).returning({ id: notifications.id });
  if (!r.length) throw new DomainError("الإشعار غير موجود", 404);
}
