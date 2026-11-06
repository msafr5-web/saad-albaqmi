import { useListAudit, getListAuditQueryKey } from "@workspace/api-client-react";
import { PageHeader, ErrorState, LoadingRows } from "@/components/bits";
import { usePageTitle } from "@/hooks/use-data";

const ACTIONS: Record<string, string> = { create: "إنشاء سجل", update: "تعديل سجل", delete: "حذف سجل" };

function label(action: string) {
  if (ACTIONS[action]) return ACTIONS[action];
  if (action.startsWith("invite:")) { const [, email, role] = action.split(":"); return `دعوة ${email} (${role})`; }
  if (action.startsWith("policy_draft_v")) return `حفظ مسودة سياسة التكلفة (إصدار ${action.slice(14)})`;
  if (action.startsWith("policy_approve_v")) return `اعتماد سياسة التكلفة (إصدار ${action.slice(16)})`;
  return action;
}

export default function AuditPage() {
  usePageTitle("سجل التدقيق");
  const audit = useListAudit({ query: { queryKey: getListAuditQueryKey() } });
  return (
    <>
      <PageHeader eyebrow="الإدارة" title="سجل التدقيق" desc="آخر 200 عملية على مساحة المعهد، مع هوية المنفّذ." />
      {audit.isLoading ? <LoadingRows /> : audit.isError ? <ErrorState error={audit.error} onRetry={() => audit.refetch()} /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm" data-testid="table-audit">
            <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">
              <th className="px-4 py-3 font-medium">الوقت</th><th className="px-4 py-3 font-medium">العملية</th><th className="px-4 py-3 font-medium">رقم السجل</th><th className="px-4 py-3 font-medium">المنفّذ</th>
            </tr></thead>
            <tbody>
              {(audit.data ?? []).map((e) => (
                <tr key={e.id} className="border-b last:border-0" data-testid={`row-audit-${e.id}`}>
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(e.createdAt).toLocaleString("ar-SA")}</td>
                  <td className="px-4 py-3">{label(e.action)}</td>
                  <td className="px-4 py-3">{e.recordId || "—"}</td>
                  <td className="px-4 py-3" dir="ltr">{e.actorEmail ?? e.actorId ?? "—"}</td>
                </tr>
              ))}
              {(audit.data ?? []).length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">لا توجد عمليات مسجلة.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
