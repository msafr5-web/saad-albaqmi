import { useMemo, useState, type ReactNode } from "react";
import type { EducationRecord, RecordInput } from "@workspace/api-client-react";
import { Plus, Search, Pencil, Trash2, Eye, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { KINDS, det, errorText, fmtDate, fmtNum, fmtSAR, type FieldDef, type Kind } from "@/lib/domain";
import { useRecordIndex, useRecordMutations, useRecords, useWorkspace } from "@/hooks/use-data";
import { EmptyState, ErrorState, LoadingRows, ReadOnlyNotice, StatusPill } from "@/components/bits";

type Index = ReturnType<typeof useRecordIndex>;

export function renderValue(f: FieldDef, v: unknown, idx: Index): ReactNode {
  if (v === undefined || v === null || v === "") return <span className="text-muted-foreground/60">—</span>;
  switch (f.type) {
    case "number":
      return <span className="num">{f.money ? fmtSAR(Number(v)) : `${fmtNum(Number(v))}${f.suffix ? ` ${f.suffix}` : ""}`}</span>;
    case "date":
      return <span className="num">{fmtDate(String(v))}</span>;
    case "time":
      return <span className="num">{String(v)}</span>;
    case "relation":
      return idx.nameOf(v);
    case "multirelation":
      return Array.isArray(v) ? `${v.length} ${f.relation === "student" ? "طالب" : "مادة"}` : "—";
    case "bool":
      return v ? <span className="text-success">نعم</span> : <span className="text-destructive">لا</span>;
    case "list":
      return Array.isArray(v) ? v.join("، ") : String(v);
    default:
      return String(v);
  }
}

type FormState = { name: string; branchId: string; status: string; details: Record<string, unknown> };

function emptyForm(kind: Kind): FormState {
  const def = KINDS[kind];
  const details: Record<string, unknown> = {};
  for (const f of def.fields) details[f.key] = f.type === "multirelation" ? [] : f.type === "bool" ? true : "";
  return { name: "", branchId: "", status: def.statuses[0].value, details };
}

function fromRecord(r: EducationRecord): FormState {
  const def = KINDS[r.kind];
  const details: Record<string, unknown> = {};
  for (const f of def.fields) {
    const v = det(r, f.key);
    if (f.type === "list") details[f.key] = Array.isArray(v) ? v.join("، ") : v ?? "";
    else if (f.type === "multirelation") details[f.key] = Array.isArray(v) ? v.map(Number) : [];
    else if (f.type === "bool") details[f.key] = !!v;
    else details[f.key] = v === undefined || v === null ? "" : String(v);
  }
  return { name: r.name, branchId: r.branchId ? String(r.branchId) : "", status: r.status, details };
}

function toInput(kind: Kind, s: FormState): RecordInput {
  const def = KINDS[kind];
  const details: Record<string, unknown> = {};
  for (const f of def.fields) {
    const v = s.details[f.key];
    if (f.type === "number") { if (v !== "" && v !== undefined) details[f.key] = Number(v); }
    else if (f.type === "relation") { if (v) details[f.key] = Number(v); }
    else if (f.type === "multirelation") details[f.key] = (v as number[]) ?? [];
    else if (f.type === "bool") details[f.key] = !!v;
    else if (f.type === "list") details[f.key] = String(v ?? "").split(/[،,]/).map((x) => x.trim()).filter(Boolean);
    else if (v !== "") details[f.key] = v;
  }
  return { kind, name: s.name.trim(), status: s.status, branchId: def.needsBranch && s.branchId ? Number(s.branchId) : kind === "branch" ? null : s.branchId ? Number(s.branchId) : null, details };
}

function RecordForm({ kind, editing, open, onOpenChange, idx }: { kind: Kind; editing: EducationRecord | null; open: boolean; onOpenChange: (o: boolean) => void; idx: Index }) {
  const def = KINDS[kind];
  const [state, setState] = useState<FormState>(() => (editing ? fromRecord(editing) : emptyForm(kind)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const { create, update } = useRecordMutations();
  const { toast } = useToast();
  const pending = create.isPending || update.isPending;

  const setD = (k: string, v: unknown) => setState((s) => {
    const details = { ...s.details, [k]: v };
    if (kind === "student" && k === "subjectIds" && (v as number[]).length) {
      details.fees = String((v as number[]).reduce((a, id) => a + Number(det(idx.byId.get(id) as EducationRecord, "price") ?? 0), 0));
    }
    if (k === "diplomaId" && s.details.diplomaId !== v) {
      for (const f of def.fields) if (f.relation === "level" || f.relation === "subject" || (f.relation === "student" && kind === "session")) details[f.key] = f.type === "multirelation" ? [] : "";
    }
    return { ...s, details };
  });

  const relOptions = (f: FieldDef) => {
    let list = idx.of(f.relation!);
    const dip = state.details.diplomaId;
    if ((f.relation === "level" || f.relation === "subject") && dip) list = list.filter((r) => String(det(r, "diplomaId")) === String(dip));
    if (f.relation === "student" && kind === "session" && dip) list = list.filter((r) => String(det(r, "diplomaId")) === String(dip));
    if (f.relation === "subject" && kind === "subject" && editing) list = list.filter((r) => r.id !== editing.id);
    if (["diploma", "level", "subject"].includes(f.relation!) || !state.branchId) return list;
    return list.filter((r) => String(r.branchId) === state.branchId);
  };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!state.name.trim()) e.name = "مطلوب";
    if (def.needsBranch && !state.branchId) e.branchId = "اختر الفرع";
    for (const f of def.fields) {
      const v = state.details[f.key];
      if (f.required && (v === "" || v === undefined)) e[f.key] = "مطلوب";
      if (f.type === "number" && v !== "" && v !== undefined && !Number.isFinite(Number(v))) e[f.key] = "رقم غير صالح";
    }
    if (kind === "session" && state.details.start && state.details.end && String(state.details.end) <= String(state.details.start)) e.end = "يجب أن يكون بعد وقت البداية";
    if (kind === "grade" && Number(state.details.score) > Number(state.details.maxScore)) e.score = "تتجاوز الدرجة العظمى";
    setErrors(e);
    if (Object.keys(e).length) return;
    setServerError(null);
    const data = toInput(kind, state);
    const opts = {
      onSuccess: () => {
        toast({ title: editing ? "تم حفظ التعديلات" : `تمت إضافة ${def.singular}`, description: data.name });
        onOpenChange(false);
      },
      onError: (err: unknown) => setServerError(errorText(err)),
    };
    if (editing) update.mutate({ id: editing.id, data }, opts);
    else create.mutate({ data }, opts);
  };

  const err = (k: string) => errors[k] && <p className="mt-1 text-[11px] text-destructive">{errors[k]}</p>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="font-display text-xl text-primary">{editing ? `تعديل ${def.singular}` : `${def.singular} جديد`}</DialogTitle>
          <DialogDescription>الحقول المعلّمة بنقطة مطلوبة. يتحقق الخادم من العلاقات والتعارضات عند الحفظ.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-xs">{def.nameLabel} <span className="text-accent">•</span></Label>
            <Input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} maxLength={200} data-testid="input-name" />
            {err("name")}
          </div>
          {kind !== "branch" && (
            <div>
              <Label className="mb-1.5 block text-xs">الفرع {def.needsBranch && <span className="text-accent">•</span>}</Label>
              <Select value={state.branchId || "none"} onValueChange={(v) => setState({ ...state, branchId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-branch"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent dir="rtl">
                  {!def.needsBranch && <SelectItem value="none">كل الفروع</SelectItem>}
                  {idx.of("branch").map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {err("branchId")}
              {def.needsBranch && idx.of("branch").length === 0 && <p className="mt-1 text-[11px] text-muted-foreground">أضف فرعًا أولًا من صفحة الفروع.</p>}
            </div>
          )}
          <div>
            <Label className="mb-1.5 block text-xs">الحالة</Label>
            <Select value={state.status} onValueChange={(v) => setState({ ...state, status: v })}>
              <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {def.statuses.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {def.fields.map((f) => {
            const v = state.details[f.key];
            const label = (
              <Label className="mb-1.5 block text-xs">
                {f.label} {f.required && <span className="text-accent">•</span>} {f.suffix && <span className="text-muted-foreground">({f.suffix})</span>} {f.money && <span className="text-muted-foreground">(ر.س)</span>}
              </Label>
            );
            if (f.type === "select" || f.type === "relation") {
              const opts = f.type === "select" ? f.options! : relOptions(f).map((r) => ({ value: String(r.id), label: r.name }));
              return (
                <div key={f.key}>
                  {label}
                  <Select value={String(v || "") || undefined} onValueChange={(x) => setD(f.key, x)}>
                    <SelectTrigger data-testid={`select-${f.key}`}><SelectValue placeholder={opts.length ? "اختر" : "لا توجد خيارات"} /></SelectTrigger>
                    <SelectContent dir="rtl">
                      {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {err(f.key)}
                </div>
              );
            }
            if (f.type === "multirelation") {
              const opts = relOptions(f);
              const sel = (v as number[]) ?? [];
              return (
                <div key={f.key} className="sm:col-span-2">
                  {label}
                  <div className="max-h-40 overflow-y-auto rounded-lg border bg-background p-2">
                    {opts.length === 0 && <p className="p-2 text-xs text-muted-foreground">لا توجد خيارات متاحة.</p>}
                    <div className="grid gap-1 sm:grid-cols-2">
                      {opts.map((o) => {
                        const on = sel.includes(o.id);
                        return (
                          <button type="button" key={o.id} onClick={() => setD(f.key, on ? sel.filter((x) => x !== o.id) : [...sel, o.id])}
                            className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-right text-xs transition-colors", on ? "bg-primary/10 text-primary" : "hover:bg-muted")}
                            data-testid={`toggle-student-${o.id}`}>
                            <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>{on && <Check className="h-3 w-3" />}</span>
                            {o.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{sel.length} محدد.{f.relation === "student" ? " يرفض الخادم تجاوز سعة القاعة." : ""}</p>
                </div>
              );
            }
            if (f.type === "bool") {
              return (
                <label key={f.key} className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox checked={!!v} onCheckedChange={(c) => setD(f.key, !!c)} data-testid={`checkbox-${f.key}`} /> {f.label}
                </label>
              );
            }
            return (
              <div key={f.key} className={f.type === "list" ? "sm:col-span-2" : ""}>
                {label}
                <Input
                  type={f.type === "list" ? "text" : f.type === "number" ? "number" : f.type}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  step={f.type === "number" ? "any" : undefined}
                  value={String(v ?? "")}
                  onChange={(e) => setD(f.key, e.target.value)}
                  placeholder={f.hint}
                  className={cn((f.type === "number" || f.type === "date" || f.type === "time") && "num text-right")}
                  data-testid={`input-${f.key}`}
                />
                {err(f.key)}
              </div>
            );
          })}
        </div>
        {serverError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="text-server-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{serverError}</span>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={submit} disabled={pending} data-testid="button-save">{pending ? "جارٍ الحفظ..." : "حفظ"}</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindTable({ kind, extra }: { kind: Kind; extra?: ReactNode }) {
  const def = KINDS[kind];
  const records = useRecords();
  const ws = useWorkspace();
  const idx = useRecordIndex(records.data);
  const { remove } = useRecordMutations();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EducationRecord | null>(null);
  const [viewing, setViewing] = useState<EducationRecord | null>(null);
  const [deleting, setDeleting] = useState<EducationRecord | null>(null);
  const [formKey, setFormKey] = useState(0);
  const canWrite = !!ws.data?.canWrite && (ws.data.mode !== "organization" || ws.data.writableKinds.includes(kind));

  const rows = useMemo(() => {
    const list = idx.of(kind);
    const term = q.trim();
    return list.filter((r) => (branch === "all" || String(r.branchId) === branch) && (!term || r.name.includes(term) || JSON.stringify(r.details).includes(term)));
  }, [idx, kind, q, branch]);

  const cols = def.columns.map((k) => def.fields.find((f) => f.key === k)!).filter(Boolean);
  const openNew = () => { setEditing(null); setFormKey((k) => k + 1); setFormOpen(true); };
  const openEdit = (r: EducationRecord) => { setEditing(r); setFormKey((k) => k + 1); setFormOpen(true); };

  return (
    <div>
      {ws.data && !canWrite && (ws.data.mode === "organization"
        ? <div className="mb-5 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm" data-testid="status-role-readonly">دورك لا يملك صلاحية تعديل هذا القسم؛ العرض ضمن نطاق فرعك ودورك فقط.</div>
        : <ReadOnlyNotice />)}
      {extra}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`ابحث في ${def.label}`} className="bg-card pr-9" data-testid={`input-search-${kind}`} />
        </div>
        {kind !== "branch" && (
          <Select value={branch} onValueChange={setBranch}>
            <SelectTrigger className="bg-card sm:w-48" data-testid={`select-filter-branch-${kind}`}><SelectValue /></SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">كل الفروع</SelectItem>
              {idx.of("branch").map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button onClick={openNew} disabled={!canWrite} className="gap-1.5" data-testid={`button-add-${kind}`}>
          <Plus className="h-4 w-4" /> إضافة {def.singular}
        </Button>
      </div>

      {records.isLoading ? <LoadingRows /> : records.isError ? <ErrorState error={records.error} onRetry={() => records.refetch()} /> : rows.length === 0 ? (
        <EmptyState
          title={idx.of(kind).length ? "لا توجد نتائج مطابقة" : `لا توجد ${def.label} بعد`}
          desc={idx.of(kind).length ? "جرّب تعديل البحث أو تصفية الفرع." : def.empty}
          action={canWrite && !idx.of(kind).length ? <Button onClick={openNew} data-testid={`button-empty-add-${kind}`}><Plus className="ml-1 h-4 w-4" /> إضافة {def.singular}</Button> : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{def.nameLabel}</th>
                  {kind !== "branch" && <th className="px-4 py-3 font-medium">الفرع</th>}
                  {cols.map((c) => <th key={c.key} className="whitespace-nowrap px-4 py-3 font-medium">{c.label}</th>)}
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="w-28 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="group rise border-b border-border/60 last:border-0 transition-colors hover:bg-secondary/40" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} data-testid={`row-${kind}-${r.id}`}>
                    <td className="px-4 py-3 font-medium">
                      <button className="text-right hover:text-primary hover:underline underline-offset-4" onClick={() => setViewing(r)} data-testid={`button-view-${r.id}`}>{r.name}</button>
                    </td>
                    {kind !== "branch" && <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{r.branchId ? idx.nameOf(r.branchId) : "كل الفروع"}</td>}
                    {cols.map((c) => <td key={c.key} className="whitespace-nowrap px-4 py-3">{renderValue(c, det(r, c.key), idx)}</td>)}
                    <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setViewing(r)} aria-label="عرض" data-testid={`button-details-${r.id}`}><Eye className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!canWrite} onClick={() => openEdit(r)} aria-label="تعديل" data-testid={`button-edit-${r.id}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled={!canWrite} onClick={() => setDeleting(r)} aria-label="حذف" data-testid={`button-delete-${r.id}`}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"><span className="num">{rows.length}</span> سجل</div>
        </div>
      )}

      {formOpen && <RecordForm key={formKey} kind={kind} editing={editing} open={formOpen} onOpenChange={setFormOpen} idx={idx} />}

      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-md" dir="rtl">
          {viewing && (
            <>
              <SheetHeader className="text-right">
                <SheetDescription>{def.singular} · <span className="num">#{viewing.id}</span></SheetDescription>
                <SheetTitle className="font-display text-2xl text-primary">{viewing.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-4"><StatusPill status={viewing.status} /></div>
              <dl className="mt-6 divide-y rounded-xl border bg-card">
                {kind !== "branch" && <div className="flex justify-between gap-4 px-4 py-3 text-sm"><dt className="text-muted-foreground">الفرع</dt><dd>{viewing.branchId ? idx.nameOf(viewing.branchId) : "كل الفروع"}</dd></div>}
                {def.fields.map((f) => (
                  <div key={f.key} className="flex justify-between gap-4 px-4 py-3 text-sm">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="text-left">{f.type === "multirelation" && Array.isArray(det(viewing, f.key)) ? (det(viewing, f.key) as number[]).map((id) => idx.nameOf(id)).join("، ") || "—" : renderValue(f, det(viewing, f.key), idx)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 px-4 py-3 text-sm"><dt className="text-muted-foreground">تاريخ الإنشاء</dt><dd>{fmtDate(viewing.createdAt)}</dd></div>
              </dl>
              {canWrite && (
                <div className="mt-6 flex gap-2">
                  <Button onClick={() => { const r = viewing; setViewing(null); openEdit(r); }} data-testid="button-sheet-edit"><Pencil className="ml-1 h-4 w-4" /> تعديل</Button>
                  <Button variant="outline" className="text-destructive" onClick={() => { const r = viewing; setViewing(null); setDeleting(r); }} data-testid="button-sheet-delete"><Trash2 className="ml-1 h-4 w-4" /> حذف</Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>حذف «{deleting?.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>لا يمكن التراجع عن الحذف. قد يرفض الخادم الحذف إذا كانت سجلات أخرى مرتبطة به.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
              onClick={() => deleting && remove.mutate({ id: deleting.id }, {
                onSuccess: () => toast({ title: "تم الحذف", description: deleting.name }),
                onError: (e) => toast({ title: "تعذر الحذف", description: errorText(e), variant: "destructive" }),
              })}
            >حذف نهائي</AlertDialogAction>
            <AlertDialogCancel data-testid="button-cancel-delete">تراجع</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function RecordModule({ kinds, extra }: { kinds: Kind[]; extra?: Partial<Record<Kind, ReactNode>> }) {
  const [active, setActive] = useState<Kind>(kinds[0]);
  return (
    <div>
      {kinds.length > 1 && (
        <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl border bg-card p-1" role="tablist">
          {kinds.map((k) => (
            <button key={k} role="tab" aria-selected={active === k} onClick={() => setActive(k)}
              className={cn("rounded-lg px-4 py-2 text-sm transition-all", active === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              data-testid={`tab-${k}`}>{KINDS[k].label}</button>
          ))}
        </div>
      )}
      <KindTable key={active} kind={active} extra={extra?.[active]} />
    </div>
  );
}
