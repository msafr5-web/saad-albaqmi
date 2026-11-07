import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, CheckCircle2, CreditCard, History, LogIn, LogOut, ScanLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/bits";
import { IdCard, type CardData } from "@/components/id-card";
import { ScanSheet } from "@/components/scanner";
import { usePageTitle } from "@/hooks/use-data";
import { api, useOps, useRole } from "@/hooks/use-ops";
import { errorText } from "@/lib/domain";

type Mine = { card: { id: number; number: string; type: string; status: string }; holder: { name: string; number: string; label: string; type: string }; qr: string; qrStepSeconds: number; secondsLeft: number };
type Presence = { id: number; eventType: string; method: string; occurredAt: string; holderType: string };
type Today = { id: number; name: string; holder_type: string; event_type: string; occurred_at: string; method: string };
type Session = { id: number; name: string; start: string; end: string; room_id: number };
type Outcome = { ok: boolean; title: string; detail: string; at: number };
const time = (s: string) => new Date(s).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
const TYPE: Record<string, string> = { student: "طالب", instructor: "مدرب", employee: "موظف" };

/** Mobile-first "card app": the card, a scanner for staff/instructors, and the day's log, with a bottom tab bar (like NFC Tools). */
export default function CardPage() {
  usePageTitle("بطاقتي");
  const { role } = useRole();
  const isGate = ["super_admin", "hr_officer", "branch_manager", "coordinator"].includes(role);
  const isInstructor = role === "instructor";
  const [tab, setTab] = useState<"card" | "scan" | "log">("card");
  const tabs = [{ id: "card", label: "بطاقتي", icon: CreditCard }, ...(isGate || isInstructor ? [{ id: "scan", label: "المسح", icon: ScanLine }] : []), { id: "log", label: "السجل", icon: History }] as const;

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader eyebrow="الهوية الرقمية" title={tab === "card" ? "بطاقتي" : tab === "scan" ? "المسح والحضور" : "سجل الحضور"} desc={tab === "card" ? "اضغط البطاقة لتقلبها وإظهار رمز QR المتجدد. تعمل على أي جوال دون تثبيت من المتجر." : undefined} />
      {tab === "card" && <MyCard />}
      {tab === "scan" && (isInstructor ? <InstructorScan /> : <GateScan />)}
      {tab === "log" && <Log gate={isGate} />}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:static lg:mt-8 lg:rounded-xl lg:border lg:pb-0" aria-label="تبويبات التطبيق" data-testid="app-tabs">
        <ul className="mx-auto flex max-w-md items-stretch justify-around">
          {tabs.map((t) => (
            <li key={t.id} className="flex-1">
              <button type="button" onClick={() => setTab(t.id as "card" | "scan" | "log")} data-testid={`tab-${t.id}`} aria-current={tab === t.id ? "page" : undefined}
                className={`flex w-full flex-col items-center gap-1 px-3 py-2.5 text-[11px] transition-colors ${tab === t.id ? "text-primary" : "text-muted-foreground"}`}>
                <t.icon className={`h-5 w-5 ${tab === t.id ? "text-accent" : ""}`} />{t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function MyCard() {
  const q = useQuery({ queryKey: ["ops", "card"], queryFn: async () => ({ at: Date.now(), data: await api<Mine>("/cards/mine") }), refetchInterval: 25_000, staleTime: 0 });
  const [flipped, setFlipped] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const d = q.data?.data;
  const left = d ? Math.max(0, d.secondsLeft - Math.floor((now - q.data!.at) / 1000)) : 0;
  const refetch = q.refetch;
  useEffect(() => { if (d && left === 0 && !q.isFetching) void refetch(); }, [left, d, q.isFetching, refetch]);

  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.isError || !d) return q.error && (q.error as { status?: number }).status === 404 ? <EmptyState title="لا توجد بطاقة لحسابك" desc="تُصدر البطاقة لمن لديه سجل موظف أو طالب أو مدرب مرتبط بحسابه. راجع الموارد البشرية أو مدير الفرع." /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const card: CardData = { number: d.card.number, holderName: d.holder.name, holderNumber: d.holder.number, label: d.holder.label, qr: d.qr, secondsLeft: left, stepSeconds: d.qrStepSeconds, status: d.card.status };
  return (
    <div className="space-y-5">
      <IdCard data={card} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
      <div className="mx-auto flex max-w-[420px] items-center justify-center gap-2 text-xs text-muted-foreground"><ArrowLeftRight className="h-3.5 w-3.5" /> {flipped ? "اضغط لإرجاع البطاقة" : "اضغط على البطاقة لإظهار رمز QR"}</div>
      <p className="mx-auto max-w-[420px] rounded-xl border bg-card p-3 text-xs leading-6 text-muted-foreground">للدخول: قدّم الرمز للمنسق أو مدرب الحصة ليمسحه. الرمز يتغير كل 30 ثانية فلا يفيد تصويره. إن فقدت جوالك أو بطاقتك الفيزيائية فأبلغ الإدارة لإيقافها فورًا.</p>
    </div>
  );
}

function useOutcomes() {
  const [list, setList] = useState<Outcome[]>([]);
  const push = useCallback((o: Omit<Outcome, "at">) => setList((l) => [{ ...o, at: Date.now() }, ...l].slice(0, 8)), []);
  return { list, push };
}
function OutcomeList({ list }: { list: Outcome[] }) {
  if (!list.length) return null;
  return (
    <ul className="mt-4 space-y-2" data-testid="scan-results">
      {list.map((o) => (
        <li key={o.at} className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${o.ok ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
          {o.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" /> : <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />}
          <div><div className="font-medium">{o.title}</div><div className="text-xs text-muted-foreground">{o.detail}</div></div>
        </li>
      ))}
    </ul>
  );
}

function GateScan() {
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  const out = useOutcomes();
  const onCode = useCallback((code: string) => {
    if (busy.current) return; busy.current = true;
    api<{ holder: { name: string; label: string }; eventType: string }>("/presence/gate", { method: "POST", body: { payload: code } })
      .then((r) => out.push({ ok: true, title: `${r.holder.name} — ${r.eventType === "check_in" ? "تسجيل دخول" : "تسجيل خروج"}`, detail: `${r.holder.label} • ${new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}` }))
      .catch((e) => out.push({ ok: false, title: "تعذر قبول البطاقة", detail: errorText(e) }))
      .finally(() => { busy.current = false; });
  }, [out]);
  return (
    <div>
      <div className="rounded-2xl border bg-card p-5 text-center">
        <p className="mb-4 text-sm text-muted-foreground">امسح بطاقة موظف أو مدرب أو طالب عند البوابة. تتبدل الحالة تلقائيًا بين دخول وخروج.</p>
        <Button size="lg" className="gap-2" onClick={() => setOpen(true)} data-testid="button-open-scan"><ScanLine className="h-5 w-5" /> مسح بطاقة</Button>
      </div>
      <OutcomeList list={out.list} />
      <ScanSheet open={open} title="قرّب البطاقة" hint="امسح رمز QR من جوال الحامل، أو قرّب بطاقته الفيزيائية." onClose={() => setOpen(false)} onCode={onCode} />
    </div>
  );
}

function InstructorScan() {
  const sessions = useOps<Session[]>(["my-sessions"], "/presence/sessions");
  const [sessionId, setSessionId] = useState("");
  const [mode, setMode] = useState<"room" | "student" | null>(null);
  const busy = useRef(false);
  const out = useOutcomes();
  const onCode = useCallback((code: string) => {
    if (busy.current) return; busy.current = true;
    const run = mode === "room"
      ? api<{ already: boolean; session: Session }>("/presence/room", { method: "POST", body: { roomToken: code } }).then((r) => out.push({ ok: true, title: r.already ? "حضورك مسجَّل سابقًا" : "تم تسجيل حضورك في القاعة", detail: r.session.name }))
      : api<{ already: boolean; holder: { name: string } }>("/presence/student", { method: "POST", body: { payload: code, sessionId: Number(sessionId) } }).then((r) => out.push({ ok: true, title: r.already ? `${r.holder.name} — مسجَّل سابقًا` : `${r.holder.name} — حاضر`, detail: "حضور الحصة" }));
    run.catch((e) => out.push({ ok: false, title: "تعذر التسجيل", detail: errorText(e) })).finally(() => { busy.current = false; });
  }, [mode, sessionId, out]);
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-medium">1) حضورك في القاعة</h2>
        <p className="mb-3 text-xs text-muted-foreground">امسح رمز القاعة (QR أو وسم NFC عند الباب) خلال حصتك المجدولة.</p>
        <Button variant="outline" className="gap-2" onClick={() => setMode("room")} data-testid="button-scan-room"><ScanLine className="h-4 w-4" /> مسح رمز القاعة</Button>
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-sm font-medium">2) حضور الطلاب</h2>
        <p className="mb-3 text-xs text-muted-foreground">اختر الحصة ثم امسح بطاقة كل طالب. لا يُقبل إلا الطلاب المسجلون في الحصة.</p>
        <Select value={sessionId} onValueChange={setSessionId}>
          <SelectTrigger data-testid="select-session"><SelectValue placeholder={sessions.isLoading ? "جارٍ التحميل..." : sessions.data?.length ? "اختر حصة اليوم" : "لا توجد حصص لك اليوم"} /></SelectTrigger>
          <SelectContent>{(sessions.data ?? []).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name} — {s.start} إلى {s.end}</SelectItem>)}</SelectContent>
        </Select>
        <Button className="mt-3 gap-2" disabled={!sessionId} onClick={() => setMode("student")} data-testid="button-scan-student"><ScanLine className="h-4 w-4" /> مسح بطاقة طالب</Button>
      </section>
      <OutcomeList list={out.list} />
      <ScanSheet open={mode != null} title={mode === "room" ? "امسح رمز القاعة" : "امسح بطاقة الطالب"} hint={mode === "room" ? "رمز القاعة معلّق عند الباب." : "اطلب من الطالب إظهار بطاقته (الوجه الخلفي)."} onClose={() => setMode(null)} onCode={onCode} />
    </div>
  );
}

function Log({ gate }: { gate: boolean }) {
  const mine = useOps<Presence[]>(["my-presence"], "/cards/mine/presence");
  const today = useOps<Today[]>(["today-presence"], "/presence/today", gate);
  return (
    <div className="space-y-6">
      {gate && (
        <section><h2 className="mb-2 text-sm font-medium">حركة اليوم في فرعك</h2>
          {today.isLoading ? <LoadingRows rows={3} /> : !today.data?.length ? <p className="text-sm text-muted-foreground">لا توجد حركات اليوم.</p> : (
            <ul className="divide-y rounded-xl border bg-card text-sm" data-testid="today-log">
              {today.data.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="flex items-center gap-2">{e.event_type === "check_in" ? <LogIn className="h-4 w-4 text-success" /> : <LogOut className="h-4 w-4 text-muted-foreground" />}{e.name} <span className="text-[11px] text-muted-foreground">({TYPE[e.holder_type]})</span></span><span className="num text-[11px] text-muted-foreground">{time(e.occurred_at)}</span></li>)}
            </ul>
          )}
        </section>
      )}
      <section><h2 className="mb-2 text-sm font-medium">حركاتي</h2>
        {mine.isLoading ? <LoadingRows rows={3} /> : !mine.data?.length ? <EmptyState title="لا توجد حركات" desc="تظهر هنا مرات الدخول والخروج وحضور الحصص عند مسح بطاقتك." /> : (
          <ul className="divide-y rounded-xl border bg-card text-sm" data-testid="my-log">
            {mine.data.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="flex items-center gap-2">{e.eventType === "check_in" ? <LogIn className="h-4 w-4 text-success" /> : <LogOut className="h-4 w-4 text-muted-foreground" />}{e.eventType === "check_in" ? "دخول" : "خروج"} <span className="text-[11px] text-muted-foreground">{e.method === "nfc" ? "NFC" : "QR"}</span></span><span className="num text-[11px] text-muted-foreground">{new Date(e.occurredAt).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" })}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
