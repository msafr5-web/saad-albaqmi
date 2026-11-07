import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Nfc, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/bits";
import { usePageTitle } from "@/hooks/use-data";
import { api, useAct, useOps, useRole } from "@/hooks/use-ops";
import { useToast } from "@/hooks/use-toast";

type Holder = { id: number; name: string; number: string; branch_id: number | null; cardId: number | null; cardType: string | null };
type RoomTag = { id: number; name: string; token: string };
type Today = { id: number; name: string; holder_type: string; event_type: string; occurred_at: string; method: string };
const TYPES = { employee: "الموظفون", instructor: "المدربون", student: "الطلاب" } as const;
type HolderType = keyof typeof TYPES;
const when = (s: string) => new Date(s).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });

function useQr(text: string, width = 220) {
  const [src, setSrc] = useState("");
  useEffect(() => { let live = true; QRCode.toDataURL(text, { margin: 1, width, errorCorrectionLevel: "M" }).then((u) => live && setSrc(u)); return () => { live = false; }; }, [text, width]);
  return src;
}

/** Administration of identity cards and attendance: issue NFC tags, stop lost cards, print room tags, see today's log. */
export default function AttendancePage() {
  usePageTitle("الحضور والبطاقات");
  const { role } = useRole();
  const manage = ["super_admin", "hr_officer", "branch_manager"].includes(role);
  return (
    <>
      <PageHeader eyebrow="الهوية الرقمية" title="الحضور والبطاقات" desc="كل صاحب حساب لديه بطاقة رقمية في التطبيق بـ QR متجدد. هنا تُصدر بطاقات NFC فيزيائية، وتُوقف المفقود منها فورًا، وتُطبع علامات القاعات لتسجيل حضور المدربين." />
      <Tabs defaultValue={manage ? "cards" : "today"} dir="rtl">
        <TabsList className="mb-4 flex-wrap">
          {manage && <TabsTrigger value="cards" data-testid="tab-cards">البطاقات</TabsTrigger>}
          {manage && <TabsTrigger value="rooms" data-testid="tab-room-tags">علامات القاعات</TabsTrigger>}
          <TabsTrigger value="today" data-testid="tab-today">حركة اليوم</TabsTrigger>
        </TabsList>
        {manage && <TabsContent value="cards"><Cards /></TabsContent>}
        {manage && <TabsContent value="rooms"><RoomTags /></TabsContent>}
        <TabsContent value="today"><TodayLog /></TabsContent>
      </Tabs>
    </>
  );
}

