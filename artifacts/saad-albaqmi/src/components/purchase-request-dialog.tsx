import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, useAct, type Catalogue } from "@/hooks/use-ops";

export type RequestPrefill = { warehouseId?: number; alertId?: number; itemId?: number; qty?: number };

/** New purchase request. Opened from the procurement page or straight from a reorder alert (alert and item prefilled). */
export function PurchaseRequestDialog({ open, onOpenChange, cat, prefill }: { open: boolean; onOpenChange: (o: boolean) => void; cat: Catalogue | undefined; prefill?: RequestPrefill }) {
  const act = useAct();
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([{ itemId: "", qty: "" }]);

  useEffect(() => {
    if (!open) return;
    setWarehouseId(prefill?.warehouseId ? String(prefill.warehouseId) : cat?.warehouses.length === 1 ? String(cat.warehouses[0]!.id) : "");
    setLines([{ itemId: prefill?.itemId ? String(prefill.itemId) : "", qty: prefill?.qty ? String(prefill.qty) : "" }]);
    setReason("");
  }, [open, prefill, cat]);

  const consumables = (cat?.items ?? []).filter((i) => i.itemType === "consumable");
  const valid = warehouseId && lines.length > 0 && lines.every((l) => l.itemId && Number(l.qty) > 0);
  const setLine = (i: number, patch: Partial<{ itemId: string; qty: string }>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const submit = () => act.run(
    () => api("/procurement/requests", { method: "POST", body: { warehouseId: Number(warehouseId), alertId: prefill?.alertId, reason: reason.trim() || undefined, lines: lines.map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) })) } }),
    { success: "تم إنشاء طلب الشراء", refresh: ["requests", "alerts"], onDone: () => onOpenChange(false) },
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="font-display text-xl text-primary">طلب شراء جديد</DialogTitle>
            <DialogDescription>لا يُقبل الطلب لصنف رصيده فوق حدّه الأدنى. بعد التقديم تُطلب عروض الأسعار من ثلاثة موردين معتمدين.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block text-xs">المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger data-testid="select-pr-warehouse"><SelectValue placeholder="اختر المستودع" /></SelectTrigger>
                <SelectContent>{(cat?.warehouses ?? []).map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="block text-xs">الأصناف المطلوبة</Label>
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={l.itemId} onValueChange={(v) => setLine(i, { itemId: v })}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="الصنف" /></SelectTrigger>
                    <SelectContent>{consumables.map((it) => <SelectItem key={it.id} value={String(it.id)}>{it.itemCode} — {it.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input className="w-24" type="number" min={0} placeholder="الكمية" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} data-testid={`input-pr-qty-${i}`} />
                  {lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label="حذف السطر"><Trash2 className="h-4 w-4" /></Button>}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLines((ls) => [...ls, { itemId: "", qty: "" }])}><Plus className="h-4 w-4" /> إضافة صنف</Button>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">سبب الطلب</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="مثال: وصل الصنف إلى الحد الأدنى" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button onClick={submit} disabled={!valid} data-testid="button-pr-save">تقديم الطلب</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}
