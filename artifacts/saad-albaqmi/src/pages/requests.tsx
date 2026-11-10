import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, Inbox, Mail, Phone, Plus, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader, ErrorState, LoadingRows, EmptyState, Kpi } from "@/components/bits";
import { usePageTitle } from "@/hooks/use-data";
import { api, useAct, useOps, useRole } from "@/hooks/use-ops";
import { cn } from "@/lib/utils";

type Status = "sent" | "received" | "responded" | "closed" | "cancelled";
type Req = {
  id: number; requestNo: string; title: string; description: string | null; requestType: string; priority: string; status: Status;
  branchName: string; assigneeId: number; assigneeName: string; assigneeJobTitle: string | null; assigneeEmail: string | null; assigneePhone: string | null;
  createdByEmail: string | null; dueAt: string | null; sentAt: string; receivedAt: string | null; respondedAt: string | null; closedAt: string | null; cancelledAt: string | null;
  responseText: string | null; responseLinks: string[]; closeNote: string | null; receiveSeconds: number | null; responseSeconds: number | null; totalSeconds: number | null; isLate: boolean;
};
type Detail = Req & { events: { id: number; eventType: string; note: string | null; createdAt: string; actorEmail: string | null }[]; viewer: { isAssignee: boolean; canManage: boolean } };
type Catalogue = { canManage: boolean; employees: { id: number; name: string; jobTitle: string | null; email: string | null; phone: string | null; branchName: string }[]; types: { id: string; label: string }[]; priorities: { id: string; label: string }[] };
type Stats = {
  totals: { total: number; sent: number; received: number; responded: number; closed: number; cancelled: number; late: number; avgReceiveSeconds: number | null; avgResponseSeconds: number | null; avgTotalSeconds: number | null };
  perEmployee: { assigneeId: number; name: string; jobTitle: string | null; total: number; closed: number; open: number; late: number; avgReceiveSeconds: number | null; avgResponseSeconds: number | null }[];
  awaitingClose: Req[];
};

const STATUS_LABEL: Record<Status, string> = { sent: "أُرسل ولم يُفتح", received: "قيد التنفيذ", responded: "بانتظار الإغلاق", closed: "مغلق", cancelled: "ملغى" };
const STATUS_TONE: Record<Status, string> = {
  sent: "bg-warning/12 text-[hsl(32_80%_32%)]", received: "bg-primary/10 text-primary", responded: "bg-accent/20 text-[hsl(22_75%_34%)]",
  closed: "bg-success/10 text-success", cancelled: "bg-muted text-muted-foreground",
};
const TYPE_LABEL: Record<string, string> = { registration: "تسجيل في موقع", upload: "رفع ملفات", report: "إعداد تقرير", other: "أخرى" };
const PRIORITY_LABEL: Record<string, string> = { normal: "عادية", high: "مهمة", urgent: "عاجلة" };
const EVENT_LABEL: Record<string, string> = { created: "أُرسل الطلب", received: "اطّلع الموظف على الطلب", responded: "ردّ الموظف", closed: "اعتمد المدير الإغلاق", cancelled: "أُلغي الطلب" };

const when = (s: string | null) => (s ? new Date(s).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" }) : "—");
/** Human duration: "أقل من دقيقة", "35 دقيقة", "2 ساعة و10 دقيقة", "3 يوم و4 ساعة". */
function dur(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return "—";
  const m = Math.round(sec / 60);
  if (m < 1) return "أقل من دقيقة";
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h} ساعة و${rm} دقيقة` : `${h} ساعة`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} يوم و${rh} ساعة` : `${d} يوم`;
}

