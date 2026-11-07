import { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/bits";
import { PurchaseRequestDialog } from "@/components/purchase-request-dialog";
import { RfqPanel } from "@/components/rfq-panel";
import { OrderPanel } from "@/components/order-panel";
import { usePageTitle } from "@/hooks/use-data";
import { api, PO_STATUS, PR_STATUS, SUPPLIER_STATUS, useAct, useOps, useRole, INVOICE_STATUS, type InvoiceRow, type Catalogue, type PurchaseOrder, type PurchaseRequest, type Supplier } from "@/hooks/use-ops";
import { fmtSAR } from "@/lib/domain";

const when = (s: string) => new Date(s).toLocaleDateString("ar-SA");
function Table({ head, children, testId }: { head: string[]; children: React.ReactNode; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[640px] text-sm" data-testid={testId}>
        <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function ProcurementPage() {
  usePageTitle("المشتريات");
  const { canBuy, canRequest, canApprove, role } = useRole();
  const cat = useOps<Catalogue>(["catalogue"], "/inventory/catalogue");
  const requests = useOps<PurchaseRequest[]>(["requests"], "/procurement/requests");
  const suppliers = useOps<Supplier[]>(["suppliers"], "/procurement/suppliers");
  const orders = useOps<PurchaseOrder[]>(["orders"], "/procurement/orders");
  const invoices = useOps<InvoiceRow[]>(["invoices"], "/procurement/invoices");
  const [orderId, setOrderId] = useState<number | null>(null);
  const act = useAct();
  const [newPr, setNewPr] = useState(false);
  const [rfqFor, setRfqFor] = useState<PurchaseRequest | null>(null);
  const [panel, setPanel] = useState<{ rfqId: number; prId: number } | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);

  return (
    <>
      <PageHeader eyebrow="سلاسل الإمداد" title="المشتريات"
        desc="دورة شراء مضبوطة: طلب شراء، ثم طلب عروض من ثلاثة موردين معتمدين، ثم مقارنة وترسية يعتمدها مدير الفرع، ثم أمر شراء باسم الجهة برقم ضريبي للمورد. كل خطوة مالية تُسجَّل في سجل التدقيق."
        actions={canRequest ? <Button onClick={() => setNewPr(true)} className="gap-1.5" data-testid="button-new-pr"><Plus className="h-4 w-4" /> طلب شراء</Button> : undefined} />
      <Tabs defaultValue="requests" dir="rtl">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="requests" data-testid="tab-requests">طلبات الشراء</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders">أوامر الشراء</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices">فواتير الموردين</TabsTrigger>
          <TabsTrigger value="suppliers" data-testid="tab-suppliers">الموردون</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          {requests.isLoading ? <LoadingRows /> : requests.isError ? <ErrorState error={requests.error} onRetry={() => requests.refetch()} /> : !requests.data?.length ? (
            <EmptyState title="لا توجد طلبات شراء" desc="يبدأ الطلب من تنبيه الحد الأدنى في صفحة المخزون أو بطلب يدوي." />
          ) : (
            <Table testId="table-requests" head={["الرقم", "الفرع / المستودع", "الأصناف", "الحالة", "التاريخ", ""]}>
              {requests.data.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0" data-testid={`row-pr-${r.id}`}>
                  <td className="px-4 py-3 num" dir="ltr">{r.pr_no}</td>
                  <td className="px-4 py-3">{r.branch} <span className="text-[11px] text-muted-foreground">/ {r.warehouse}</span></td>
                  <td className="px-4 py-3 num">{r.line_count}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{PR_STATUS[r.status] ?? r.status}</span></td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">{when(r.created_at)}</td>
                  <td className="px-4 py-3 text-left">
                    {r.status === "submitted" && canBuy && <Button size="sm" onClick={() => setRfqFor(r)} data-testid={`button-rfq-${r.id}`}>طلب عروض</Button>}
                    {r.rfq_id != null && <Button size="sm" variant="outline" onClick={() => setPanel({ rfqId: r.rfq_id!, prId: r.id })} data-testid={`button-open-rfq-${r.id}`}>العروض والترسية</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </TabsContent>

        <TabsContent value="orders">
          {orders.isLoading ? <LoadingRows /> : !orders.data?.length ? <EmptyState title="لا توجد أوامر شراء" desc="يصدر أمر الشراء بعد اعتماد الترسية." /> : (
            <Table testId="table-orders" head={["الرقم", "المورد", "قبل الضريبة", "الضريبة", "الإجمالي", "الحالة", ""]}>
              {orders.data.map((o) => (
                <tr key={o.id} className="border-b border-border/60 last:border-0" data-testid={`row-po-${o.id}`}>
                  <td className="px-4 py-3 num" dir="ltr">{o.po_no}</td><td className="px-4 py-3 font-medium">{o.supplier}</td>
                  <td className="px-4 py-3 num">{fmtSAR(o.net_halalas / 100)}</td><td className="px-4 py-3 num">{fmtSAR(o.vat_halalas / 100)}</td><td className="px-4 py-3 num">{fmtSAR(o.gross_halalas / 100)}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{PO_STATUS[o.status] ?? o.status}</span>{o.via_delegation && <span className="mr-1 text-[10px] text-muted-foreground">بتفويض</span>}</td>
                  <td className="px-4 py-3 text-left"><Button size="sm" variant="ghost" onClick={() => setOrderId(o.id)} data-testid={`button-open-po-${o.id}`}>التفاصيل</Button>{o.status === "prepared" && canApprove && <Button size="sm" className="gap-1.5" onClick={() => act.run(() => api(`/procurement/orders/${o.id}/approve`, { method: "POST" }), { success: "اعتُمد أمر الشراء", refresh: ["orders", "requests"] })} data-testid={`button-po-approve-${o.id}`}><ShieldCheck className="h-3.5 w-3.5" /> اعتماد</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">لا يعتمد الشخص أمرًا أعدّه بنفسه. عند غياب مدير الفرع يعتمد من فوّضته الإدارة العليا بتفويض معتمد. إرسال الأمر للمورد بالبريد (PDF) والاستلام وفاتورة المورد في المرحلة التالية.</p>
        </TabsContent>

        <TabsContent value="invoices">
          {invoices.isLoading ? <LoadingRows /> : !invoices.data?.length ? <EmptyState title="لا توجد فواتير موردين" desc="تُسجَّل الفاتورة من أمر الشراء بعد الاستلام، وتُطابَق تلقائيًا مع الأمر والاستلام." /> : (
            <Table testId="table-invoices" head={["الفاتورة", "المورد", "أمر الشراء", "الإجمالي", "المسدَّد", "الحالة"]}>
              {invoices.data.map((v) => (
                <tr key={v.id} className="border-b border-border/60 last:border-0" data-testid={`row-invoice-${v.id}`}>
                  <td className="px-4 py-3 num" dir="ltr">{v.supplier_invoice_no}</td><td className="px-4 py-3">{v.supplier}</td><td className="px-4 py-3 num" dir="ltr">{v.po_no}</td>
                  <td className="px-4 py-3 num">{fmtSAR(v.gross_halalas / 100)}</td><td className="px-4 py-3 num">{fmtSAR(v.paid_halalas / 100)}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{INVOICE_STATUS[v.status] ?? v.status}</span></td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">الاعتماد والسداد من تفاصيل أمر الشراء. ضريبة المدخلات تظهر في كل فاتورة وتُجمَّع في التقارير الضريبية.</p>
        </TabsContent>

        <TabsContent value="suppliers">
          <div className="mb-3 flex justify-end">{canBuy && <Button variant="outline" onClick={() => setSupplierOpen(true)} className="gap-1.5" data-testid="button-new-supplier"><Plus className="h-4 w-4" /> مورد جديد</Button>}</div>
          {suppliers.isLoading ? <LoadingRows /> : !suppliers.data?.length ? <EmptyState title="لا يوجد موردون" desc="لا تُقبل عروض ولا أوامر شراء إلا من مورد معتمد برقم ضريبي صحيح (15 رقمًا يبدأ وينتهي بالرقم 3)." /> : (
            <Table testId="table-suppliers" head={["الرقم", "المورد", "الرقم الضريبي", "الحالة", ""]}>
              {suppliers.data.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0" data-testid={`row-supplier-${s.id}`}>
                  <td className="px-4 py-3 num" dir="ltr">{s.supplierNo}</td><td className="px-4 py-3 font-medium">{s.legalName}</td><td className="px-4 py-3 num" dir="ltr">{s.vatNumber}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{SUPPLIER_STATUS[s.status] ?? s.status}</span></td>
                  <td className="px-4 py-3 text-left">{s.status === "pending" && (role === "super_admin" || role === "branch_manager") && <Button size="sm" onClick={() => act.run(() => api(`/procurement/suppliers/${s.id}/approve`, { method: "POST" }), { success: "اعتُمد المورد", refresh: ["suppliers"] })} data-testid={`button-supplier-approve-${s.id}`}>اعتماد</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">صحة الرقم الضريبي لدى هيئة الزكاة تُراجَع يدويًا عبر خدمة التحقق قبل الاعتماد؛ النظام يتحقق من شكله فقط.</p>
        </TabsContent>
      </Tabs>

      <PurchaseRequestDialog open={newPr} onOpenChange={setNewPr} cat={cat.data} />
      {rfqFor && <RfqDialog pr={rfqFor} suppliers={(suppliers.data ?? []).filter((s) => s.status === "approved")} onClose={() => setRfqFor(null)} />}
      {orderId != null && <OrderPanel poId={orderId} onClose={() => setOrderId(null)} />}
      {panel && <RfqPanel rfqId={panel.rfqId} prId={panel.prId} onClose={() => setPanel(null)} />}
      {supplierOpen && <SupplierDialog onClose={() => setSupplierOpen(false)} />}
      {act.dialog}
    </>
  );
}

function RfqDialog({ pr, suppliers, onClose }: { pr: PurchaseRequest; suppliers: Supplier[]; onClose: () => void }) {
  const act = useAct();
  const [picked, setPicked] = useState<number[]>([]);
  const [deadline, setDeadline] = useState(() => new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">طلب عروض أسعار — {pr.pr_no}</DialogTitle><DialogDescription>اختر ثلاثة موردين معتمدين على الأقل. السياسة ثابتة لكل مبلغ.</DialogDescription></DialogHeader>
          {suppliers.length < 3 && <p className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">لديك {suppliers.length} موردين معتمدين فقط. أضف موردين واعتمدهم أولًا.</p>}
          <div className="space-y-2">
            {suppliers.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                <Checkbox checked={picked.includes(s.id)} onCheckedChange={() => toggle(s.id)} data-testid={`check-rfq-supplier-${s.id}`} /><span>{s.legalName}</span>
              </label>
            ))}
          </div>
          <div><Label className="mb-1.5 block text-xs">آخر موعد لاستلام العروض</Label><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button disabled={picked.length < 3 || !deadline} data-testid="button-rfq-send" onClick={() => act.run(() => api(`/procurement/requests/${pr.id}/rfq`, { method: "POST", body: { supplierIds: picked, deadlineAt: new Date(`${deadline}T23:59:00`).toISOString() } }), { success: "أُنشئ طلب العروض", refresh: ["requests"], onDone: onClose })}>إرسال الطلب</Button>
            <Button variant="outline" onClick={onClose}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

function SupplierDialog({ onClose }: { onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ legalName: "", vatNumber: "", email: "", phone: "", city: "" });
  const vatOk = /^3\d{13}3$/.test(f.vatNumber);
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">مورد جديد</DialogTitle><DialogDescription>يبقى المورد «بانتظار الاعتماد» حتى يعتمده مدير الفرع أو الإدارة العليا.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="mb-1.5 block text-xs">اسم المورد (كما في السجل التجاري)</Label><Input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} maxLength={200} data-testid="input-supplier-name" /></div>
            <div><Label className="mb-1.5 block text-xs">الرقم الضريبي (15 رقمًا)</Label><Input dir="ltr" inputMode="numeric" value={f.vatNumber} onChange={(e) => setF({ ...f, vatNumber: e.target.value.replace(/\D/g, "").slice(0, 15) })} data-testid="input-supplier-vat" />
              {f.vatNumber && !vatOk && <p className="mt-1 text-[11px] text-destructive">يجب أن يبدأ وينتهي بالرقم 3 ويتكوّن من 15 رقمًا.</p>}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="mb-1.5 block text-xs">البريد</Label><Input dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div><Label className="mb-1.5 block text-xs">الجوال</Label><Input dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            </div>
            <div><Label className="mb-1.5 block text-xs">المدينة</Label><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={!f.legalName.trim() || !vatOk} data-testid="button-supplier-save" onClick={() => act.run(() => api("/procurement/suppliers", { method: "POST", body: f }), { success: "أُضيف المورد", refresh: ["suppliers"], onDone: onClose })}>حفظ</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}