function Cards() {
  const [type, setType] = useState<HolderType>("employee");
  const holders = useOps<Holder[]>(["holders", type], `/cards/holders?type=${type}`);
  const act = useAct();
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
  const [revoke, setRevoke] = useState<Holder | null>(null);
  const [q, setQ] = useState("");
  const list = (holders.data ?? []).filter((h) => !q || h.name.includes(q) || h.number.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-44"><Select value={type} onValueChange={(v) => setType(v as HolderType)}><SelectTrigger data-testid="select-holder-type"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
        <Input className="max-w-xs" placeholder="بحث بالاسم أو الرقم" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {holders.isLoading ? <LoadingRows /> : holders.isError ? <ErrorState error={holders.error} onRetry={() => holders.refetch()} /> : !list.length ? <EmptyState title="لا توجد نتائج" desc="تظهر هنا سجلات الفئة المختارة في نطاقك." /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[560px] text-sm" data-testid="table-holders">
            <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground"><th className="px-4 py-3 font-medium">الرقم</th><th className="px-4 py-3 font-medium">الاسم</th><th className="px-4 py-3 font-medium">البطاقة</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{list.map((h) => (
              <tr key={h.id} className="border-b border-border/60 last:border-0" data-testid={`row-holder-${h.id}`}>
                <td className="px-4 py-3 num" dir="ltr">{h.number}</td><td className="px-4 py-3 font-medium">{h.name}</td>
                <td className="px-4 py-3 text-[12px]">{h.cardId ? (h.cardType === "nfc" ? "NFC + رقمية" : "رقمية") : <span className="text-muted-foreground">لم تُفعَّل بعد</span>}</td>
                <td className="px-4 py-3 text-left"><div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="outline" className="gap-1.5" data-testid={`button-issue-${h.id}`} onClick={() => act.run(async () => { const r = await api<{ token: string }>("/cards/issue", { method: "POST", body: { holderType: type, holderId: h.id } }); setIssued({ token: r.token, name: h.name }); }, { success: "أُصدرت بطاقة NFC", refresh: ["holders"] })}><Nfc className="h-3.5 w-3.5" /> إصدار NFC</Button>
                  {h.cardId && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoke(h)} data-testid={`button-revoke-${h.id}`}>إيقاف</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {issued && <TokenDialog token={issued.token} name={issued.name} onClose={() => setIssued(null)} />}
      {revoke && <RevokeDialog holder={revoke} onClose={() => setRevoke(null)} />}
      {act.dialog}
    </>
  );
}

type NdefWriter = { write: (msg: { records: { recordType: string; data: string }[] }) => Promise<void> };
function TokenDialog({ token, name, onClose }: { token: string; name: string; onClose: () => void }) {
  const qr = useQr(token);
  const { toast } = useToast();
  const canWrite = typeof window !== "undefined" && "NDEFReader" in window;
  const write = async () => {
    try { const w = new (window as unknown as { NDEFReader: new () => NdefWriter }).NDEFReader(); await w.write({ records: [{ recordType: "text", data: token }] }); toast({ title: "كُتبت البطاقة على الوسم", description: "جرّب مسحها عند البوابة." }); }
    catch { toast({ title: "تعذرت الكتابة", description: "قرّب الوسم من ظهر الجهاز (Chrome على Android) ثم أعد المحاولة.", variant: "destructive" }); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">بطاقة NFC — {name}</DialogTitle><DialogDescription>يُعرض هذا الرمز مرة واحدة فقط ولا يُخزَّن. اكتبه على وسم NFC (يحمل معرّفًا عشوائيًا لا بيانات شخصية)، وأي بطاقة سابقة لنفس الشخص تتوقف.</DialogDescription></DialogHeader>
        <div className="flex flex-col items-center gap-3">{qr && <img src={qr} alt="رمز البطاقة" className="h-44 w-44 rounded-lg border bg-white p-1" />}<code className="max-w-full break-all rounded bg-muted px-2 py-1 text-[11px]" dir="ltr" data-testid="text-token">{token}</code></div>
        <DialogFooter className="gap-2 sm:justify-start">
          {canWrite && <Button className="gap-1.5" onClick={write} data-testid="button-write-nfc"><Nfc className="h-4 w-4" /> كتابة على وسم NFC</Button>}
          <Button variant="outline" className="gap-1.5" onClick={() => { void navigator.clipboard?.writeText(token); toast({ title: "نُسخ الرمز" }); }}><Copy className="h-4 w-4" /> نسخ</Button>
          <Button variant="ghost" onClick={onClose}>تم</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ holder, onClose }: { holder: Holder; onClose: () => void }) {
  const act = useAct();
  const [reason, setReason] = useState(""); const [lost, setLost] = useState(true);
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">إيقاف بطاقة {holder.name}</DialogTitle><DialogDescription>يسري الإيقاف فورًا على كل الأجهزة، وتُصدَر بطاقة جديدة عند أول استخدام لصاحبها.</DialogDescription></DialogHeader>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lost} onChange={(e) => setLost(e.target.checked)} /> مفقودة</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإيقاف" maxLength={200} data-testid="input-revoke-reason" />
          <DialogFooter className="gap-2 sm:justify-start"><Button variant="destructive" disabled={reason.trim().length < 5} data-testid="button-revoke-confirm" onClick={() => act.run(() => api(`/cards/${holder.cardId}/revoke`, { method: "POST", body: { reason, lost } }), { success: "أُوقفت البطاقة", refresh: ["holders"], onDone: onClose })}>إيقاف</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

function RoomTags() {
  const tags = useOps<RoomTag[]>(["room-tags"], "/cards/room-tags");
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">اطبع الرمز وعلّقه عند باب القاعة، أو اكتب نصه على وسم NFC. المدرب يمسحه من جواله ليُسجَّل حضوره خلال حصته.</p><Button variant="outline" className="gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button></div>
      {tags.isLoading ? <LoadingRows /> : !tags.data?.length ? <EmptyState title="لا توجد قاعات" desc="أضف القاعات من صفحة القاعات والمعامل." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="room-tags">{tags.data.map((t) => <RoomTagCard key={t.id} tag={t} />)}</div>
      )}
    </>
  );
}
function RoomTagCard({ tag }: { tag: RoomTag }) {
  const qr = useQr(tag.token, 260);
  return <div className="break-inside-avoid rounded-xl border bg-card p-4 text-center">{qr && <img src={qr} alt={`رمز ${tag.name}`} className="mx-auto h-40 w-40" />}<div className="mt-2 font-display text-lg">{tag.name}</div><div className="text-[11px] text-muted-foreground">سجّل حضورك بمسح هذا الرمز</div></div>;
}

function TodayLog() {
  const today = useOps<Today[]>(["today-presence"], "/presence/today");
  if (today.isLoading) return <LoadingRows />;
  if (today.isError) return <ErrorState error={today.error} onRetry={() => today.refetch()} />;
  if (!today.data?.length) return <EmptyState title="لا توجد حركات اليوم" desc="تظهر هنا مرات الدخول والخروج المسجلة بالبطاقة في نطاقك." />;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[520px] text-sm" data-testid="table-today">
      <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground"><th className="px-4 py-3 font-medium">الاسم</th><th className="px-4 py-3 font-medium">النوع</th><th className="px-4 py-3 font-medium">الحركة</th><th className="px-4 py-3 font-medium">الطريقة</th><th className="px-4 py-3 font-medium">الوقت</th></tr></thead>
      <tbody>{today.data.map((e) => <tr key={e.id} className="border-b border-border/60 last:border-0"><td className="px-4 py-3 font-medium">{e.name}</td><td className="px-4 py-3 text-[12px]">{e.holder_type === "employee" ? "موظف" : e.holder_type === "instructor" ? "مدرب" : "طالب"}</td><td className="px-4 py-3">{e.event_type === "check_in" ? "دخول" : "خروج"}</td><td className="px-4 py-3 text-[12px]">{e.method === "nfc" ? "NFC" : "QR"}</td><td className="px-4 py-3 num">{when(e.occurred_at)}</td></tr>)}</tbody>
    </table></div>
  );
}
