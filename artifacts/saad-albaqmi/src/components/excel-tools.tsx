import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/hooks/use-data";
import { useRole } from "@/hooks/use-ops";
import { cn } from "@/lib/utils";
import { buildXlsx, readXlsx } from "@/lib/xlsx";
import { ENTITIES, workbookFor, type EntityId, type PreviewRow } from "@/lib/sheets";

const ACTION: Record<PreviewRow["action"], { label: string; cls: string }> = {
  create: { label: "إضافة", cls: "bg-success/10 text-success" }, update: { label: "تعديل", cls: "bg-primary/10 text-primary" },
  skip: { label: "بلا تغيير", cls: "bg-muted text-muted-foreground" }, error: { label: "خطأ", cls: "bg-destructive/10 text-destructive" },
};
const KIND_OF: Partial<Record<EntityId, string>> = { branches: "branch", rooms: "room" };
const MAX_ROWS = 1000;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Bulk add / edit through Excel: download the sheet (current data or empty), fill it in, upload it and review every row before anything is saved. */
export function ExcelTools({ entity, className }: { entity: EntityId; className?: string }) {
  const def = ENTITIES[entity];
  const ws = useWorkspace(); const { role } = useRole(); const { toast } = useToast(); const qc = useQueryClient();
  const canImport = KIND_OF[entity] ? (ws.data?.mode === "personal" || (ws.data?.writableKinds ?? []).includes(KIND_OF[entity]!)) : role === "super_admin" || role === "hr_officer";
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState(""); const [rows, setRows] = useState<PreviewRow[] | null>(null); const [problem, setProblem] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null); const [results, setResults] = useState<Map<number, string>>(new Map());
  const input = useRef<HTMLInputElement>(null);

  const get = async (withData: boolean) => {
    setBusy(withData ? "data" : "template");
    try {
      const ctx = await def.load();
      download(buildXlsx(workbookFor(def, ctx, withData)), `${def.file}-${withData ? "البيانات" : "قالب"}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) { toast({ title: "تعذر إنشاء ملف Excel", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); } finally { setBusy(null); }
  };

  const reset = () => { setRows(null); setProblem(""); setFileName(""); setProgress(null); setResults(new Map()); if (input.current) input.current.value = ""; };
  const pick = async (file: File | undefined) => {
    reset(); if (!file) return; setFileName(file.name);
    if (file.size > 2_000_000) { setProblem("الملف كبير (الحد 2 ميجابايت)"); return; }
    setBusy("read");
    try {
      const sheets = await readXlsx(await file.arrayBuffer());
      const grid = sheets.get(def.sheetName) ?? [...sheets.values()][0];
      if (!grid || grid.length < 2) { setProblem("لا توجد صفوف بيانات في الملف. املأ الصفوف تحت العناوين."); return; }
      if (grid.length - 1 > MAX_ROWS) { setProblem(`الحد الأقصى ${MAX_ROWS} صف في الملف الواحد`); return; }
      setRows(def.parse(grid, (await def.load()) as never));
    } catch (e) { setProblem(e instanceof Error ? e.message : "تعذر قراءة الملف"); } finally { setBusy(null); }
  };

  const runnable = (rows ?? []).filter((r) => r.run);
  const counts = { create: 0, update: 0, skip: 0, error: 0 }; for (const r of rows ?? []) counts[r.action]++;
  const apply = async () => {
    const todo = runnable; const res = new Map<number, string>(); setResults(res); setProgress({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      try { await todo[i]!.run!(); res.set(todo[i]!.rowNo, "ok"); } catch (e) { res.set(todo[i]!.rowNo, e instanceof Error ? e.message : "فشل"); }
      setResults(new Map(res)); setProgress({ done: i + 1, total: todo.length });
    }
    await qc.invalidateQueries();
    const failed = [...res.values()].filter((v) => v !== "ok").length;
    toast({ title: failed ? `اكتمل التنفيذ مع ${failed} خطأ` : "اكتمل التنفيذ", description: `${res.size - failed} صف نُفِّذ بنجاح`, variant: failed ? "destructive" : undefined });
  };
  const finished = progress != null && progress.done === progress.total;
  const okCount = [...results.values()].filter((v) => v === "ok").length;

  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3", className)} data-testid={`excel-tools-${entity}`}>
      <FileSpreadsheet className="h-5 w-5 text-success" />
      <div className="min-w-0 flex-1 text-sm"><span className="font-medium">Excel — {def.title}</span><span className="mr-2 hidden text-xs text-muted-foreground sm:inline">إضافة وتعديل جماعي بمعاينة قبل الحفظ</span></div>
      <Button variant="outline" size="sm" className="gap-1.5" disabled={busy != null} onClick={() => get(true)} data-testid={`excel-export-${entity}`}>{busy === "data" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} تنزيل البيانات الحالية</Button>
      <Button variant="outline" size="sm" className="gap-1.5" disabled={busy != null} onClick={() => get(false)} data-testid={`excel-template-${entity}`}><Download className="h-4 w-4" /> قالب فارغ</Button>
      {canImport && <Button size="sm" className="gap-1.5" onClick={() => { reset(); setOpen(true); }} data-testid={`excel-import-${entity}`}><FileUp className="h-4 w-4" /> استيراد من Excel</Button>}

      <Dialog open={open} onOpenChange={(o) => { if (!o && progress && !finished) return; setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl" dir="rtl" data-testid="excel-import-dialog">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl">استيراد {def.title} من Excel</DialogTitle>
            <DialogDescription>اختر الملف الذي نزّلته وعدّلته. تظهر معاينة بكل صف، ولا يُحفظ شيء قبل ضغط «تنفيذ». الصفوف التي بها خطأ تُتجاهل ويمكنك تصحيحها ورفع الملف مجددًا.</DialogDescription></DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} data-testid="excel-file-input" />
            <Button variant="outline" className="gap-1.5" disabled={busy === "read" || (progress != null && !finished)} onClick={() => input.current?.click()}>{busy === "read" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} اختيار ملف</Button>
            <span className="text-sm text-muted-foreground" dir="ltr">{fileName}</span>
          </div>
          {problem && <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{problem}</p>}
          {rows && (
            <>
              <div className="flex flex-wrap gap-2 text-xs" data-testid="excel-summary">
                {(["create", "update", "skip", "error"] as const).map((k) => <span key={k} className={cn("rounded-full px-3 py-1 font-medium", ACTION[k].cls)}>{ACTION[k].label}: {counts[k]}</span>)}
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[520px] text-sm" data-testid="excel-preview">
                  <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground"><th className="px-3 py-2 font-medium">الصف</th><th className="px-3 py-2 font-medium">السجل</th><th className="px-3 py-2 font-medium">الإجراء</th><th className="px-3 py-2 font-medium">ملاحظات</th></tr></thead>
                  <tbody>
                    {rows.map((r) => { const res = results.get(r.rowNo); return (
                      <tr key={`${r.rowNo}-${r.label}`} className="border-b align-top last:border-0">
                        <td className="num px-3 py-2">{r.rowNo}</td><td className="px-3 py-2 font-medium">{r.label}</td>
                        <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-[11px]", ACTION[r.action].cls)}>{ACTION[r.action].label}</span></td>
                        <td className="px-3 py-2 text-xs">{res === "ok" ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> تم</span> : res ? <span className="text-destructive">فشل: {res}</span> : r.messages.length ? <ul className={cn(r.action === "error" && "text-destructive")}>{r.messages.map((m) => <li key={m}>{m}</li>)}</ul> : <span className="text-muted-foreground">—</span>}</td>
                      </tr>); })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {progress && <p className="text-sm" aria-live="polite" data-testid="excel-progress">{finished ? `انتهى التنفيذ: ${okCount} نجح، ${results.size - okCount} فشل.` : `جارٍ التنفيذ ${progress.done} / ${progress.total}...`}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            {!finished && <Button disabled={!runnable.length || progress != null} onClick={() => void apply()} className="gap-1.5" data-testid="excel-apply">{progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} تنفيذ ({counts.create} إضافة، {counts.update} تعديل)</Button>}
            <Button variant="outline" disabled={progress != null && !finished} onClick={() => { setOpen(false); reset(); }}>{finished ? "إغلاق" : "إلغاء"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
