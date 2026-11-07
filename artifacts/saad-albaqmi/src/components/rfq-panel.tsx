import { useEffect, useState } from "react";
import { Award, CheckCircle2, FileText, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, LoadingRows } from "@/components/bits";
import { api, toHalalas, useAct, useOps, useRole, type Comparison, type PrDetail } from "@/hooks/use-ops";
import { fmtSAR } from "@/lib/domain";

const RFQ_STATUS: Record<string, string> = { open: "مفتوح لاستلام العروض", evaluating: "قيد التقييم", awarded: "تمت الترسية", cancelled: "ملغى" };

/**
 * Everything for one RFQ in one place: quote entry (3+ required), comparison with scores, award recommendation (justified when not the
 * cheapest), approval by the branch manager or an approved delegate, and purchase-order preparation. The server enforces every rule;
 * this panel only shows the next step the signed-in role can take.
 */
export function RfqPanel({ rfqId, prId, onClose }: { rfqId: number; prId: number; onClose: () => void }) {
  const { canBuy, canApprove } = useRole();
  const act = useAct();
  const cmp = useOps<Comparison>(["rfq", rfqId], `/procurement/rfqs/${rfqId}/comparison`);
  const pr = useOps<PrDetail>(["pr", prId], `/procurement/requests/${prId}`);
  const [quoteFor, setQuoteFor] = useState("");
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [days, setDays] = useState("");
  const [evalFor, setEvalFor] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  const [why, setWhy] = useState("");
  const [delivery, setDelivery] = useState("");
  const refresh = ["rfq", "requests", "orders", "pr"];

  const d = cmp.data;
  const quoted = new Set(d?.quotations.map((q) => q.supplier_id));
  const open = d?.rfq.status === "open" || d?.rfq.status === "evaluating";
  const chosen = d?.quotations.find((q) => String(q.quotation_id) === pick);
  const needsWhy = !!chosen && !chosen.isLowest;
  useEffect(() => { setPrices({}); setDays(""); setQuoteFor(""); }, [rfqId]);
  const lines = pr.data?.lines ?? [];
  const quoteReady = quoteFor && lines.length > 0 && lines.every((l) => Number(prices[l.item_id]) >= 0 && prices[l.item_id] !== undefined && prices[l.item_id] !== "");

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-3xl" dir="rtl">
          <SheetHeader className="text-right">
            <SheetTitle className="font-display text-xl text-primary">{d ? `طلب عروض ${d.rfq.rfqNo}` : "طلب عروض الأسعار"}</SheetTitle>
            <SheetDescription>{d ? `${RFQ_STATUS[d.rfq.status] ?? d.rfq.status} — الموعد النهائي ${new Date(d.rfq.deadlineAt).toLocaleDateString("ar-SA")}` : ""}</SheetDescription>
          </SheetHeader>
          {cmp.isLoading ? <LoadingRows /> : cmp.isError || !d ? <ErrorState error={cmp.error} onRetry={() => cmp.refetch()} /> : (
            <div className="mt-5 space-y-7">
              <section>
                <h3 className="mb-2 text-sm font-medium">العروض المستلمة ({d.quotations.length} من {d.minQuotes} على الأقل)</h3>
                {d.quotations.length === 0 ? <p className="text-sm text-muted-foreground">لم يُدخل أي عرض بعد.</p> : (
                  <div className="overflow-x-auto rounded-xl border bg-card">
                    <table className="w-full min-w-[560px] text-sm" data-testid="table-comparison">
                      <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground"><th className="px-3 py-2 font-medium">المورد</th><th className="px-3 py-2 font-medium">قبل الضريبة</th><th className="px-3 py-2 font-medium">الإجمالي</th><th className="px-3 py-2 font-medium">التوريد</th><th className="px-3 py-2 font-medium">فني / جودة / مالي</th><th className="px-3 py-2" /></tr></thead>
                      <tbody>
                        {d.quotations.map((q) => (
                          <tr key={q.quotation_id} className="border-b border-border/60 last:border-0" data-testid={`row-quote-${q.quotation_id}`}>
                            <td className="px-3 py-2 font-medium">{q.legal_name} {q.isLowest && <span className="mr-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">الأقل سعرًا</span>}{d.award?.quotationId === q.quotation_id && <span className="mr-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">المرشّح</span>}</td>
                            <td className="px-3 py-2 num">{fmtSAR(q.net_halalas / 100)}</td><td className="px-3 py-2 num">{fmtSAR((q.net_halalas + q.vat_halalas) / 100)}</td>
                            <td className="px-3 py-2 num">{q.delivery_days == null ? "—" : `${q.delivery_days} يوم`}</td>
                            <td className="px-3 py-2 num text-[12px]">{q.technical ?? "—"} / {q.quality ?? "—"} / {q.commercial ?? "—"}</td>
                            <td className="px-3 py-2 text-left">{open && !d.award?.approvedBy && <Button size="sm" variant="ghost" className="gap-1" onClick={() => setEvalFor(q.quotation_id)}><Star className="h-3.5 w-3.5" /> تقييم</Button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">الموردون المدعوون: {d.invited.map((s) => `${s.legal_name}${quoted.has(s.id) ? " ✓" : ""}`).join("، ")}</p>
              </section>

              {canBuy && d.rfq.status === "open" && (
                <section className="rounded-xl border p-4">
                  <h3 className="mb-3 text-sm font-medium">إدخال عرض سعر</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label className="mb-1.5 block text-xs">المورد</Label>
                      <Select value={quoteFor} onValueChange={setQuoteFor}><SelectTrigger data-testid="select-quote-supplier"><SelectValue placeholder="اختر مورّدًا لم يقدّم عرضه" /></SelectTrigger>
                        <SelectContent>{d.invited.filter((s) => !quoted.has(s.id)).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.legal_name}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label className="mb-1.5 block text-xs">مدة التوريد (أيام)</Label><Input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} /></div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {lines.map((l) => (
                      <div key={l.item_id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1">{l.name} <span className="text-[11px] text-muted-foreground">× {l.qty} {l.unit}</span></span>
                        <Input className="w-32" type="number" min={0} step="0.01" placeholder="سعر الوحدة (ر.س)" value={prices[l.item_id] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [l.item_id]: e.target.value }))} data-testid={`input-quote-price-${l.item_id}`} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">الأسعار قبل الضريبة (15%). الرقم الضريبي للمورد يؤخذ من سجله المعتمد.</p>
                  <Button className="mt-3" disabled={!quoteReady} data-testid="button-quote-save" onClick={() => act.run(() => api(`/procurement/rfqs/${rfqId}/quotations`, { method: "POST", body: {
                    supplierId: Number(quoteFor), quoteDate: new Date().toISOString().slice(0, 10), deliveryDays: days ? Number(days) : undefined,
                    lines: lines.map((l) => ({ itemId: l.item_id, unitPriceHalalas: toHalalas(prices[l.item_id] ?? 0) })),
                  } }), { success: "تم تسجيل العرض", refresh, onDone: () => { setQuoteFor(""); setPrices({}); setDays(""); } })}>تسجيل العرض</Button>
                </section>
              )}

              <section className="rounded-xl border p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><Award className="h-4 w-4 text-accent" /> الترسية</h3>
                {d.award ? (
                  <div className="space-y-2 text-sm">
                    <p>الترسية المرشّحة: <b>{d.quotations.find((q) => q.quotation_id === d.award!.quotationId)?.legal_name}</b> {d.award.isLowestPrice ? "(الأقل سعرًا)" : "(ليست الأقل سعرًا)"}</p>
                    {d.award.justification && <p className="rounded-lg bg-muted/50 p-3 text-xs">المبرر: {d.award.justification}</p>}
                    {d.award.approvedBy ? <p className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" /> اعتمدها مدير الفرع</p> : canApprove ? (
                      <Button data-testid="button-award-approve" onClick={() => act.run(() => api(`/procurement/rfqs/${rfqId}/award/approve`, { method: "POST" }), { success: "اعتُمدت الترسية", refresh })}>اعتماد الترسية</Button>
                    ) : <p className="text-xs text-muted-foreground">بانتظار اعتماد مدير الفرع أو من فوّضته الإدارة.</p>}
                  </div>
                ) : canBuy && d.quotations.length >= d.minQuotes ? (
                  <div className="space-y-3">
                    <div><Label className="mb-1.5 block text-xs">العرض المرشَّح</Label>
                      <Select value={pick} onValueChange={setPick}><SelectTrigger data-testid="select-award"><SelectValue placeholder="اختر العرض" /></SelectTrigger>
                        <SelectContent>{d.quotations.map((q) => <SelectItem key={q.quotation_id} value={String(q.quotation_id)}>{q.legal_name} — {fmtSAR(q.net_halalas / 100)}{q.isLowest ? " (الأقل)" : ""}</SelectItem>)}</SelectContent></Select></div>
                    {needsWhy && <div><Label className="mb-1.5 block text-xs">سبب عدم اختيار الأقل سعرًا (إلزامي)</Label><Textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={600} placeholder="الجودة، مدة التوريد، الخبرة، شروط الدفع..." data-testid="input-award-why" /></div>}
                    <Button disabled={!pick || (needsWhy && why.trim().length < 10)} data-testid="button-award-recommend" onClick={() => act.run(() => api(`/procurement/rfqs/${rfqId}/award`, { method: "POST", body: { quotationId: Number(pick), justification: why.trim() || undefined } }), { success: "رُفعت التوصية للاعتماد", refresh })}>رفع التوصية</Button>
                  </div>
                ) : <p className="text-sm text-muted-foreground">لا تُقبل الترسية قبل استلام ثلاثة عروض من موردين مختلفين.</p>}
              </section>

              {canBuy && d.award?.approvedBy && d.rfq.status === "awarded" && (
                <section className="rounded-xl border p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-accent" /> أمر الشراء</h3>
                  <div className="grid gap-3 sm:grid-cols-2"><div><Label className="mb-1.5 block text-xs">تاريخ التسليم المطلوب</Label><Input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} data-testid="input-po-delivery" /></div></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">يصدر باسم الجهة بالرقم الضريبي للجهة والمورد، ويتطلب تأكيدك برمز OTP. بعد التجهيز يُجمَّد ويُرفع لاعتماد مدير الفرع.</p>
                  <Button className="mt-3" data-testid="button-po-prepare" onClick={() => act.run(() => api(`/procurement/rfqs/${rfqId}/purchase-order`, { method: "POST", body: { deliveryDate: delivery || undefined } }), { success: "جُهّز أمر الشراء وبانتظار الاعتماد", refresh })}>تجهيز أمر الشراء</Button>
                </section>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      {evalFor != null && <EvaluateDialog quotationId={evalFor} onClose={() => setEvalFor(null)} refresh={refresh} />}
      {act.dialog}
    </>
  );
}

function EvaluateDialog({ quotationId, onClose, refresh }: { quotationId: number; onClose: () => void; refresh: string[] }) {
  const act = useAct();
  const [s, setS] = useState({ technicalScore: "", qualityScore: "", commercialScore: "" });
  const ok = Object.values(s).every((v) => v !== "" && Number(v) >= 0 && Number(v) <= 100);
  const f = (k: keyof typeof s, label: string) => <div><Label className="mb-1.5 block text-xs">{label}</Label><Input type="number" min={0} max={100} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></div>;
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">تقييم العرض</DialogTitle><DialogDescription>درجات من 0 إلى 100؛ تُحفظ باسمك ويمكنك تعديلها لاحقًا.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-3">{f("technicalScore", "فني")}{f("qualityScore", "جودة")}{f("commercialScore", "مالي")}</div>
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={!ok} data-testid="button-eval-save" onClick={() => act.run(() => api(`/procurement/quotations/${quotationId}/evaluate`, { method: "POST", body: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])) }), { success: "تم حفظ التقييم", refresh, onDone: onClose })}>حفظ</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}
