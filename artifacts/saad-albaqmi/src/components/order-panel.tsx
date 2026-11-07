import { useState } from "react";
import { FileText, Mail, PackageCheck, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, LoadingRows } from "@/components/bits";
import { api, INVOICE_APPROVERS, INVOICE_STATUS, INVOICE_WRITERS, PAYERS, PO_STATUS, STOCK_WRITERS, BUYERS, toHalalas, useAct, useOps, useRole, type InvoiceRow, type OrderDetail } from "@/hooks/use-ops";
import { fmtDec, fmtSAR } from "@/lib/domain";

const RECEIVABLE = ["sent", "acknowledged", "partially_received"];
const INVOICABLE = ["sent", "acknowledged", "partially_received", "received"];

/** One purchase order end to end: print/send, receive goods, book the supplier invoice (three-way match), approve and pay it. */
export function OrderPanel({ poId, onClose }: { poId: number; onClose: () => void }) {
  const { role } = useRole();
  const act = useAct();
  const d = useOps<OrderDetail>(["order", poId], `/procurement/orders/${poId}`);
  const [receive, setReceive] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const [pay, setPay] = useState<InvoiceRow | null>(null);
  const [variance, setVariance] = useState<InvoiceRow | null>(null);
  const refresh = ["order", "orders", "invoices", "requests", "balances", "alerts"];
  const po = d.data?.po;

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-3xl" dir="rtl">
          <SheetHeader className="text-right">
            <SheetTitle className="font-display text-xl text-primary">{po ? `أمر الشراء ${po.poNo}` : "أمر الشراء"}</SheetTitle>
            <SheetDescription>{po ? `${PO_STATUS[po.status] ?? po.status} — الإجمالي ${fmtSAR(Number(po.grossHalalas) / 100)} شامل الضريبة` : ""}</SheetDescription>
          </SheetHeader>
          {d.isLoading ? <LoadingRows /> : d.isError || !d.data || !po ? <ErrorState error={d.error} onRetry={() => d.refetch()} /> : (
            <div className="mt-5 space-y-6">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-1.5" onClick={() => window.open(`/api/procurement/orders/${po.id}/print`, "_blank", "noopener")} data-testid="button-po-print"><FileText className="h-4 w-4" /> طباعة / PDF</Button>
                {po.status === "approved" && BUYERS.includes(role) && <Button className="gap-1.5" data-testid="button-po-send" onClick={() => act.run(() => api(`/procurement/orders/${po.id}/send`, { method: "POST" }), { success: "أُرسل أمر الشراء للمورد", refresh })}><Mail className="h-4 w-4" /> إرسال للمورد</Button>}
                {RECEIVABLE.includes(po.status) && STOCK_WRITERS.includes(role) && <Button className="gap-1.5" onClick={() => setReceive(true)} data-testid="button-po-receive"><PackageCheck className="h-4 w-4" /> استلام بضاعة</Button>}
                {INVOICABLE.includes(po.status) && INVOICE_WRITERS.includes(role) && <Button variant="outline" className="gap-1.5" onClick={() => setInvoice(true)} data-testid="button-po-invoice"><Receipt className="h-4 w-4" /> فاتورة مورد</Button>}
              </div>

              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full min-w-[560px] text-sm" data-testid="table-po-lines">
                  <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground"><th className="px-3 py-2 font-medium">البند</th><th className="px-3 py-2 font-medium">المطلوب</th><th className="px-3 py-2 font-medium">المستلم (مقبول)</th><th className="px-3 py-2 font-medium">المفوتر</th><th className="px-3 py-2 font-medium">سعر الوحدة</th></tr></thead>
                  <tbody>{d.data.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border/60 last:border-0"><td className="px-3 py-2">{l.name} <span className="num text-[11px] text-muted-foreground" dir="ltr">{l.item_code}</span></td><td className="px-3 py-2 num">{fmtDec(l.qty)} {l.unit}</td><td className="px-3 py-2 num">{fmtDec(l.received)}</td><td className="px-3 py-2 num">{fmtDec(l.invoiced)}</td><td className="px-3 py-2 num">{fmtSAR(l.unit_price_halalas / 100)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              {d.data.receipts.length > 0 && <p className="text-xs text-muted-foreground">محاضر الاستلام: {d.data.receipts.map((r) => r.grn_no).join("، ")}</p>}

              <section>
                <h3 className="mb-2 text-sm font-medium">فواتير المورد والمطابقة الثلاثية</h3>
                {d.data.invoices.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد فواتير مسجلة لهذا الأمر.</p> : (
                  <ul className="space-y-2">
                    {d.data.invoices.map((v) => (
                      <li key={v.id} className="rounded-xl border bg-card p-3 text-sm" data-testid={`invoice-${v.id}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div><b className="num" dir="ltr">{v.supplier_invoice_no}</b> <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{INVOICE_STATUS[v.status] ?? v.status}</span>
                            <div className="mt-1 text-xs text-muted-foreground">{fmtSAR(v.net_halalas / 100)} + ضريبة {fmtSAR(v.vat_halalas / 100)} = {fmtSAR(v.gross_halalas / 100)}{v.paid_halalas ? ` — مسدَّد ${fmtSAR(v.paid_halalas / 100)}` : ""}</div></div>
                          <div className="flex gap-2">
                            {(v.status === "matched" || v.status === "mismatch") && INVOICE_APPROVERS.includes(role) && <Button size="sm" className="gap-1.5" data-testid={`button-invoice-approve-${v.id}`} onClick={() => (v.status === "mismatch" ? setVariance(v) : act.run(() => api(`/procurement/invoices/${v.id}/approve`, { method: "POST", body: {} }), { success: "اعتُمدت الفاتورة وسُجّل المصروف على الفرع", refresh }))}><ShieldCheck className="h-3.5 w-3.5" /> اعتماد</Button>}
                            {v.status === "approved" && PAYERS.includes(role) && <Button size="sm" variant="outline" className="gap-1.5" data-testid={`button-invoice-pay-${v.id}`} onClick={() => setPay(v)}><Wallet className="h-3.5 w-3.5" /> سداد</Button>}
                          </div>
                        </div>
                        {v.status === "mismatch" && <ul className="mt-2 list-disc pr-5 text-xs text-destructive">{(v.match_result?.lines ?? []).flatMap((l) => l.reasons).map((r, i) => <li key={i}>{r}</li>)}</ul>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {receive && d.data && <ReceiveDialog d={d.data} onClose={() => setReceive(false)} refresh={refresh} />}
      {invoice && d.data && <InvoiceDialog d={d.data} onClose={() => setInvoice(false)} refresh={refresh} />}
      {pay && <PayDialog inv={pay} onClose={() => setPay(null)} refresh={refresh} />}
      {variance && (
        <VarianceDialog inv={variance} onClose={() => setVariance(null)} onApprove={(reason) => act.run(() => api(`/procurement/invoices/${variance.id}/approve`, { method: "POST", body: { reason } }), { success: "اعتُمدت الفاتورة بفروقاتها", refresh, onDone: () => setVariance(null) })} />
      )}
      {act.dialog}
    </>
  );
}

function ReceiveDialog({ d, onClose, refresh }: { d: OrderDetail; onClose: () => void; refresh: string[] }) {
  const act = useAct();
  const open = d.lines.filter((l) => l.qty - l.received > 0);
  const [rows, setRows] = useState<Record<number, { rec: string; acc: string; q: string; notes: string }>>(() => Object.fromEntries(open.map((l) => [l.id, { rec: "", acc: "", q: "accepted", notes: "" }])));
  const [note, setNote] = useState("");
  const set = (id: number, patch: Partial<{ rec: string; acc: string; q: string; notes: string }>) => setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));
  const filled = open.filter((l) => Number(rows[l.id]?.rec) > 0);
  const valid = filled.length > 0 && filled.every((l) => { const r = rows[l.id]!; return Number(r.acc) >= 0 && r.acc !== "" && Number(r.acc) <= Number(r.rec) && (r.q !== "accepted_with_notes" || r.notes.trim()) && (r.q !== "rejected" || Number(r.acc) === 0); });
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">استلام بضاعة — {d.po.poNo}</DialogTitle><DialogDescription>تدخل المخزون الكمية المقبولة فقط. المرفوض يُسجَّل ولا يُدخل المخزون، ولا يمكن قبول أكثر من المطلوب.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {open.map((l) => { const r = rows[l.id]!; return (
              <div key={l.id} className="rounded-xl border p-3">
                <div className="mb-2 text-sm font-medium">{l.name} <span className="text-[11px] text-muted-foreground">المتبقي {fmtDec(l.qty - l.received)} {l.unit}</span></div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Input type="number" min={0} placeholder="المستلم" value={r.rec} onChange={(e) => set(l.id, { rec: e.target.value, acc: r.acc === "" || r.acc === r.rec ? e.target.value : r.acc })} data-testid={`input-recv-${l.id}`} />
                  <Input type="number" min={0} placeholder="المقبول" value={r.acc} onChange={(e) => set(l.id, { acc: e.target.value })} data-testid={`input-acc-${l.id}`} />
                  <Select value={r.q} onValueChange={(v) => set(l.id, { q: v, acc: v === "rejected" ? "0" : r.acc })}><SelectTrigger className="sm:col-span-2"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="accepted">مقبول</SelectItem><SelectItem value="accepted_with_notes">مقبول بملاحظات</SelectItem><SelectItem value="rejected">مرفوض</SelectItem></SelectContent></Select>
                </div>
                {r.q !== "accepted" && <Input className="mt-2" placeholder="ملاحظات الجودة" value={r.notes} onChange={(e) => set(l.id, { notes: e.target.value })} />}
              </div>
            ); })}
            <div><Label className="mb-1.5 block text-xs">رقم إشعار التسليم</Label><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} /></div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={!valid} data-testid="button-receive-save" onClick={() => act.run(() => api(`/procurement/orders/${d.po.id}/receipts`, { method: "POST", body: { deliveryNoteNo: note || undefined, lines: filled.map((l) => { const r = rows[l.id]!; return { poLineId: l.id, qtyReceived: Number(r.rec), qtyAccepted: Number(r.acc), qualityResult: r.q, qualityNotes: r.notes || undefined }; }) } }), { success: "تم الاستلام وتحديث المخزون", refresh, onDone: onClose })}>تأكيد الاستلام</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

function InvoiceDialog({ d, onClose, refresh }: { d: OrderDetail; onClose: () => void; refresh: string[] }) {
  const act = useAct();
  const [no, setNo] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Record<number, { qty: string; price: string }>>(() => Object.fromEntries(d.lines.map((l) => [l.id, { qty: l.received - l.invoiced > 0 ? String(l.received - l.invoiced) : "", price: String(l.unit_price_halalas / 100) }])));
  const used = d.lines.filter((l) => Number(rows[l.id]?.qty) > 0);
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">فاتورة مورد</DialogTitle><DialogDescription>أدخل بنود فاتورة المورد (الأسعار قبل الضريبة). يطابقها النظام مع أمر الشراء والاستلام داخل نسب التسامح.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label className="mb-1.5 block text-xs">رقم فاتورة المورد</Label><Input dir="ltr" value={no} onChange={(e) => setNo(e.target.value)} data-testid="input-invoice-no" /></div><div><Label className="mb-1.5 block text-xs">تاريخ الفاتورة</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
          <div className="space-y-2">{d.lines.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{l.name}</span>
              <Input className="w-24" type="number" min={0} placeholder="الكمية" value={rows[l.id]!.qty} onChange={(e) => setRows((r) => ({ ...r, [l.id]: { ...r[l.id]!, qty: e.target.value } }))} data-testid={`input-inv-qty-${l.id}`} />
              <Input className="w-28" type="number" min={0} step="0.01" placeholder="سعر الوحدة" value={rows[l.id]!.price} onChange={(e) => setRows((r) => ({ ...r, [l.id]: { ...r[l.id]!, price: e.target.value } }))} /></div>
          ))}</div>
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={!no.trim() || used.length === 0} data-testid="button-invoice-save" onClick={() => act.run(() => api(`/procurement/orders/${d.po.id}/invoices`, { method: "POST", body: { supplierInvoiceNo: no.trim(), invoiceDate: date, lines: used.map((l) => ({ poLineId: l.id, quantity: Number(rows[l.id]!.qty), unitPriceHalalas: toHalalas(rows[l.id]!.price) })) } }), { success: "سُجّلت الفاتورة ونُفّذت المطابقة", refresh, onDone: onClose })}>تسجيل ومطابقة</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

function PayDialog({ inv, onClose, refresh }: { inv: InvoiceRow; onClose: () => void; refresh: string[] }) {
  const act = useAct();
  const left = (inv.gross_halalas - inv.paid_halalas) / 100;
  const [amount, setAmount] = useState(String(left)); const [method, setMethod] = useState("bank_transfer"); const [ref, setRef] = useState("");
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">سداد المورد</DialogTitle><DialogDescription>المتبقي {fmtSAR(left)}. لا يسدّد الشخص فاتورة اعتمدها بنفسه، ويتطلب تأكيدًا برمز OTP.</DialogDescription></DialogHeader>
          <div className="space-y-3"><div><Label className="mb-1.5 block text-xs">المبلغ (ر.س)</Label><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-pay-amount" /></div>
            <div><Label className="mb-1.5 block text-xs">الطريقة</Label><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank_transfer">تحويل بنكي</SelectItem><SelectItem value="cheque">شيك</SelectItem><SelectItem value="cash">نقدًا</SelectItem></SelectContent></Select></div>
            <div><Label className="mb-1.5 block text-xs">المرجع</Label><Input dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} /></div></div>
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={!(Number(amount) > 0)} data-testid="button-pay-save" onClick={() => act.run(() => api(`/procurement/invoices/${inv.id}/pay`, { method: "POST", body: { amountHalalas: toHalalas(amount), method, reference: ref || undefined } }), { success: "تم تسجيل السداد", refresh, onDone: onClose })}>تأكيد السداد</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

function VarianceDialog({ inv, onClose, onApprove }: { inv: InvoiceRow; onClose: () => void; onApprove: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">اعتماد فاتورة بفروقات</DialogTitle><DialogDescription>الفاتورة {inv.supplier_invoice_no} تخرج عن نسب التسامح في السعر أو الكمية أو الجودة. اكتب سبب قبولها؛ يُحفظ في سجل التدقيق.</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="سبب قبول الفروقات" data-testid="input-variance-reason" />
        <DialogFooter className="gap-2 sm:justify-start"><Button disabled={reason.trim().length < 10} onClick={() => onApprove(reason.trim())} data-testid="button-variance-approve">اعتماد</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
