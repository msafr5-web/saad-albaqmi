import { useEffect, useMemo, useRef, useState } from "react";
import { Nfc, ScanLine, PenLine, Lock, Zap, Trash2, AlertTriangle, CheckCircle2, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, EmptyState } from "@/components/bits";
import { usePageTitle } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* Web NFC is not in the default TypeScript DOM typings. */
interface NdefRecordLike { recordType: string; mediaType?: string; data?: DataView; encoding?: string; lang?: string }
interface NdefMessageLike { records: NdefRecordLike[] }
interface NdefReadingEvent extends Event { serialNumber: string; message: NdefMessageLike }
interface NdefReaderLike extends EventTarget {
  scan(opts?: { signal?: AbortSignal }): Promise<void>;
  write(msg: unknown, opts?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
  makeReadOnly?: (opts?: { signal?: AbortSignal }) => Promise<void>;
}
type NdefCtor = new () => NdefReaderLike;

const Ctor = (): NdefCtor | undefined => (window as unknown as { NDEFReader?: NdefCtor }).NDEFReader;

interface DecodedRecord { kind: string; type: string; value: string; bytes: number }
interface ScanEntry { id: string; at: string; uid: string; records: DecodedRecord[]; totalBytes: number }

const HISTORY_KEY = "nfc-scan-history-v1";
const TASK_KEY = "nfc-task-v1";
/* Typical NTAG sizes, used only as a reference for size warnings. */
const CAPACITIES = [{ label: "NTAG213", bytes: 144 }, { label: "NTAG215", bytes: 504 }, { label: "NTAG216", bytes: 888 }];

function decode(r: NdefRecordLike): DecodedRecord {
  const bytes = r.data?.byteLength ?? 0;
  const dec = (enc?: string) => (r.data ? new TextDecoder(enc || "utf-8").decode(r.data) : "");
  if (r.recordType === "text") return { kind: "نص", type: "TNF_WELL_KNOWN / T", value: dec(r.encoding), bytes };
  if (r.recordType === "url" || r.recordType === "absolute-url") return { kind: "رابط", type: "TNF_WELL_KNOWN / U", value: dec(), bytes };
  if (r.recordType === "mime") {
    const t = r.mediaType ?? "";
    const kind = t.includes("vcard") ? "بطاقة اتصال vCard" : "بيانات MIME";
    return { kind, type: `TNF_MIME_MEDIA / ${t}`, value: dec(), bytes };
  }
  return { kind: "غير معروف", type: r.recordType, value: r.data ? `${bytes} بايت` : "", bytes };
}

function loadHistory(): ScanEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as ScanEntry[]; } catch { return []; }
}

type WriteKind = "text" | "url" | "vcard" | "wifi";
const KINDS: { id: WriteKind; label: string }[] = [
  { id: "text", label: "نص" }, { id: "url", label: "رابط" }, { id: "vcard", label: "vCard" }, { id: "wifi", label: "واي فاي" },
];

const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

