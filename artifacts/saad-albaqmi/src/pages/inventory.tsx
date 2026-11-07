import { useMemo, useState } from "react";
import { BellRing, PackagePlus, SlidersHorizontal, ShoppingCart, ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, ErrorState, LoadingRows, EmptyState, Kpi } from "@/components/bits";
import { PurchaseRequestDialog, type RequestPrefill } from "@/components/purchase-request-dialog";
import { usePageTitle } from "@/hooks/use-data";
import { api, toHalalas, useAct, useOps, useRole, type Alert, type Balance, type Catalogue, type Consumption, type Note } from "@/hooks/use-ops";
import { fmtDec, fmtSAR } from "@/lib/domain";

const TYPE_LABEL: Record<string, string> = { opening: "رصيد افتتاحي", receipt: "استلام", issue: "صرف", adjustment: "تسوية بعد جرد" };
const fmtWhen = (s: string) => new Date(s).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });

function Table({ head, children, testId }: { head: string[]; children: React.ReactNode; testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[640px] text-sm" data-testid={testId}>
        <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function InventoryPage() {
  usePageTitle("المخزون");
  const { canWriteStock, canRequest } = useRole();
  const cat = useOps<Catalogue>(["catalogue"], "/inventory/catalogue");
  const [warehouseId, setWarehouseId] = useState("");
  const wid = warehouseId || (cat.data?.warehouses[0] ? String(cat.data.warehouses[0].id) : "");
  const balances = useOps<Balance[]>(["balances", wid], `/inventory/balances?warehouseId=${wid}`, !!wid);
  const alerts = useOps<Alert[]>(["alerts"], "/inventory/alerts");
  const consumption = useOps<Consumption[]>(["consumption", wid], `/inventory/consumption?warehouseId=${wid}`, !!wid);
  const notes = useOps<Note[]>(["notes"], "/notifications");
  const act = useAct();
  const [movement, setMovement] = useState<{ itemId?: number } | null>(null);
  const [level, setLevel] = useState<{ itemId?: number } | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [pr, setPr] = useState<RequestPrefill | null>(null);

  const low = (balances.data ?? []).filter((b) => b.needs_reorder).length;
  const unread = (notes.data ?? []).filter((n) => !n.readAt).length;
  const whName = cat.data?.warehouses.find((w) => String(w.id) === wid)?.name ?? "";

  if (cat.isLoading) return <LoadingRows />;
  if (cat.isError) return <ErrorState error={cat.error} onRetry={() => cat.refetch()} />;
  if (!cat.data?.warehouses.length) return <EmptyState title="لا توجد مستودعات في نطاقك" desc="يُنشأ مستودع لكل فرع تلقائيًا عند وجود فروع مسجلة. أضف الفروع أولًا من صفحة الفروع." />;

  return (
    <>
      <PageHeader eyebrow="سلاسل الإمداد" title="المخزون"
        desc="أرصدة المستلزمات الاستهلاكية لكل فرع، وحد إعادة الطلب، وحركات الاستلام والصرف. يصل تنبيه لإدارة المشتريات عند بلوغ الحد الأدنى. الأصول الثابتة تُسجَّل في صفحة الأصول."
        actions={canWriteStock ? <div className="flex flex-wrap gap-2"><Button onClick={() => setMovement({})} className="gap-1.5" data-testid="button-new-movement"><ArrowDownUp className="h-4 w-4" /> حركة مخزون</Button><Button variant="outline" onClick={() => setItemOpen(true)} className="gap-1.5" data-testid="button-new-item"><PackagePlus className="h-4 w-4" /> صنف جديد</Button></div> : undefined} />

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="min-w-56">
          <Label className="mb-1.5 block text-xs">المستودع</Label>
          <Select value={wid} onValueChange={setWarehouseId}>
            <SelectTrigger data-testid="select-warehouse"><SelectValue placeholder="اختر المستودع" /></SelectTrigger>
            <SelectContent>{cat.data.warehouses.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-md"><Kpi label="أصناف عند الحد الأدنى" value={low} tone={low ? "accent" : undefined} /><Kpi label="تنبيهات مفتوحة" value={alerts.data?.length ?? 0} /></div>
      </div>

      <Tabs defaultValue="balances" dir="rtl">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="balances" data-testid="tab-balances">الأرصدة</TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-alerts">التنبيهات{alerts.data?.length ? ` (${alerts.data.length})` : ""}</TabsTrigger>
          <TabsTrigger value="consumption" data-testid="tab-consumption">مؤشر الاستهلاك</TabsTrigger>
          <TabsTrigger value="notes" data-testid="tab-notes">الإشعارات{unread ? ` (${unread})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="balances">
          {balances.isLoading ? <LoadingRows /> : balances.isError ? <ErrorState error={balances.error} onRetry={() => balances.refetch()} /> : !balances.data?.length ? (
            <EmptyState title={`لا توجد أصناف في ${whName}`} desc="أضف صنفًا ثم سجّل رصيدًا افتتاحيًا وحدًّا أدنى ليبدأ التنبيه." />
          ) : (
            <Table testId="table-balances" head={["الكود", "الصنف", "الرصيد", "الحد الأدنى", "الحالة", ""]}>
              {balances.data.map((b) => (
                <tr key={b.item_id} className="border-b border-border/60 last:border-0" data-testid={`row-balance-${b.item_id}`}>
                  <td className="px-4 py-3 num" dir="ltr">{b.item_code}</td>
                  <td className="px-4 py-3 font-medium">{b.name} <span className="text-[11px] text-muted-foreground">({b.unit})</span></td>
                  <td className="px-4 py-3 num">{fmtDec(b.qty_on_hand)}</td>
                  <td className="px-4 py-3 num">{b.min_qty == null ? "—" : fmtDec(b.min_qty)}</td>
                  <td className="px-4 py-3">{b.needs_reorder ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">عند الحد الأدنى</span> : <span className="text-[11px] text-muted-foreground">كافٍ</span>}</td>
                  <td className="px-4 py-3 text-left"><div className="flex justify-end gap-1.5">
                    {canWriteStock && <Button size="sm" variant="outline" onClick={() => setMovement({ itemId: b.item_id })}>حركة</Button>}
                    {canWriteStock && <Button size="sm" variant="ghost" className="gap-1" onClick={() => setLevel({ itemId: b.item_id })}><SlidersHorizontal className="h-3.5 w-3.5" /> الحد الأدنى</Button>}
                  </div></td>
                </tr>
              ))}
            </Table>
          )}
        </TabsContent>

        <TabsContent value="alerts">
          {alerts.isLoading ? <LoadingRows /> : !alerts.data?.length ? <EmptyState title="لا توجد تنبيهات مفتوحة" desc="يظهر هنا كل صنف وصل إلى حده الأدنى حتى يُغطى بطلب شراء." /> : (
            <Table testId="table-alerts" head={["الصنف", "المستودع", "الرصيد", "الحد الأدنى", "منذ", ""]}>
              {alerts.data.map((a) => (
                <tr key={a.id} className="border-b border-border/60 last:border-0" data-testid={`row-alert-${a.id}`}>
                  <td className="px-4 py-3 font-medium">{a.item_name} <span className="num text-[11px] text-muted-foreground" dir="ltr">{a.item_code}</span></td>
                  <td className="px-4 py-3">{a.warehouse}</td>
                  <td className="px-4 py-3 num">{fmtDec(a.qty_at_trigger)}</td>
                  <td className="px-4 py-3 num">{fmtDec(a.min_qty)}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">{fmtWhen(a.opened_at)}</td>
                  <td className="px-4 py-3 text-left">{a.status === "in_progress" ? <span className="text-[11px] text-muted-foreground">طلب شراء قيد المعالجة</span> : canRequest && <Button size="sm" className="gap-1.5" onClick={() => setPr({ warehouseId: a.warehouse_id, alertId: a.id, itemId: a.item_id })} data-testid={`button-alert-request-${a.id}`}><ShoppingCart className="h-3.5 w-3.5" /> طلب شراء</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
        </TabsContent>

        <TabsContent value="consumption">
          {consumption.isLoading ? <LoadingRows /> : !consumption.data?.length ? <EmptyState title="لا يوجد صرف مسجَّل" desc="يُحسب المؤشر من مستندات الصرف إلى القاعات والأقسام، ويُعرض شهريًا لكل صنف." /> : (
            <Table testId="table-consumption" head={["الشهر", "القاعة", "الصنف", "الكمية المصروفة", "تكلفة إرشادية"]}>
              {consumption.data.map((c, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 num" dir="ltr">{c.month}</td><td className="px-4 py-3">{c.room ?? "قسم"}</td>
                  <td className="px-4 py-3">{c.item_name}</td><td className="px-4 py-3 num">{fmtDec(c.qty_issued)}</td><td className="px-4 py-3 num">{fmtSAR(c.indicative_cost_halalas / 100)}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">التكلفة إرشادية للمتابعة فقط؛ المستلزمات تُحمَّل على الفرع عند الاستلام ولا تُحسب مرة ثانية عند الصرف.</p>
        </TabsContent>

        <TabsContent value="notes">
          {!notes.data?.length ? <EmptyState title="لا توجد إشعارات" desc="تصلك هنا تنبيهات الحد الأدنى وما يحتاج اعتمادك." /> : (
            <ul className="space-y-2">
              {notes.data.map((n) => (
                <li key={n.id} className={`flex items-start justify-between gap-3 rounded-xl border bg-card p-4 ${n.readAt ? "opacity-60" : ""}`} data-testid={`note-${n.id}`}>
                  <div className="flex gap-3"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><div><div className="text-sm font-medium">{n.title}</div>{n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}<div className="mt-1 text-[11px] text-muted-foreground">{fmtWhen(n.createdAt)}</div></div></div>
                  {!n.readAt && <Button size="sm" variant="ghost" onClick={() => act.run(() => api(`/notifications/${n.id}/read`, { method: "POST" }), { success: "تم", refresh: ["notes"] })}>تمت القراءة</Button>}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {movement && <MovementDialog cat={cat.data} warehouseId={Number(wid)} itemId={movement.itemId} onClose={() => setMovement(null)} />}
      {level && <LevelDialog cat={cat.data} warehouseId={Number(wid)} itemId={level.itemId} current={balances.data?.find((b) => b.item_id === level.itemId)} onClose={() => setLevel(null)} />}
      {itemOpen && <ItemDialog cat={cat.data} onClose={() => setItemOpen(false)} />}
      <PurchaseRequestDialog open={!!pr} onOpenChange={(o) => !o && setPr(null)} cat={cat.data} prefill={pr ?? undefined} />
      {act.dialog}
    </>
  );
}

function MovementDialog({ cat, warehouseId, itemId, onClose }: { cat: Catalogue; warehouseId: number; itemId?: number; onClose: () => void }) {
  const act = useAct();
  const [type, setType] = useState("receipt");
  const [item, setItem] = useState(itemId ? String(itemId) : "");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [room, setRoom] = useState("");
  const [direction, setDirection] = useState("decrease");
  const [purpose, setPurpose] = useState("");
  const branchId = cat.warehouses.find((w) => w.id === warehouseId)?.branchId;
  const rooms = cat.rooms.filter((r) => r.branchId === branchId);
  const needsPurpose = type === "issue" || type === "adjustment";
  const valid = item && Number(qty) > 0 && (type !== "issue" || room) && (!needsPurpose || purpose.trim());
  const submit = () => act.run(() => api("/inventory/movements", { method: "POST", body: {
    warehouseId, itemId: Number(item), type, qty: Number(qty), unitCostHalalas: cost && type !== "issue" ? toHalalas(cost) : undefined,
    roomId: type === "issue" ? Number(room) : undefined, direction: type === "adjustment" ? direction : undefined, purpose: purpose.trim() || undefined,
  } }), { success: "تم تسجيل الحركة", refresh: ["balances", "alerts", "consumption", "notes"], onDone: onClose });
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">حركة مخزون</DialogTitle><DialogDescription>الحركة لا تُعدَّل بعد تسجيلها، والتصحيح يكون بحركة تسوية بسبب مكتوب. لا يسمح النظام برصيد سالب.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="mb-1.5 block text-xs">نوع الحركة</Label>
              <Select value={type} onValueChange={setType}><SelectTrigger data-testid="select-movement-type"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="mb-1.5 block text-xs">الصنف</Label>
              <Select value={item} onValueChange={setItem}><SelectTrigger data-testid="select-movement-item"><SelectValue placeholder="اختر الصنف" /></SelectTrigger><SelectContent>{cat.items.filter((i) => i.itemType === "consumable").map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.itemCode} — {i.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="mb-1.5 block text-xs">الكمية</Label><Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="input-movement-qty" /></div>
              {type !== "issue" && <div><Label className="mb-1.5 block text-xs">تكلفة الوحدة (ر.س)</Label><Input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>}
            </div>
            {type === "issue" && <div><Label className="mb-1.5 block text-xs">القاعة المستلمة</Label>
              <Select value={room} onValueChange={setRoom}><SelectTrigger data-testid="select-movement-room"><SelectValue placeholder="اختر القاعة" /></SelectTrigger><SelectContent>{rooms.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent></Select></div>}
            {type === "adjustment" && <div><Label className="mb-1.5 block text-xs">الاتجاه</Label>
              <Select value={direction} onValueChange={setDirection}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="decrease">نقص</SelectItem><SelectItem value="increase">زيادة</SelectItem></SelectContent></Select></div>}
            {needsPurpose && <div><Label className="mb-1.5 block text-xs">{type === "issue" ? "الغرض" : "سبب التسوية"}</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} data-testid="input-movement-purpose" /></div>}
          </div>
          <DialogFooter className="gap-2 sm:justify-start"><Button onClick={submit} disabled={!valid} data-testid="button-movement-save">تسجيل</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

function LevelDialog({ cat, warehouseId, itemId, current, onClose }: { cat: Catalogue; warehouseId: number; itemId?: number; current?: Balance; onClose: () => void }) {
  const act = useAct();
  const [item, setItem] = useState(itemId ? String(itemId) : "");
  const [min, setMin] = useState(current?.min_qty != null ? String(current.min_qty) : "");
  const [max, setMax] = useState(current?.max_qty != null ? String(current.max_qty) : "");
  const [reorder, setReorder] = useState(current?.reorder_qty != null ? String(current.reorder_qty) : "");
  const valid = item && min !== "" && Number(min) >= 0;
  const submit = () => act.run(() => api("/inventory/stock-levels", { method: "PUT", body: { warehouseId, itemId: Number(item), minQty: Number(min), maxQty: max ? Number(max) : null, reorderQty: reorder ? Number(reorder) : null } }),
    { success: "تم حفظ حد إعادة الطلب", refresh: ["balances", "alerts", "notes"], onDone: onClose });
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">الحد الأدنى لإعادة الطلب</DialogTitle><DialogDescription>عند بلوغ الرصيد هذا الحد يصل تنبيه لإدارة المشتريات لطلب عروض الأسعار قبل نفاد الصنف.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="mb-1.5 block text-xs">الصنف</Label><Select value={item} onValueChange={setItem}><SelectTrigger><SelectValue placeholder="اختر الصنف" /></SelectTrigger><SelectContent>{cat.items.filter((i) => i.itemType === "consumable").map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.itemCode} — {i.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="mb-1.5 block text-xs">الحد الأدنى</Label><Input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} data-testid="input-level-min" /></div>
              <div><Label className="mb-1.5 block text-xs">الحد الأقصى</Label><Input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} /></div>
              <div><Label className="mb-1.5 block text-xs">كمية الطلب</Label><Input type="number" min={0} value={reorder} onChange={(e) => setReorder(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start"><Button onClick={submit} disabled={!valid} data-testid="button-level-save">حفظ</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

function ItemDialog({ cat, onClose }: { cat: Catalogue; onClose: () => void }) {
  const act = useAct();
  const [name, setName] = useState(""); const [category, setCategory] = useState(""); const [unit, setUnit] = useState("");
  const units = useMemo(() => cat.units, [cat]);
  const submit = () => act.run(() => api("/inventory/items", { method: "POST", body: { name: name.trim(), categoryId: Number(category), unitId: Number(unit), itemType: "consumable" } }),
    { success: "تم إنشاء الصنف", refresh: ["catalogue"], onDone: onClose });
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">صنف جديد</DialogTitle><DialogDescription>يُعطى الصنف كودًا تلقائيًا بحسب تصنيفه ولا يُعاد استخدامه.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="mb-1.5 block text-xs">اسم الصنف</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="input-item-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="mb-1.5 block text-xs">التصنيف</Label><Select value={category} onValueChange={setCategory}><SelectTrigger data-testid="select-item-category"><SelectValue placeholder="اختر" /></SelectTrigger><SelectContent>{cat.categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="mb-1.5 block text-xs">الوحدة</Label><Select value={unit} onValueChange={setUnit}><SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger><SelectContent>{units.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start"><Button onClick={submit} disabled={!name.trim() || !category || !unit} data-testid="button-item-save">إنشاء</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}
