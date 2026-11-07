import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api } from "@/hooks/use-ops";

type Item = { challengeId: string; actionLabel: string; code: string; expiresAt: string };

/**
 * Codes for operations the member started, delivered inside the app (no e-mail provider needed). Open "بطاقتي" on the phone
 * to read the code, then type it in the confirmation dialog on the computer. Shown only to members of the organization.
 */
export function OtpInbox() {
  const q = useQuery({ queryKey: ["otp-inbox"], queryFn: () => api<{ items: Item[] }>("/otp/inbox"), refetchInterval: 4000, retry: false, staleTime: 0 });
  if (q.isError || !q.data) return null;
  return (
    <section className="mt-6 rounded-2xl border bg-card p-4" aria-live="polite" data-testid="otp-inbox">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg text-primary"><KeyRound className="h-5 w-5" /> رموز التأكيد</h2>
      {q.data.items.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد عمليات بانتظار تأكيدك. عند بدء عملية مالية يظهر رمزها هنا.</p> : (
        <ul className="space-y-3">
          {q.data.items.map((i) => (
            <li key={i.challengeId} className="rounded-xl border bg-background p-3">
              <div className="text-sm text-muted-foreground">{i.actionLabel}</div>
              <div className="my-1 text-center font-mono text-4xl font-bold tracking-[0.35em]" dir="ltr" data-testid="otp-code">{i.code}</div>
              <div className="text-xs text-muted-foreground">صالح حتى {new Date(i.expiresAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })} · لا تشاركه مع أحد</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
