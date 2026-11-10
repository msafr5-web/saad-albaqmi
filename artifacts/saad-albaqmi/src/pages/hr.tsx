import { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/bits";
import { ROLE_LABELS } from "@/components/shell";
import { usePageTitle } from "@/hooks/use-data";
import { api, toHalalas, useAct, useOps, useRole } from "@/hooks/use-ops";
import { fmtSAR } from "@/lib/domain";
import { ExcelTools } from "@/components/excel-tools";

type Catalogue = { departments: { id: number; name: string; branchId: number | null }[]; jobTitles: { id: number; name: string }[]; leaveTypes: { id: number; name: string }[]; branches: { id: number; name: string }[]; members: { id: number; email: string; role: string; branchId: number | null }[] };
type Employee = { id: number; employeeNo: string; fullName: string; branchId: number; departmentId: number | null; status: string; hireDate: string; basicSalaryHalalas: number | null; housingAllowanceHalalas: number | null; transportAllowanceHalalas: number | null };
type Leave = { id: number; employee_id: number; full_name: string; leave_type: string; start_date: string; end_date: string; status: string };
type Delegation = { id: number; status: string; scope: string; valid_from: string; valid_to: string; delegator: string; delegate: string; proposed_by_email: string };
const EMP_STATUS: Record<string, string> = { active: "على رأس العمل", on_leave: "في إجازة", suspended: "موقوف", terminated: "منتهي الخدمة" };
const LEAVE_STATUS: Record<string, string> = { pending: "بانتظار الاعتماد", approved: "معتمدة", rejected: "مرفوضة", cancelled: "ملغاة" };
const DELEGATION_STATUS: Record<string, string> = { proposed: "مقترح من الموارد البشرية", approved: "معتمد", rejected: "مرفوض", revoked: "ملغى", expired: "منتهٍ" };
const SCOPE: Record<string, string> = { purchase_approval: "اعتماد المشتريات", finance_approval: "الاعتماد المالي", all: "كل الصلاحيات" };
const day = (s: string) => String(s).slice(0, 10);

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
const Pill = ({ children }: { children: React.ReactNode }) => <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{children}</span>;

export default function HrPage() {
  usePageTitle("الموارد البشرية");
  const { role } = useRole();
  const canWrite = role === "super_admin" || role === "hr_officer";
  const cat = useOps<Catalogue>(["hr-cat"], "/hr/catalogue");
  const emps = useOps<Employee[]>(["hr-emps"], "/hr/employees");
  const leave = useOps<Leave[]>(["hr-leave"], "/hr/leave");
  const delegations = useOps<Delegation[]>(["hr-del"], "/hr/delegations", role !== "finance");
  const act = useAct();
  const [dlg, setDlg] = useState<"emp" | "dep" | "leave" | "del" | null>(null);
  const branchName = (id: number) => cat.data?.branches.find((b) => b.id === id)?.name ?? "—";
  const depName = (id: number | null) => cat.data?.departments.find((d) => d.id === id)?.name ?? "—";
  const canDecideLeave = role === "super_admin" || role === "branch_manager";

  return (
    <>
      <PageHeader eyebrow="الموارد البشرية" title="الموارد البشرية"
        desc="سجلات الموظفين والأقسام والإجازات. تفويض الصلاحيات (مثل اعتماد المشتريات أثناء إجازة مدير الفرع) تقترحه الموارد البشرية ويعتمده المدير العام. الرواتب مخفية عن مديري الفروع."
        actions={canWrite ? <div className="flex flex-wrap gap-2"><Button onClick={() => setDlg("emp")} className="gap-1.5" data-testid="button-new-employee"><Plus className="h-4 w-4" /> موظف</Button><Button variant="outline" onClick={() => setDlg("dep")} data-testid="button-new-department">قسم</Button></div> : undefined} />
      <div className="mb-5 grid gap-3 md:grid-cols-2"><ExcelTools entity="employees" /><ExcelTools entity="departments" /></div>
      <Tabs defaultValue="employees" dir="rtl">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="employees" data-testid="tab-employees">الموظفون</TabsTrigger>
          <TabsTrigger value="leave" data-testid="tab-leave">الإجازات</TabsTrigger>
          <TabsTrigger value="delegations" data-testid="tab-delegations">التفويضات</TabsTrigger>
          <TabsTrigger value="departments" data-testid="tab-departments">الأقسام</TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          {emps.isLoading ? <LoadingRows /> : emps.isError ? <ErrorState error={emps.error} onRetry={() => emps.refetch()} /> : !emps.data?.length ? <EmptyState title="لا يوجد موظفون" desc="أضف الموظفين بعد إنشاء الفروع والأقسام." /> : (
            <Table testId="table-employees" head={["الرقم", "الاسم", "الفرع / القسم", "التعيين", "الراتب الإجمالي", "الحالة"]}>
              {emps.data.map((e) => (
                <tr key={e.id} className="border-b border-border/60 last:border-0" data-testid={`row-employee-${e.id}`}>
                  <td className="px-4 py-3 num" dir="ltr">{e.employeeNo}</td><td className="px-4 py-3 font-medium">{e.fullName}</td>
                  <td className="px-4 py-3">{branchName(e.branchId)} <span className="text-[11px] text-muted-foreground">/ {depName(e.departmentId)}</span></td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">{day(e.hireDate)}</td>
                  <td className="px-4 py-3 num">{e.basicSalaryHalalas == null ? "—" : fmtSAR(((e.basicSalaryHalalas ?? 0) + (e.housingAllowanceHalalas ?? 0) + (e.transportAllowanceHalalas ?? 0)) / 100)}</td>
                  <td className="px-4 py-3"><Pill>{EMP_STATUS[e.status] ?? e.status}</Pill></td>
                </tr>
              ))}
            </Table>
          )}
        </TabsContent>

        <TabsContent value="leave">
          <div className="mb-3 flex justify-end">{canWrite && <Button variant="outline" onClick={() => setDlg("leave")} className="gap-1.5" data-testid="button-new-leave"><Plus className="h-4 w-4" /> إجازة</Button>}</div>
          {leave.isLoading ? <LoadingRows /> : !leave.data?.length ? <EmptyState title="لا توجد إجازات" desc="تُسجَّل الإجازات من الموارد البشرية ويعتمدها مدير الفرع أو المدير العام." /> : (
            <Table testId="table-leave" head={["الموظف", "النوع", "من", "إلى", "الحالة", ""]}>
              {leave.data.map((l) => (
                <tr key={l.id} className="border-b border-border/60 last:border-0" data-testid={`row-leave-${l.id}`}>
                  <td className="px-4 py-3 font-medium">{l.full_name}</td><td className="px-4 py-3">{l.leave_type}</td><td className="px-4 py-3 num">{day(l.start_date)}</td><td className="px-4 py-3 num">{day(l.end_date)}</td>
                  <td className="px-4 py-3"><Pill>{LEAVE_STATUS[l.status] ?? l.status}</Pill></td>
                  <td className="px-4 py-3 text-left">{l.status === "pending" && canDecideLeave && <div className="flex justify-end gap-1.5"><Button size="sm" onClick={() => act.run(() => api(`/hr/leave/${l.id}/approve`, { method: "POST" }), { success: "اعتُمدت الإجازة", refresh: ["hr-leave"] })} data-testid={`button-leave-approve-${l.id}`}>اعتماد</Button><Button size="sm" variant="ghost" onClick={() => act.run(() => api(`/hr/leave/${l.id}/reject`, { method: "POST" }), { success: "رُفضت الإجازة", refresh: ["hr-leave"] })}>رفض</Button></div>}</td>
                </tr>
              ))}
            </Table>
          )}
        </TabsContent>

        <TabsContent value="delegations">
          <div className="mb-3 flex justify-end">{canWrite && <Button variant="outline" onClick={() => setDlg("del")} className="gap-1.5" data-testid="button-new-delegation"><Plus className="h-4 w-4" /> اقتراح تفويض</Button>}</div>
          {delegations.isLoading ? <LoadingRows /> : !delegations.data?.length ? <EmptyState title="لا توجد تفويضات" desc="عند إجازة مدير الفرع تقترح الموارد البشرية من يقوم مقامه، ويعتمد المدير العام التفويض ليصبح ساريًا خلال مدته فقط." /> : (
            <Table testId="table-delegations" head={["المفوِّض", "المفوَّض إليه", "النطاق", "المدة", "الحالة", ""]}>
              {delegations.data.map((d) => (
                <tr key={d.id} className="border-b border-border/60 last:border-0" data-testid={`row-delegation-${d.id}`}>
                  <td className="px-4 py-3" dir="ltr">{d.delegator}</td><td className="px-4 py-3" dir="ltr">{d.delegate}</td><td className="px-4 py-3">{SCOPE[d.scope] ?? d.scope}</td>
                  <td className="px-4 py-3 num text-[12px]">{day(d.valid_from)} ← {day(d.valid_to)}</td><td className="px-4 py-3"><Pill>{DELEGATION_STATUS[d.status] ?? d.status}</Pill></td>
                  <td className="px-4 py-3 text-left">{role === "super_admin" && d.status === "proposed" && <div className="flex justify-end gap-1.5"><Button size="sm" className="gap-1.5" onClick={() => act.run(() => api(`/hr/delegations/${d.id}/approve`, { method: "POST" }), { success: "اعتُمد التفويض", refresh: ["hr-del"] })} data-testid={`button-delegation-approve-${d.id}`}><ShieldCheck className="h-3.5 w-3.5" /> اعتماد</Button><Button size="sm" variant="ghost" onClick={() => act.run(() => api(`/hr/delegations/${d.id}/reject`, { method: "POST" }), { success: "رُفض التفويض", refresh: ["hr-del"] })}>رفض</Button></div>}
                    {role === "super_admin" && d.status === "approved" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => act.run(() => api(`/hr/delegations/${d.id}/revoke`, { method: "POST" }), { success: "أُلغي التفويض", refresh: ["hr-del"] })}>إلغاء</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
        </TabsContent>

        <TabsContent value="departments">
          {!cat.data?.departments.length ? <EmptyState title="لا توجد أقسام" desc="أنشئ الأقسام الإدارية ثم اربط الموظفين بها." /> : (
            <ul className="grid gap-2 sm:grid-cols-2">{cat.data.departments.map((d) => <li key={d.id} className="rounded-xl border bg-card p-3 text-sm">{d.name} <span className="text-[11px] text-muted-foreground">{d.branchId ? `— ${branchName(d.branchId)}` : "— كل الفروع"}</span></li>)}</ul>
          )}
        </TabsContent>
      </Tabs>

      {dlg === "emp" && cat.data && <EmployeeDialog cat={cat.data} onClose={() => setDlg(null)} />}
      {dlg === "dep" && cat.data && <DepartmentDialog cat={cat.data} onClose={() => setDlg(null)} />}
      {dlg === "leave" && cat.data && <LeaveDialog cat={cat.data} employees={emps.data ?? []} onClose={() => setDlg(null)} />}
      {dlg === "del" && cat.data && <DelegationDialog cat={cat.data} onClose={() => setDlg(null)} />}
      {act.dialog}
    </>
  );
}

function Shell({ title, desc, onClose, children, footer }: { title: string; desc: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" dir="rtl">
        <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter className="gap-2 sm:justify-start">{footer}<Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <div><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
const Pick = ({ value, onChange, options, placeholder, testId }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string; testId?: string }) => (
  <Select value={value} onValueChange={onChange}><SelectTrigger data-testid={testId}><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
);

function EmployeeDialog({ cat, onClose }: { cat: Catalogue; onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ fullName: "", branchId: "", departmentId: "", jobTitleId: "", hireDate: new Date().toISOString().slice(0, 10), nationalId: "", email: "", phone: "", iban: "", basic: "", housing: "", transport: "" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <>
      <Shell title="موظف جديد" desc="سجل موارد بشرية. الراتب والهوية والآيبان تظهر للموارد البشرية والمدير العام والمالية فقط." onClose={onClose}
        footer={<Button disabled={!f.fullName.trim() || !f.branchId} data-testid="button-employee-save" onClick={() => act.run(() => api("/hr/employees", { method: "POST", body: {
          fullName: f.fullName, branchId: Number(f.branchId), departmentId: f.departmentId ? Number(f.departmentId) : null, jobTitleId: f.jobTitleId ? Number(f.jobTitleId) : null, hireDate: f.hireDate,
          nationalId: f.nationalId || null, email: f.email || null, phone: f.phone || null, iban: f.iban || null, basicSalaryHalalas: toHalalas(f.basic || 0), housingAllowanceHalalas: toHalalas(f.housing || 0), transportAllowanceHalalas: toHalalas(f.transport || 0) } }),
          { success: "أُضيف الموظف", refresh: ["hr-emps"], onDone: onClose })}>حفظ</Button>}>
        <Field label="الاسم الكامل"><Input value={f.fullName} onChange={(e) => set("fullName", e.target.value)} data-testid="input-employee-name" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الفرع"><Pick value={f.branchId} onChange={(v) => set("branchId", v)} placeholder="اختر" testId="select-employee-branch" options={cat.branches.map((b) => ({ value: String(b.id), label: b.name }))} /></Field>
          <Field label="القسم"><Pick value={f.departmentId} onChange={(v) => set("departmentId", v)} placeholder="اختر" options={cat.departments.filter((d) => !d.branchId || String(d.branchId) === f.branchId).map((d) => ({ value: String(d.id), label: d.name }))} /></Field>
          <Field label="المسمى الوظيفي"><Pick value={f.jobTitleId} onChange={(v) => set("jobTitleId", v)} placeholder="اختر" options={cat.jobTitles.map((t) => ({ value: String(t.id), label: t.name }))} /></Field>
          <Field label="تاريخ التعيين"><Input type="date" value={f.hireDate} onChange={(e) => set("hireDate", e.target.value)} /></Field>
          <Field label="الهوية / الإقامة"><Input dir="ltr" value={f.nationalId} onChange={(e) => set("nationalId", e.target.value)} /></Field>
          <Field label="الجوال"><Input dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        </div>
        <Field label="البريد"><Input dir="ltr" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="الآيبان"><Input dir="ltr" value={f.iban} onChange={(e) => set("iban", e.target.value)} placeholder="SA…" /></Field>
        <div className="grid grid-cols-3 gap-3"><Field label="الراتب الأساسي"><Input type="number" min={0} value={f.basic} onChange={(e) => set("basic", e.target.value)} /></Field><Field label="بدل السكن"><Input type="number" min={0} value={f.housing} onChange={(e) => set("housing", e.target.value)} /></Field><Field label="بدل النقل"><Input type="number" min={0} value={f.transport} onChange={(e) => set("transport", e.target.value)} /></Field></div>
      </Shell>
      {act.dialog}
    </>
  );
}

function DepartmentDialog({ cat, onClose }: { cat: Catalogue; onClose: () => void }) {
  const act = useAct();
  const [name, setName] = useState(""); const [branch, setBranch] = useState("all");
  return (
    <>
      <Shell title="قسم جديد" desc="قسم إداري لكل الفروع أو لفرع بعينه." onClose={onClose} footer={<Button disabled={!name.trim()} data-testid="button-department-save" onClick={() => act.run(() => api("/hr/departments", { method: "POST", body: { name, branchId: branch === "all" ? null : Number(branch) } }), { success: "أُنشئ القسم", refresh: ["hr-cat"], onDone: onClose })}>حفظ</Button>}>
        <Field label="اسم القسم"><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-department-name" /></Field>
        <Field label="الفرع"><Pick value={branch} onChange={setBranch} placeholder="كل الفروع" options={[{ value: "all", label: "كل الفروع" }, ...cat.branches.map((b) => ({ value: String(b.id), label: b.name }))]} /></Field>
      </Shell>
      {act.dialog}
    </>
  );
}

function LeaveDialog({ cat, employees, onClose }: { cat: Catalogue; employees: Employee[]; onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ employeeId: "", leaveTypeId: "", startDate: "", endDate: "", reason: "" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <>
      <Shell title="تسجيل إجازة" desc="لا يسمح النظام بإجازتين متداخلتين لنفس الموظف." onClose={onClose}
        footer={<Button disabled={!f.employeeId || !f.leaveTypeId || !f.startDate || !f.endDate} data-testid="button-leave-save" onClick={() => act.run(() => api("/hr/leave", { method: "POST", body: { ...f, employeeId: Number(f.employeeId), leaveTypeId: Number(f.leaveTypeId), reason: f.reason || undefined } }), { success: "سُجّلت الإجازة", refresh: ["hr-leave"], onDone: onClose })}>تسجيل</Button>}>
        <Field label="الموظف"><Pick value={f.employeeId} onChange={(v) => set("employeeId", v)} placeholder="اختر" testId="select-leave-employee" options={employees.map((e) => ({ value: String(e.id), label: `${e.employeeNo} — ${e.fullName}` }))} /></Field>
        <Field label="النوع"><Pick value={f.leaveTypeId} onChange={(v) => set("leaveTypeId", v)} placeholder="اختر" options={cat.leaveTypes.map((t) => ({ value: String(t.id), label: t.name }))} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="من"><Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field><Field label="إلى"><Input type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field></div>
        <Field label="السبب"><Input value={f.reason} onChange={(e) => set("reason", e.target.value)} maxLength={300} /></Field>
      </Shell>
      {act.dialog}
    </>
  );
}

function DelegationDialog({ cat, onClose }: { cat: Catalogue; onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ delegatorMemberId: "", delegateMemberId: "", validFrom: "", validTo: "", scope: "purchase_approval" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const managers = cat.members.filter((m) => m.role === "branch_manager");
  const others = cat.members.filter((m) => m.role !== "student" && m.role !== "instructor" && String(m.id) !== f.delegatorMemberId);
  return (
    <>
      <Shell title="اقتراح تفويض" desc="يصبح التفويض ساريًا بعد اعتماد المدير العام، وخلال المدة المحددة فقط. لا يعتمد المدير تفويضًا اقترحه بنفسه." onClose={onClose}
        footer={<Button disabled={!f.delegatorMemberId || !f.delegateMemberId || !f.validFrom || !f.validTo} data-testid="button-delegation-save" onClick={() => act.run(() => api("/hr/delegations", { method: "POST", body: { ...f, delegatorMemberId: Number(f.delegatorMemberId), delegateMemberId: Number(f.delegateMemberId) } }), { success: "رُفع التفويض للمدير العام", refresh: ["hr-del"], onDone: onClose })}>رفع للاعتماد</Button>}>
        <Field label="المفوِّض (مدير الفرع المجاز)"><Pick value={f.delegatorMemberId} onChange={(v) => set("delegatorMemberId", v)} placeholder="اختر" testId="select-delegator" options={managers.map((m) => ({ value: String(m.id), label: m.email }))} /></Field>
        <Field label="المفوَّض إليه (مثل قسم المشتريات بالإدارة الرئيسية)"><Pick value={f.delegateMemberId} onChange={(v) => set("delegateMemberId", v)} placeholder="اختر" testId="select-delegate" options={others.map((m) => ({ value: String(m.id), label: `${m.email} — ${ROLE_LABELS[m.role] ?? m.role}` }))} /></Field>
        <Field label="النطاق"><Pick value={f.scope} onChange={(v) => set("scope", v)} placeholder="" options={Object.entries(SCOPE).map(([v, l]) => ({ value: v, label: l }))} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="من"><Input type="date" value={f.validFrom} onChange={(e) => set("validFrom", e.target.value)} /></Field><Field label="إلى"><Input type="date" value={f.validTo} onChange={(e) => set("validTo", e.target.value)} /></Field></div>
      </Shell>
      {act.dialog}
    </>
  );
}