export default function NfcPage() {
  usePageTitle("أدوات NFC");
  const { toast } = useToast();
  const supported = typeof window !== "undefined" && !!Ctor();
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const [tab, setTab] = useState<"read" | "write" | "lock" | "tasks">("read");
  const [history, setHistory] = useState<ScanEntry[]>(loadHistory);
  const [scanning, setScanning] = useState(false);
  const [current, setCurrent] = useState<ScanEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [task, setTask] = useState<"none" | "open" | "copy">(() => (localStorage.getItem(TASK_KEY) as "none" | "open" | "copy") || "none");
  const taskRef = useRef(task);
  useEffect(() => { taskRef.current = task; localStorage.setItem(TASK_KEY, task); }, [task]);

  const [kind, setKind] = useState<WriteKind>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("https://");
  const [vc, setVc] = useState({ name: "", phone: "", email: "", org: "" });
  const [wifi, setWifi] = useState({ ssid: "", pass: "", sec: "WPA" });
  const [overwrite, setOverwrite] = useState(true);
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<{ kind: WriteKind; label: string; bytes: number } | null>(null);
  const [confirmLock, setConfirmLock] = useState(false);
  const canLock = supported && typeof Ctor()?.prototype.makeReadOnly === "function";

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20))); }, [history]);

  const payload = useMemo(() => {
    const enc = new TextEncoder();
    if (kind === "text") return { rec: { recordType: "text", data: text, lang: "ar" }, bytes: enc.encode(text).length + 3, preview: text, ok: text.trim().length > 0, type: "TNF_WELL_KNOWN / T" };
    if (kind === "url") {
      let ok = false; try { ok = /^https?:$/.test(new URL(url).protocol); } catch { ok = false; }
      return { rec: { recordType: "url", data: url }, bytes: enc.encode(url).length + 1, preview: url, ok, type: "TNF_WELL_KNOWN / U" };
    }
    if (kind === "vcard") {
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vc.name}`, vc.org && `ORG:${vc.org}`, vc.phone && `TEL:${vc.phone}`, vc.email && `EMAIL:${vc.email}`, "END:VCARD"].filter(Boolean).join("\n");
      return { rec: { recordType: "mime", mediaType: "text/vcard", data: enc.encode(lines) }, bytes: enc.encode(lines).length + 10, preview: lines, ok: vc.name.trim().length > 0, type: "TNF_MIME_MEDIA / text/vcard" };
    }
    const w = `WIFI:T:${wifi.sec};S:${esc(wifi.ssid)};P:${esc(wifi.pass)};;`;
    return { rec: { recordType: "text", data: w, lang: "en" }, bytes: enc.encode(w).length + 3, preview: w, ok: wifi.ssid.trim().length > 0, type: "TNF_WELL_KNOWN / T (WIFI:)" };
  }, [kind, text, url, vc, wifi]);

  const fits = CAPACITIES.map((c) => ({ ...c, ok: payload.bytes <= c.bytes }));

  async function startScan() {
    const N = Ctor(); if (!N) return;
    setError(null); setCurrent(null);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const reader = new N();
      await reader.scan({ signal: ac.signal });
      setScanning(true);
      reader.addEventListener("readingerror", () => setError("تعذرت قراءة الوسم. قرّبه أكثر أو جرّب وسمًا آخر."));
      reader.addEventListener("reading", (e) => {
        const ev = e as NdefReadingEvent;
        const records = ev.message.records.map(decode);
        const entry: ScanEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), uid: ev.serialNumber || "غير متاح", records, totalBytes: records.reduce((a, r) => a + r.bytes, 0) };
        setCurrent(entry); setError(null);
        setHistory((h) => [entry, ...h].slice(0, 20));
        runTask(entry);
      });
    } catch (e) {
      setScanning(false);
      setError(e instanceof Error ? `${e.name}: ${e.message}` : "تعذر بدء المسح.");
    }
  }

  function stopScan() { abortRef.current?.abort(); setScanning(false); }

  function runTask(entry: ScanEntry) {
    const first = entry.records.find((r) => r.kind === "رابط") ?? entry.records[0];
    if (!first) return;
    if (taskRef.current === "copy") {
      navigator.clipboard?.writeText(first.value).then(() => toast({ title: "نُسخت البيانات المقروءة" }), () => toast({ title: "تعذر النسخ", variant: "destructive" }));
    }
  }

  function openLink(v: string) {
    try { const u = new URL(v); if (/^https?:$/.test(u.protocol)) window.open(u.href, "_blank", "noopener,noreferrer"); } catch { /* not a URL */ }
  }

  async function doWrite() {
    const N = Ctor(); if (!N || !payload.ok) return;
    setWriting(true); setError(null); setWritten(null);
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
    try {
      await new N().write({ records: [payload.rec] }, { overwrite, signal: ac.signal });
      setWritten({ kind, label: payload.preview, bytes: payload.bytes });
      toast({ title: "تمت الكتابة على الوسم" });
    } catch (e) {
      setError(e instanceof Error && e.name === "AbortError" ? "انتهت المهلة قبل تقريب وسم. حاول مرة أخرى." : e instanceof Error ? `${e.name}: ${e.message}` : "فشلت الكتابة.");
    } finally { clearTimeout(t); setWriting(false); }
  }

  async function doLock() {
    const N = Ctor(); if (!N || !canLock) return;
    setError(null);
    try {
      await new N().makeReadOnly!();
      toast({ title: "أصبح الوسم للقراءة فقط" }); setConfirmLock(false);
    } catch (e) { setError(e instanceof Error ? `${e.name}: ${e.message}` : "فشل القفل."); }
  }

  const tabs = [
    { id: "read", label: "قراءة", icon: ScanLine }, { id: "write", label: "كتابة", icon: PenLine },
    { id: "lock", label: "قفل", icon: Lock }, { id: "tasks", label: "مهام", icon: Zap },
  ] as const;

  const field = "mt-1.5";
  return (
    <>
      <PageHeader eyebrow="الأدوات" title="أدوات NFC" desc="قراءة وكتابة وسوم NFC من داخل التطبيق مباشرة، باستخدام NFC في المتصفح." />

      <div className={cn("rise mb-6 flex items-start gap-3 rounded-xl border p-4 text-sm", supported && secure ? "border-success/30 bg-success/5" : "border-accent/40 bg-accent/10")} data-testid="status-nfc-support">
        {supported && secure ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(32_80%_32%)]" />}
        <div className="leading-7">
          {supported && secure ? "هذا الجهاز يدعم NFC في المتصفح. شغّل NFC من إعدادات الهاتف ثم ابدأ." : "NFC في المتصفح غير متاح هنا. يعمل فقط في Chrome على Android عبر HTTPS، ولا يعمل على iPhone أو الحاسب."}
          <div className="text-xs text-muted-foreground">حدود هذه التقنية: لا يمكن قراءة نوع الوسم أو سعته، ولا تعيين كلمة مرور، ولا تشغيل مهام خارج الصفحة. القفل للقراءة فقط متاح إن دعمه المتصفح.</div>
        </div>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`tab-nfc-${t.id}`}
            className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="status-nfc-error">{error}</div>}

      {tab === "read" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rise rounded-xl border bg-card p-6">
            <div className="flex flex-col items-center py-6 text-center">
              <div className={cn("flex h-24 w-24 items-center justify-center rounded-full border-2", scanning ? "animate-pulse border-accent bg-accent/10" : "border-border")}>
                <Nfc className="h-10 w-10 text-primary" />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">{scanning ? "بانتظار وسم. قرّب ظهر الهاتف من الوسم." : "اضغط ابدأ ثم قرّب الوسم."}</p>
              <div className="mt-4">
                {scanning
                  ? <Button variant="outline" onClick={stopScan} data-testid="button-nfc-stop">إيقاف المسح</Button>
                  : <Button disabled={!supported || !secure} onClick={startScan} data-testid="button-nfc-scan">بدء المسح</Button>}
              </div>
            </div>
          </section>

          <section className="rise rounded-xl border bg-card p-6" style={{ animationDelay: "80ms" }}>
            <h2 className="mb-3 font-display text-xl text-primary">نتيجة القراءة</h2>
            {!current ? <EmptyState title="لا توجد قراءة بعد" desc="ستظهر هنا معرّف الوسم (UID) والسجلات المخزنة فيه." /> : (
              <div className="space-y-3" data-testid="card-nfc-result">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-muted p-3"><div className="text-muted-foreground">UID</div><div className="num mt-1 break-all font-medium" dir="ltr">{current.uid}</div></div>
                  <div className="rounded-lg bg-muted p-3"><div className="text-muted-foreground">حجم البيانات</div><div className="num mt-1 font-medium">{current.totalBytes} بايت</div></div>
                </div>
                {current.records.length === 0 && <p className="text-sm text-muted-foreground">الوسم فارغ.</p>}
                {current.records.map((r, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between text-xs"><span className="font-medium text-primary">{r.kind}</span><span className="num text-muted-foreground" dir="ltr">{r.type}</span></div>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-sm" dir="auto">{r.value}</pre>
                    {r.kind === "رابط" && <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => openLink(r.value)}><ExternalLink className="h-3.5 w-3.5" />فتح الرابط</Button>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rise rounded-xl border bg-card p-6 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl text-primary">سجل القراءات</h2>
              {history.length > 0 && <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setHistory([])} data-testid="button-nfc-clear"><Trash2 className="h-3.5 w-3.5" />مسح السجل</Button>}
            </div>
            <p className="mb-3 text-xs text-muted-foreground">يُحفظ السجل في هذا المتصفح فقط ولا يُرسل إلى الخادم.</p>
            {history.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد قراءات محفوظة.</p> : (
              <ul className="divide-y">
                {history.map((h) => (
                  <li key={h.id}>
                    <button className="flex w-full items-center justify-between py-2.5 text-start text-sm hover:text-primary" onClick={() => setCurrent(h)}>
                      <span className="num" dir="ltr">{h.uid}</span>
                      <span className="text-xs text-muted-foreground">{h.records[0]?.kind ?? "فارغ"} · {new Date(h.at).toLocaleString("ar-SA")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "write" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rise rounded-xl border bg-card p-6">
            <div className="mb-4 flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button key={k.id} onClick={() => { setKind(k.id); setWritten(null); }} data-testid={`button-kind-${k.id}`}
                  className={cn("rounded-full border px-3.5 py-1 text-xs", kind === k.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{k.label}</button>
              ))}
            </div>
            {kind === "text" && <div><label className="text-sm">النص</label><Textarea className={field} rows={4} value={text} onChange={(e) => setText(e.target.value)} data-testid="input-nfc-text" /></div>}
            {kind === "url" && <div><label className="text-sm">الرابط</label><Input className={field} dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-nfc-url" />{!payload.ok && <p className="mt-1 text-xs text-destructive">أدخل رابطًا يبدأ بـ http أو https.</p>}</div>}
            {kind === "vcard" && (
              <div className="space-y-3">
                <div><label className="text-sm">الاسم</label><Input className={field} value={vc.name} onChange={(e) => setVc({ ...vc, name: e.target.value })} /></div>
                <div><label className="text-sm">الجهة</label><Input className={field} value={vc.org} onChange={(e) => setVc({ ...vc, org: e.target.value })} /></div>
                <div><label className="text-sm">الجوال</label><Input className={field} dir="ltr" value={vc.phone} onChange={(e) => setVc({ ...vc, phone: e.target.value })} /></div>
                <div><label className="text-sm">البريد</label><Input className={field} dir="ltr" value={vc.email} onChange={(e) => setVc({ ...vc, email: e.target.value })} /></div>
              </div>
            )}
            {kind === "wifi" && (
              <div className="space-y-3">
                <div><label className="text-sm">اسم الشبكة</label><Input className={field} dir="ltr" value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} /></div>
                <div><label className="text-sm">كلمة المرور</label><Input className={field} dir="ltr" value={wifi.pass} onChange={(e) => setWifi({ ...wifi, pass: e.target.value })} /></div>
                <div><label className="text-sm">التشفير</label>
                  <select className="mt-1.5 h-9 w-full rounded-md border bg-background px-2 text-sm" value={wifi.sec} onChange={(e) => setWifi({ ...wifi, sec: e.target.value })}>
                    <option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option><option value="nopass">بدون كلمة مرور</option>
                  </select></div>
                <p className="text-xs leading-6 text-muted-foreground">تُكتب الإعدادات كنص بصيغة WIFI: القياسية. لن يتصل الهاتف تلقائيًا بالمجرد تقريبه؛ هذا يتطلب سجل WSC ثنائي غير مدعوم هنا. كلمة المرور تُخزن على الوسم دون تشفير.</p>
              </div>
            )}
            <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />استبدال محتوى الوسم الحالي</label>
            <Button className="mt-4 w-full" disabled={!supported || !secure || !payload.ok || writing} onClick={doWrite} data-testid="button-nfc-write">
              {writing ? "قرّب الوسم الآن..." : "كتابة على الوسم"}
            </Button>
          </section>

          <section className="rise space-y-4" style={{ animationDelay: "80ms" }}>
            <div className="rounded-xl border bg-card p-6">
              <h3 className="mb-3 font-display text-lg text-primary">التحقق من الحجم</h3>
              <div className="num mb-3 text-2xl font-medium">{payload.bytes} <span className="text-sm text-muted-foreground">بايت تقريبًا</span></div>
              <ul className="space-y-1.5 text-sm">
                {fits.map((c) => (
                  <li key={c.label} className="flex items-center justify-between"><span dir="ltr">{c.label} ({c.bytes})</span><span className={c.ok ? "text-success" : "text-destructive"}>{c.ok ? "يتسع" : "لا يتسع"}</span></li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">السعات مرجعية. المتصفح لا يكشف سعة الوسم الفعلية، وقد تفشل الكتابة إن كان أصغر.</p>
            </div>
            <div className="rounded-xl border bg-card p-6" data-testid="card-nfc-preview">
              <h3 className="mb-1 font-display text-lg text-primary">{written ? "ما كُتب على الوسم" : "معاينة قبل الكتابة"}</h3>
              <div className="num mb-2 text-xs text-muted-foreground" dir="ltr">{payload.type}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm" dir="auto">{(written ? written.label : payload.preview) || "—"}</pre>
              {written && <div className="mt-2 flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />كُتب {written.bytes} بايت.</div>}
            </div>
          </section>
        </div>
      )}

      {tab === "lock" && (
        <section className="rise max-w-2xl rounded-xl border bg-card p-6">
          <h2 className="font-display text-xl text-primary">قفل الوسم</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">القفل للقراءة فقط عملية لا رجعة فيها: لن يمكن الكتابة على الوسم بعدها. الحماية بكلمة مرور وتهيئة الوسم غير متاحتين عبر المتصفح.</p>
          {!canLock ? (
            <p className="mt-4 rounded-lg bg-muted p-3 text-sm" data-testid="text-lock-unavailable">متصفحك لا يوفر خاصية القفل للقراءة فقط. استخدم تطبيقًا أصليًا مثل NFC Tools لهذه العملية.</p>
          ) : !confirmLock ? (
            <Button className="mt-4" variant="outline" onClick={() => setConfirmLock(true)}>أريد قفل وسم</Button>
          ) : (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm">تأكيد: سيصبح الوسم الذي تقربه للقراءة فقط بشكل دائم.</p>
              <div className="mt-3 flex gap-2"><Button variant="destructive" onClick={doLock} data-testid="button-nfc-lock">قفل نهائي، قرّب الوسم</Button><Button variant="ghost" onClick={() => setConfirmLock(false)}>إلغاء</Button></div>
            </div>
          )}
        </section>
      )}

      {tab === "tasks" && (
        <section className="rise max-w-2xl rounded-xl border bg-card p-6">
          <h2 className="font-display text-xl text-primary">مهام بعد القراءة</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">تعمل المهمة تلقائيًا عند قراءة وسم أثناء بقاء هذه الصفحة مفتوحة ومسح نشط. لا يمكن للتطبيق تشغيل مهام والهاتف مغلق.</p>
          <div className="mt-4 space-y-2">
            {([["none", "بدون مهمة"], ["copy", "نسخ القيمة المقروءة إلى الحافظة"]] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="task" checked={task === v} onChange={() => setTask(v)} />{l}</label>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Copy className="h-3.5 w-3.5" />فتح الروابط يتم بزر يدوي في نتيجة القراءة، لأن المتصفح يمنع الفتح التلقائي.</p>
        </section>
      )}
    </>
  );
}
