import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, branches, itemCategories, orgMembers, notifications, reorderAlerts, rooms, units, warehouses, pool } from "@workspace/db";
import { syncOrganization } from "../src/lib/legacy-sync";
import { consumption, createItem, listAlerts, listBalances, listNotifications, markNotificationRead, postMovement, setStockLevel } from "../src/lib/inventory";
import { DomainError } from "../src/lib/education-validation";
import type { Member } from "../src/lib/education-access";

/** Integration test for the inventory service on a MIGRATED scratch/CI database (ALLOW_DB_TESTS=1). */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
delete process.env.OTP_FINANCE_REQUIRED;

const stamp = Date.now();
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError, `${label}: not a DomainError (${(e as Error).message})`); assert.equal(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`); return e as DomainError; }
  assert.fail(`${label}: expected failure ${status}`);
};
const mk = async (n: string, role: string, branchId: number | null): Promise<Member> => {
  const [r] = await db.insert(orgMembers).values({ email: `inv-${n}-${stamp}@example.test`, role, status: "active", branchId, clerkUserId: `u_${n}_${stamp}` }).returning();
  return { id: r!.id, clerkUserId: r!.clerkUserId!, email: r!.email, role: role as Member["role"], branchId, linkedRecordId: null };
};

async function main() {
  // legacy -> relational bridge keeps ids, creates one warehouse per branch, is idempotent, and repairs the identity sequence
  const legacy = async (kind: string, name: string, branchId: number | null, details: object) =>
    (await pool.query("insert into education_records (owner_id, kind, name, branch_id, status, details) values ('org:main',$1,$2,$3,'نشط',$4) returning id", [kind, name, branchId, JSON.stringify(details)])).rows[0].id as number;
  const lb = await legacy("branch", `فرع قديم ${stamp}`, null, { city: "الدمام", budget: 1000 });
  const lr = await legacy("room", `معمل قديم ${stamp}`, lb, { type: "عملي", area: 55, capacity: 18, powerKw: 7 });
  const first = (await syncOrganization({ force: true }))!;
  assert.ok(first.branches >= 1 && first.rooms >= 1);
  const rb = (await pool.query("select id::int, city, status from branches where id = $1", [lb])).rows[0]; assert.equal(rb.city, "الدمام");
  const rr = (await pool.query("select id::int, branch_id::int, room_type, capacity from rooms where id = $1", [lr])).rows[0]; assert.deepEqual([rr.branch_id, rr.room_type, rr.capacity], [lb, "lab", 18]);
  assert.equal((await pool.query("select count(*)::int n from warehouses where branch_id = $1", [lb])).rows[0].n, 1, "one warehouse per branch");
  const again = (await syncOrganization({ force: true }))!; assert.equal(again.warehousesCreated, 0, "idempotent");
  await pool.query("update education_records set name = $1 where id = $2", [`فرع معدّل ${stamp}`, lb]); await syncOrganization({ force: true });
  assert.equal((await pool.query("select name from branches where id = $1", [lb])).rows[0].name, `فرع معدّل ${stamp}`, "renames propagate");
  await pool.query("insert into branches (code, name, city) values ($1, 'يدوي', 'x')", [`SEQ${stamp}`]);       // would fail with a duplicate key if the sequence were not repaired

  const [brA] = await db.insert(branches).values({ code: `IA${stamp}`, name: "فرع أ", city: "الرياض" }).returning();
  const [brB] = await db.insert(branches).values({ code: `IB${stamp}`, name: "فرع ب", city: "جدة" }).returning();
  const [whA] = await db.insert(warehouses).values({ branchId: brA!.id, code: `WA${stamp}`, name: "مستودع أ" }).returning();
  const [roomA] = await db.insert(rooms).values({ branchId: brA!.id, code: "R1", name: "معمل 1", roomType: "lab", areaM2: 40, capacity: 20 }).returning();
  const [roomB] = await db.insert(rooms).values({ branchId: brB!.id, code: "R1", name: "معمل ب", roomType: "lab", areaM2: 40, capacity: 20 }).returning();
  const keeper = await mk("keeper", "warehouse_keeper", brA!.id), buyerA = await mk("buyerA", "procurement_officer", brA!.id), buyerHQ = await mk("buyerHQ", "procurement_officer", null), buyerB = await mk("buyerB", "procurement_officer", brB!.id);
  const admin = await mk("admin", "super_admin", null), mgrA = await mk("mgrA", "branch_manager", brA!.id), mgrB = await mk("mgrB", "branch_manager", brB!.id), coord = await mk("coord", "coordinator", brA!.id);
  const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.code, "LAB")); const [unit] = await db.select().from(units).limit(1);

  // items: only administrators and branch managers create them; codes are sequential per category
  await fails(createItem(coord, { name: "x", categoryId: cat!.id, unitId: unit!.id }), 403, "coordinator cannot create items");
  const i1 = await createItem(mgrA, { name: "كواشف", categoryId: cat!.id, unitId: unit!.id });
  const i2 = await createItem(mgrA, { name: "قفازات", categoryId: cat!.id, unitId: unit!.id });
  assert.match(i1.itemCode, /^LAB-\d{4}$/); assert.equal(Number(i2.itemCode.slice(-4)), Number(i1.itemCode.slice(-4)) + 1);
  await fails(createItem(mgrA, { name: "", categoryId: cat!.id, unitId: unit!.id }), 400, "empty name");

  // scoping: another branch's manager cannot touch this warehouse
  await fails(setStockLevel(mgrB, { warehouseId: whA!.id, itemId: i1.id, minQty: 5 }), 403, "other branch");
  await fails(postMovement(mgrB, { warehouseId: whA!.id, itemId: i1.id, type: "opening", qty: 1 }, {}), 403, "other branch movement");
  await fails(postMovement(coord, { warehouseId: whA!.id, itemId: i1.id, type: "opening", qty: 1 }, {}), 403, "coordinator is read-only");
  await fails(postMovement(buyerA, { warehouseId: whA!.id, itemId: i1.id, type: "opening", qty: 1 }, {}), 403, "procurement officers do not move stock");
  const k = await postMovement(keeper, { warehouseId: whA!.id, itemId: i2.id, type: "opening", qty: 4 }, {}); assert.equal(k.balance, 4);   // the warehouse keeper can

  // opening balance once, minimum set, no alert yet
  const open = await postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "opening", qty: 10, unitCostHalalas: 500 }, {});
  assert.equal(open.balance, 10); assert.match(open.movement.movementNo, /^MV-\d{4}-\d{6}$/);
  await fails(postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "opening", qty: 5 }, {}), 409, "second opening balance");
  await setStockLevel(mgrA, { warehouseId: whA!.id, itemId: i1.id, minQty: 5, reorderQty: 20 });
  assert.equal((await listAlerts(mgrA)).filter((a) => a.warehouse_id === whA!.id).length, 0);
  await fails(setStockLevel(mgrA, { warehouseId: whA!.id, itemId: i1.id, minQty: 9, maxQty: 3 }), 400, "max below min");

  // issue validation
  await fails(postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "issue", qty: 1, purpose: "تجربة" }, {}), 400, "issue needs a target");
  await fails(postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "issue", qty: 1, roomId: roomB!.id, purpose: "تجربة" }, {}), 400, "room of another branch");
  await fails(postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "issue", qty: 100, roomId: roomA!.id, purpose: "تجربة" }, {}), 409, "not enough stock");

  // issuing below the minimum opens ONE alert and notifies administrators and the branch manager only
  const out = await postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "issue", qty: 6, roomId: roomA!.id, purpose: "تجربة عملية" }, {});
  assert.equal(out.balance, 4);
  const alerts = (await db.select().from(reorderAlerts).where(eq(reorderAlerts.warehouseId, whA!.id)));
  assert.equal(alerts.length, 1); assert.equal(alerts[0]!.status, "open");
  const inbox = (m: Member) => listNotifications(m).then((r) => r.filter((n) => n.type === "reorder_alert" && n.subjectId === alerts[0]!.id));
  assert.equal((await inbox(mgrA)).length, 1); assert.equal((await inbox(admin)).length, 1); assert.equal((await inbox(mgrB)).length, 0, "other branch manager must not be notified");
  assert.equal((await inbox(buyerA)).length, 1, "branch procurement officer is notified"); assert.equal((await inbox(buyerHQ)).length, 1, "head-office procurement officer is notified"); assert.equal((await inbox(buyerB)).length, 0);
  assert.equal((await inbox(keeper)).length, 1, "warehouse keeper is notified");
  await postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "issue", qty: 1, roomId: roomA!.id, purpose: "تجربة ثانية" }, {});
  assert.equal((await db.select().from(reorderAlerts).where(eq(reorderAlerts.warehouseId, whA!.id))).length, 1, "still one alert");
  assert.equal((await inbox(mgrA)).length, 1, "no duplicate notification");
  const note = (await inbox(mgrA))[0]!; await markNotificationRead(mgrA, note.id);
  await fails(markNotificationRead(mgrB, note.id), 404, "another member cannot mark it read");

  // balances, alerts view, consumption indicator
  const bal = (await listBalances(mgrA, whA!.id)).find((r) => (r as { item_id: number }).item_id === i1.id) as { qty_on_hand: number; needs_reorder: boolean };
  assert.deepEqual([bal.qty_on_hand, bal.needs_reorder], [3, true]);
  assert.ok((await listAlerts(coord)).some((a) => a.warehouse_id === whA!.id));
  const cons = (await consumption(mgrA, { warehouseId: whA!.id })) as { qty_issued: number; room: string }[];
  assert.equal(cons.reduce((a, r) => a + r.qty_issued, 0), 7); assert.equal(cons[0]!.room, "معمل 1");

  // receiving stock closes the alert; adjustments need a reason and a direction
  await postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "receipt", qty: 20 }, {});
  assert.equal((await db.select().from(reorderAlerts).where(eq(reorderAlerts.warehouseId, whA!.id)))[0]!.status, "closed");
  await fails(postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "adjustment", qty: 2, direction: "decrease" }, {}), 400, "adjustment needs a reason");
  await postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "adjustment", qty: 2, direction: "decrease", purpose: "فرق جرد" }, {});

  // lowering the stock level below the current balance (no movement) opens the alert immediately
  const i3 = await createItem(admin, { name: "ورق", categoryId: cat!.id, unitId: unit!.id });
  await setStockLevel(admin, { warehouseId: whA!.id, itemId: i3.id, minQty: 3 });
  assert.ok((await listAlerts(admin)).some((a) => a.item_id === i3.id), "never-stocked item with a minimum raises an alert");

  // OTP: with the flag on, a movement without a verified challenge is refused with 428 and the exact subject, and nothing is written
  process.env.OTP_FINANCE_REQUIRED = "true";
  const e = await fails(postMovement(mgrA, { warehouseId: whA!.id, itemId: i1.id, type: "receipt", qty: 1 }, {}), 428, "otp required") as DomainError & { otpRequired?: boolean; otpSubject?: { qty: number } };
  assert.equal(e.otpRequired, true); assert.equal(e.otpSubject!.qty, 1);
  delete process.env.OTP_FINANCE_REQUIRED;
  assert.equal(Number((await pool.query("select coalesce(sum(qty_delta),0) q from stock_movements where warehouse_id=$1 and item_id=$2", [whA!.id, i1.id])).rows[0].q), 3 + 20 - 2);

  await db.delete(notifications).where(inArray(notifications.memberId, [admin.id, mgrA.id, mgrB.id, coord.id, keeper.id, buyerA.id, buyerHQ.id, buyerB.id]));
  console.log("inventory.check passed");
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