function RqStatus({ r }: { r: Pick<Req, "status" | "isLate"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium", STATUS_TONE[r.status])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{STATUS_LABEL[r.status]}</span>
      {r.isLate && r.status !== "closed" && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">متأخر</span>}
    </span>
  );
}
const PriorityTag = ({ p }: { p: string }) => (p === "normal" ? null : <span className={cn("rounded-full px-2 py-0.5 text-[11px]", p === "urgent" ? "bg-destructive/10 text-destructive" : "bg-warning/12 text-[hsl(32_80%_32%)]")}>{PRIORITY_LABEL[p]}</span>);

function Table({ head, children, testId }: { head: string[]; children: ReactNode; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[820px] text-sm" data-testid={testId}>
        <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function RequestsPage() {
  usePageTitle("الطلبات والمهام");
  const { role } = useRole();
  const isManager = role === "super_admin" || role === "branch_manager";
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<string | null>(null);   // until the user picks one, managers land on the dashboard and staff on their inbox
  const stats = useOps<Stats>(["rq-stats"], "/requests/stats", isManager);

  return (
    <>
      <PageHeader eyebrow="الإدارة" title="الطلبات والمهام"
        desc={isManager ? "أرسل المهام إلى موظفيك وتابعها: يسجّل النظام وقت الإرسال والاستقبال والرد والإغلاق تلقائيًا ويحسب مدة كل مرحلة." : "طلبات الإدارة الموجّهة إليك. افتح الطلب ليُسجَّل استقبالك، ثم ارفع ردّك وإثباتك."}
        actions={isManager ? <Button onClick={() => setCreating(true)} className="gap-1.5" data-testid="button-new-request"><Plus className="h-4 w-4" /> طلب جديد</Button> : undefined} />
      <Tabs value={tab ?? (isManager ? "dashboard" : "mine")} onValueChange={setTab} dir="rtl">
        <TabsList className="mb-4 flex-wrap">
          {isManager && <TabsTrigger value="dashboard" data-testid="tab-dashboard">لوحة المتابعة</TabsTrigger>}
          {isManager && <TabsTrigger value="all" data-testid="tab-all">كل الطلبات</TabsTrigger>}
          <TabsTrigger value="mine" data-testid="tab-mine">طلباتي{isManager ? " (الموجّهة إليّ)" : ""}</TabsTrigger>
        </TabsList>
        {isManager && <TabsContent value="dashboard"><Dashboard stats={stats} onOpen={setOpenId} /></TabsContent>}
        {isManager && <TabsContent value="all"><AllRequests onOpen={setOpenId} /></TabsContent>}
        <TabsContent value="mine"><Mine onOpen={setOpenId} /></TabsContent>
      </Tabs>
      {creating && <NewRequest onClose={() => setCreating(false)} />}
      <DetailSheet id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function Dashboard({ stats, onOpen }: { stats: ReturnType<typeof useOps<Stats>>; onOpen: (id: number) => void }) {
  if (stats.isLoading) return <LoadingRows rows={4} />;
  if (stats.isError || !stats.data) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  const { totals: t, perEmployee, awaitingClose } = stats.data;
  const open = t.sent + t.received + t.responded;
  return (
    <div className="space-y-6" data-testid="requests-dashboard">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="كل الطلبات" value={t.total} sub={`${open} مفتوح`} tone="accent" />
        <Kpi label="لم تُفتح بعد" value={t.sent} sub="أُرسلت ولم يطّلع عليها الموظف" />
        <Kpi label="قيد التنفيذ" value={t.received} sub="اطّلع عليها الموظف" delay={40} />
        <Kpi label="بانتظار إغلاقك" value={t.responded} sub="ردّ الموظف وتنتظر اعتمادك" delay={80} />
        <Kpi label="مغلقة" value={t.closed} sub={`${t.cancelled} ملغاة`} delay={120} />
        <Kpi label="متأخرة" value={t.late} sub="تجاوزت موعد التسليم" delay={160} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[["متوسط زمن الاستقبال", "من الإرسال إلى أول فتح", t.avgReceiveSeconds], ["متوسط زمن الرد", "من الاستقبال إلى الرد", t.avgResponseSeconds], ["متوسط المدة الكلية", "من الإرسال إلى الإغلاق", t.avgTotalSeconds]].map(([label, sub, v]) => (
          <div key={label as string} className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">{label as string}</div><div className="mt-2 text-xl font-medium">{dur(v as number | null)}</div><div className="mt-1 text-[11px] text-muted-foreground">{sub as string}</div></div>
        ))}
      </div>
      <section>
        <h2 className="mb-2 font-display text-lg">بانتظار إغلاقك</h2>
        {awaitingClose.length === 0 ? <EmptyState title="لا شيء بانتظارك" desc="عندما يردّ موظف على طلب يظهر هنا لتراجعه وتعتمد إغلاقه." /> : (
          <Table head={["الطلب", "الموظف", "وقت الرد", "مدة الرد"]} testId="table-awaiting">
            {awaitingClose.map((r) => (
              <tr key={r.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => onOpen(r.id)}>
                <td className="px-4 py-3"><div className="font-medium">{r.title}</div><div className="num text-[11px] text-muted-foreground">{r.requestNo}</div></td>
                <td className="px-4 py-3">{r.assigneeName}</td><td className="px-4 py-3">{when(r.respondedAt)}</td><td className="px-4 py-3">{dur(r.responseSeconds)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-display text-lg">أداء الموظفين</h2>
        {perEmployee.length === 0 ? <EmptyState title="لا توجد طلبات بعد" desc="أنشئ أول طلب لتظهر هنا مؤشرات الموظفين." /> : (
          <Table head={["الموظف", "الطلبات", "مفتوحة", "مغلقة", "متأخرة", "متوسط الاستقبال", "متوسط الرد"]} testId="table-employees">
            {perEmployee.map((e) => (
              <tr key={e.assigneeId} className="border-b last:border-0">
                <td className="px-4 py-3"><div className="font-medium">{e.name}</div><div className="text-[11px] text-muted-foreground">{e.jobTitle ?? "—"}</div></td>
                <td className="num px-4 py-3">{e.total}</td><td className="num px-4 py-3">{e.open}</td><td className="num px-4 py-3">{e.closed}</td>
                <td className={cn("num px-4 py-3", e.late > 0 && "font-medium text-destructive")}>{e.late}</td>
                <td className="px-4 py-3">{dur(e.avgReceiveSeconds)}</td><td className="px-4 py-3">{dur(e.avgResponseSeconds)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

function AllRequests({ onOpen }: { onOpen: (id: number) => void }) {
  const cat = useOps<Catalogue>(["rq-cat"], "/requests/catalogue");
  const [status, setStatus] = useState("all"); const [assignee, setAssignee] = useState("all"); const [q, setQ] = useState("");
  const [qDebounced, setQd] = useState("");
  useEffect(() => { const t = setTimeout(() => setQd(q), 300); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ scope: "managed" });
  if (status !== "all") qs.set("status", status);
  if (assignee !== "all") qs.set("assigneeId", assignee);
  if (qDebounced.trim()) qs.set("q", qDebounced.trim());
  const list = useOps<Req[]>(["rq-managed", qs.toString()], `/requests?${qs}`);
  return (
    <div className="space-y-3" data-testid="requests-all">
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالعنوان أو الرقم أو الموظف" className="w-64" data-testid="input-search" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" data-testid="filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem><SelectItem value="open">المفتوحة</SelectItem><SelectItem value="late">المتأخرة</SelectItem>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="w-52" data-testid="filter-assignee"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">كل الموظفين</SelectItem>{cat.data?.employees.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {list.isLoading ? <LoadingRows /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.length ? (
        <EmptyState title="لا توجد طلبات مطابقة" desc="غيّر عوامل التصفية أو أنشئ طلبًا جديدًا." />
      ) : (
        <Table head={["الطلب", "الموظف", "الحالة", "أُرسل", "استُقبل", "ردّ", "أُغلق", "المدة الكلية"]} testId="table-requests">
          {list.data.map((r) => (
            <tr key={r.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => onOpen(r.id)} data-testid={`row-request-${r.id}`}>
              <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-1.5 font-medium">{r.title}<PriorityTag p={r.priority} /></div><div className="text-[11px] text-muted-foreground"><span className="num">{r.requestNo}</span> · {TYPE_LABEL[r.requestType]}</div></td>
              <td className="px-4 py-3"><div>{r.assigneeName}</div><div className="text-[11px] text-muted-foreground">{r.assigneeJobTitle ?? "—"}</div></td>
              <td className="px-4 py-3"><RqStatus r={r} /></td>
              <td className="px-4 py-3 text-xs">{when(r.sentAt)}</td><td className="px-4 py-3 text-xs">{when(r.receivedAt)}</td>
              <td className="px-4 py-3 text-xs">{when(r.respondedAt)}</td><td className="px-4 py-3 text-xs">{when(r.closedAt)}</td>
              <td className="px-4 py-3 text-xs">{dur(r.totalSeconds)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Mine({ onOpen }: { onOpen: (id: number) => void }) {
  const list = useOps<Req[]>(["rq-mine"], "/requests?scope=mine");
  if (list.isLoading) return <LoadingRows />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data?.length) return <EmptyState title="لا توجد طلبات موجّهة إليك" desc="عندما يرسل لك مدير طلبًا سيظهر هنا ويصلك إشعار." />;
  const waiting = list.data.filter((r) => r.status === "sent" || r.status === "received");
  const rest = list.data.filter((r) => !waiting.includes(r));
  const Card = ({ r }: { r: Req }) => (
    <button type="button" onClick={() => onOpen(r.id)} className="w-full rounded-xl border bg-card p-4 text-right transition hover:-translate-y-0.5 hover:shadow-sm" data-testid={`card-request-${r.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="font-medium">{r.title}</div><RqStatus r={r} /></div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="num">{r.requestNo}</span><span>{TYPE_LABEL[r.requestType]}</span><PriorityTag p={r.priority} />
        <span>من: {r.createdByEmail ?? "—"}</span></div>
      <div className="mt-2 text-xs text-muted-foreground">أُرسل {when(r.sentAt)}{r.dueAt ? ` · التسليم قبل ${when(r.dueAt)}` : ""}</div>
    </button>
  );
  return (
    <div className="space-y-5" data-testid="requests-mine">
      <section><h2 className="mb-2 font-display text-lg">بانتظار ردّك ({waiting.length})</h2>{waiting.length ? <div className="grid gap-3 md:grid-cols-2">{waiting.map((r) => <Card key={r.id} r={r} />)}</div> : <p className="text-sm text-muted-foreground">لا شيء بانتظار ردّك الآن.</p>}</section>
      {rest.length > 0 && <section><h2 className="mb-2 font-display text-lg">السابقة</h2><div className="grid gap-3 md:grid-cols-2">{rest.map((r) => <Card key={r.id} r={r} />)}</div></section>}
    </div>
  );
}

function Stage({ n, title, at, note, done, last }: { n: number; title: string; at: string | null; note?: string; done: boolean; last?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span className={cn("absolute right-[13px] top-7 h-[calc(100%-1.75rem)] w-px", done ? "bg-primary/40" : "bg-border")} />}
      <span className={cn("z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold", done ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground")}>{done ? <CheckCircle2 className="h-4 w-4" /> : n}</span>
      <div><div className={cn("text-sm font-medium", !done && "text-muted-foreground")}>{title}</div><div className="text-xs text-muted-foreground">{done ? when(at) : "لم تتم بعد"}</div>{note && done && <div className="mt-0.5 text-xs text-primary">{note}</div>}</div>
    </li>
  );
}

function DetailSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useOps<Detail>(["rq-detail", id], `/requests/${id}`, id != null);
  const act = useAct();
  const d = q.data;
  const [text, setText] = useState(""); const [links, setLinks] = useState(""); const [note, setNote] = useState(""); const [mode, setMode] = useState<"respond" | "close" | "cancel" | null>(null);
  useEffect(() => { setText(""); setLinks(""); setNote(""); setMode(null); }, [id]);
  // Stage 2: the assignee's first view stamps "received" on the server; refresh afterwards so every screen shows it.
  useEffect(() => {
    if (!d || !d.viewer.isAssignee || d.status !== "sent") return;
    void api(`/requests/${d.id}/open`, { method: "POST", body: {} }).then(() => { for (const k of ["rq-detail", "rq-mine", "rq-managed", "rq-stats"]) void qc.invalidateQueries({ queryKey: ["ops", k] }); }).catch(() => undefined);
  }, [d?.id, d?.status, d?.viewer.isAssignee, qc]);
  const refresh = ["rq-detail", "rq-mine", "rq-managed", "rq-stats"];
  const post = (path: string, body: unknown, success: string) => act.run(() => api(`/requests/${id}/${path}`, { method: "POST", body }), { success, refresh, onDone: () => { setMode(null); setNote(""); setText(""); setLinks(""); } });
  const linkList = useMemo(() => links.split(/\s+/).map((s) => s.trim()).filter(Boolean), [links]);

  return (
    <Sheet open={id != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-xl" dir="rtl" data-testid="request-detail">
        {q.isLoading || !d ? <div className="pt-10">{q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <LoadingRows rows={5} />}</div> : (
          <>
            <SheetHeader className="text-right">
              <SheetTitle className="flex flex-wrap items-center gap-2 font-display text-xl">{d.title}<PriorityTag p={d.priority} /></SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2"><span className="num">{d.requestNo}</span>·<span>{TYPE_LABEL[d.requestType]}</span>·<RqStatus r={d} /></SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <section className="rounded-xl border bg-card p-3 text-sm">
                <div className="font-medium">{d.assigneeName}<span className="mr-2 text-xs font-normal text-muted-foreground">{d.assigneeJobTitle ?? ""} · {d.branchName}</span></div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {d.assigneePhone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /><span className="num">{d.assigneePhone}</span></span>}
                  {d.assigneeEmail && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /><span dir="ltr">{d.assigneeEmail}</span></span>}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">المرسِل: <span dir="ltr">{d.createdByEmail ?? "—"}</span>{d.dueAt ? ` · موعد التسليم: ${when(d.dueAt)}` : ""}</div>
              </section>
              {d.description && <section><h3 className="mb-1 text-sm font-medium">تفاصيل الطلب</h3><p className="whitespace-pre-wrap text-sm leading-7">{d.description}</p></section>}
              <section>
                <h3 className="mb-3 text-sm font-medium">مراحل الطلب</h3>
                <ol data-testid="stages">
                  <Stage n={1} title="الإرسال" at={d.sentAt} done />
                  <Stage n={2} title="الاستقبال" at={d.receivedAt} done={!!d.receivedAt} note={d.receivedAt ? `بعد ${dur(d.receiveSeconds)} من الإرسال` : undefined} />
                  <Stage n={3} title="الرد" at={d.respondedAt} done={!!d.respondedAt} note={d.respondedAt ? `بعد ${dur(d.responseSeconds)} من الاستقبال` : undefined} />
                  <Stage n={4} title={d.status === "cancelled" ? "الإلغاء" : "الإغلاق النهائي"} at={d.status === "cancelled" ? d.cancelledAt : d.closedAt} done={d.status === "closed" || d.status === "cancelled"} last
                    note={d.status === "closed" ? `المدة الكلية ${dur(d.totalSeconds)}` : undefined} />
                </ol>
              </section>
              {d.responseText && (
                <section className="rounded-xl border bg-card p-3">
                  <h3 className="mb-1 text-sm font-medium">رد الموظف</h3>
                  <p className="whitespace-pre-wrap text-sm leading-7">{d.responseText}</p>
                  {d.responseLinks.length > 0 && <ul className="mt-2 space-y-1 text-xs">{d.responseLinks.map((l) => <li key={l}><a href={l} target="_blank" rel="noopener noreferrer" className="text-primary underline" dir="ltr">{l}</a></li>)}</ul>}
                </section>
              )}
              {d.closeNote && <p className="rounded-lg bg-muted/60 p-3 text-sm">ملاحظة المدير: {d.closeNote}</p>}

              {d.viewer.isAssignee && (d.status === "sent" || d.status === "received") && (
                <section className="space-y-2" data-testid="respond-form">
                  <h3 className="text-sm font-medium">ردّك على الطلب</h3>
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="اكتب ما أنجزته" data-testid="input-response" />
                  <Label className="text-xs text-muted-foreground">روابط الإثبات أو الملفات المرفوعة (اختياري، رابط في كل سطر)</Label>
                  <Textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={2} dir="ltr" placeholder="https://..." data-testid="input-links" />
                  <Button className="gap-1.5" disabled={text.trim().length < 3} onClick={() => post("respond", { text, links: linkList }, "أُرسل ردّك")} data-testid="button-respond"><Send className="h-4 w-4" /> إرسال الرد</Button>
                </section>
              )}
              {d.viewer.canManage && !d.viewer.isAssignee && d.status === "responded" && (
                <section className="space-y-2" data-testid="close-form">
                  <h3 className="text-sm font-medium">مراجعة النتيجة</h3>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة الإغلاق (اختياري)" data-testid="input-close-note" />
                  <Button className="gap-1.5" onClick={() => post("close", { note }, "أُغلق الطلب")} data-testid="button-close"><CheckCircle2 className="h-4 w-4" /> اعتماد الإغلاق النهائي</Button>
                </section>
              )}
              {d.viewer.canManage && ["sent", "received", "responded"].includes(d.status) && (
                <section>
                  {mode === "cancel" ? (
                    <div className="space-y-2"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="سبب الإلغاء (إلزامي)" data-testid="input-cancel-reason" />
                      <div className="flex gap-2"><Button variant="destructive" disabled={!note.trim()} onClick={() => post("cancel", { note }, "أُلغي الطلب")} data-testid="button-confirm-cancel">تأكيد الإلغاء</Button><Button variant="outline" onClick={() => { setMode(null); setNote(""); }}>تراجع</Button></div></div>
                  ) : <Button variant="outline" className="gap-1.5 text-destructive" onClick={() => { setMode("cancel"); setNote(""); }} data-testid="button-cancel"><XCircle className="h-4 w-4" /> إلغاء الطلب</Button>}
                </section>
              )}
              <section>
                <h3 className="mb-2 text-sm font-medium">سجل الأحداث</h3>
                <ul className="space-y-1.5 text-xs" data-testid="timeline">
                  {d.events.map((e) => <li key={e.id} className="flex flex-wrap gap-x-2 text-muted-foreground"><Clock3 className="mt-0.5 h-3 w-3" /><span className="text-foreground">{EVENT_LABEL[e.eventType] ?? e.eventType}</span><span>{when(e.createdAt)}</span><span dir="ltr">{e.actorEmail ?? ""}</span>{e.note && <span className="w-full pr-5">{e.note}</span>}</li>)}
                </ul>
              </section>
            </div>
          </>
        )}
        {act.dialog}
      </SheetContent>
    </Sheet>
  );
}

function NewRequest({ onClose }: { onClose: () => void }) {
  const cat = useOps<Catalogue>(["rq-cat"], "/requests/catalogue");
  const act = useAct();
  const [f, setF] = useState({ assigneeId: "", title: "", requestType: "other", priority: "normal", dueAt: "", description: "" });
  const emp = cat.data?.employees.find((e) => String(e.id) === f.assigneeId);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = () => act.run(() => api("/requests", { method: "POST", body: { assigneeId: Number(f.assigneeId), title: f.title, requestType: f.requestType, priority: f.priority, description: f.description, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null } }),
    { success: "أُرسل الطلب إلى الموظف", refresh: ["rq-managed", "rq-stats", "rq-mine"], onDone: onClose });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg" dir="rtl" data-testid="new-request-dialog">
        <DialogHeader className="text-right"><DialogTitle className="font-display text-xl">طلب جديد</DialogTitle><DialogDescription>يُسجَّل وقت الإرسال تلقائيًا ويصل الموظف إشعار داخل النظام وعلى بريده.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>الموظف</Label>
            <Select value={f.assigneeId} onValueChange={set("assigneeId")}>
              <SelectTrigger data-testid="select-assignee"><SelectValue placeholder={cat.isLoading ? "جارٍ التحميل..." : "اختر الموظف"} /></SelectTrigger>
              <SelectContent>{cat.data?.employees.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}{e.jobTitle ? ` — ${e.jobTitle}` : ""}</SelectItem>)}</SelectContent>
            </Select>
            {emp && <p className="mt-1 text-xs text-muted-foreground">{emp.branchName} · <span className="num">{emp.phone ?? "لا رقم جوال"}</span> · <span dir="ltr">{emp.email ?? "لا بريد"}</span></p>}
            {emp && !emp.email && <p className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" />لا بريد لهذا الموظف، فلن يستطيع فتح الطلب في النظام. أضف بريده من الموارد البشرية.</p>}
          </div>
          <div><Label>عنوان الطلب</Label><Input value={f.title} onChange={(e) => set("title")(e.target.value)} maxLength={200} placeholder="مثال: التسجيل في منصة قوى" data-testid="input-title" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>النوع</Label><Select value={f.requestType} onValueChange={set("requestType")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>الأولوية</Label><Select value={f.priority} onValueChange={set("priority")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div><Label>موعد التسليم (اختياري)</Label><Input type="datetime-local" value={f.dueAt} onChange={(e) => set("dueAt")(e.target.value)} dir="ltr" data-testid="input-due" /></div>
          <div><Label>التفاصيل</Label><Textarea value={f.description} onChange={(e) => set("description")(e.target.value)} rows={4} maxLength={4000} placeholder="اكتب المطلوب بدقة: الموقع، الملفات، الشكل المتوقع للتسليم" data-testid="input-description" /></div>
        </div>
        <DialogFooter className="gap-2 sm:justify-start"><Button onClick={submit} disabled={!f.assigneeId || !f.title.trim()} className="gap-1.5" data-testid="button-send-request"><Inbox className="h-4 w-4" /> إرسال الطلب</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        {act.dialog}
      </DialogContent>
    </Dialog>
  );
}
