import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListTeam, useInviteMember, useUpdateMember, getListTeamQueryKey, type Role, type TeamMember } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, ErrorState, LoadingRows } from "@/components/bits";
import { ROLE_LABELS } from "@/components/shell";
import { useRecords, useRecordIndex, usePageTitle } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { LOCAL_AUTH } from "@/lib/auth";
import { api } from "@/hooks/use-ops";

const ROLE_ORDER: Role[] = ["super_admin", "branch_manager", "finance", "coordinator", "instructor", "student", "warehouse_keeper", "procurement_officer", "hr_officer"];
const STATUS: Record<string, string> = { invited: "دعوة معلقة", active: "نشط", revoked: "ملغى" };

function errMessage(e: unknown) {
  const data = (e as { data?: { error?: string } })?.data;
  return data?.error ?? "تعذر إتمام العملية";
}

export default function TeamPage() {
  usePageTitle("فريق العمل");
  const qc = useQueryClient();
  const { toast } = useToast();
  const team = useListTeam({ query: { queryKey: getListTeamQueryKey() } });
  const records = useRecords();
  const idx = useRecordIndex(records.data);
  const invite = useInviteMember();
  const update = useUpdateMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("branch_manager");
  const [branch, setBranch] = useState("");
  const [link, setLink] = useState("");

  const branches = idx.of("branch");
  const needsBranch = role !== "super_admin" && role !== "finance" && role !== "procurement_officer" && role !== "hr_officer";
  const linkKind = role === "student" ? "student" : role === "instructor" ? "instructor" : null;
  const linkables = linkKind ? idx.of(linkKind).filter((r) => String(r.branchId) === branch) : [];
  const refresh = () => qc.invalidateQueries({ queryKey: getListTeamQueryKey() });

  const submit = () => {
    invite.mutate(
      { data: { email, role, branchId: needsBranch || (role === "finance" && branch) ? Number(branch) || null : null, linkedRecordId: linkKind ? Number(link) || null : null } },
      {
        onSuccess: (m) => { m.emailSent ? toast({ title: "تم إنشاء الدعوة وإرسالها بالبريد", description: "يفعّل المدعو صلاحيته بالدخول بالبريد نفسه بعد التحقق منه." }) : toast({ title: "أُنشئت الدعوة لكن لم يُرسل البريد", description: `${m.emailError ?? "تعذر الإرسال"}. أبلغ المدعو يدويًا بالتسجيل بالبريد نفسه.`, variant: "destructive" }); setEmail(""); setLink(""); refresh(); },
        onError: (e) => toast({ title: "تعذر إنشاء الدعوة", description: errMessage(e), variant: "destructive" }),
      },
    );
  };
  const revoke = (m: TeamMember) => {
    update.mutate({ id: m.id, data: { status: "revoked" } }, {
      onSuccess: () => { toast({ title: "أُلغيت الصلاحية" }); refresh(); },
      onError: (e) => toast({ title: "تعذر الإلغاء", description: errMessage(e), variant: "destructive" }),
    });
  };
  /** Self-hosted sign-in: the administrator issues the account and hands over a one-time temporary password. */
  const issueAccount = async (m: TeamMember) => {
    try {
      const r = await api<{ temporaryPassword: string }>("/auth/accounts", { method: "POST", body: { email: m.email } });
      window.prompt(`كلمة المرور المؤقتة لـ ${m.email} (انسخها الآن؛ لن تظهر مرة أخرى ويغيّرها العضو عند أول دخول):`, r.temporaryPassword);
    } catch (e) { toast({ title: "تعذر إصدار الحساب", description: errMessage(e), variant: "destructive" }); }
  };
  const rows = (team.data ?? []).filter((m) => m.status !== "revoked");

  return (
    <>
      <PageHeader eyebrow="الإدارة" title="فريق العمل والصلاحيات" desc="ادعُ أعضاء الفريق بحسب الدور والفرع. لا تُمنح الصلاحية إلا لمن يسجل الدخول ببريد موثّق مطابق للدعوة." />
      <section className="mb-8 rounded-xl border bg-card p-5" data-testid="form-invite">
        <h2 className="mb-4 font-display text-lg text-primary">دعوة عضو جديد</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="input-invite-email" />
          <Select value={role} onValueChange={(v) => { setRole(v as Role); setLink(""); }}>
            <SelectTrigger data-testid="select-invite-role"><SelectValue /></SelectTrigger>
            <SelectContent>{ROLE_ORDER.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
          </Select>
          {role !== "super_admin" && (
            <Select value={branch} onValueChange={(v) => { setBranch(v); setLink(""); }}>
              <SelectTrigger data-testid="select-invite-branch"><SelectValue placeholder={role === "finance" ? "كل الفروع (اختياري)" : "اختر الفرع"} /></SelectTrigger>
              <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {linkKind && (
            <Select value={link} onValueChange={setLink}>
              <SelectTrigger data-testid="select-invite-link"><SelectValue placeholder={linkKind === "student" ? "سجل الطالب" : "سجل المدرب"} /></SelectTrigger>
              <SelectContent>{linkables.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <Button className="mt-4" onClick={submit} disabled={invite.isPending || !email} data-testid="button-invite">إنشاء الدعوة</Button>
      </section>

      {team.isLoading ? <LoadingRows /> : team.isError ? <ErrorState error={team.error} onRetry={() => team.refetch()} /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm" data-testid="table-team">
            <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">
              <th className="px-4 py-3 font-medium">البريد</th><th className="px-4 py-3 font-medium">الدور</th><th className="px-4 py-3 font-medium">النطاق</th><th className="px-4 py-3 font-medium">الحالة</th><th className="px-4 py-3" />
            </tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b last:border-0" data-testid={`row-member-${m.id}`}>
                  <td className="px-4 py-3" dir="ltr">{m.email}</td>
                  <td className="px-4 py-3">{ROLE_LABELS[m.role]}</td>
                  <td className="px-4 py-3">{m.branchId ? idx.nameOf(m.branchId) : "كل الفروع"}{m.linkedRecordId ? ` — ${idx.nameOf(m.linkedRecordId)}` : ""}</td>
                  <td className="px-4 py-3">{STATUS[m.status]}</td>
                  <td className="px-4 py-3 text-left">{LOCAL_AUTH ? <Button size="sm" variant="outline" className="ml-2" onClick={() => issueAccount(m)} data-testid={`button-issue-${m.id}`}>إصدار/إعادة كلمة مرور</Button> : null}<Button size="sm" variant="outline" className="text-destructive" onClick={() => revoke(m)} data-testid={`button-revoke-${m.id}`}>{m.status === "invited" ? "إلغاء الدعوة" : "إلغاء الصلاحية"}</Button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">لا يوجد أعضاء بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
