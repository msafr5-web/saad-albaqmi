import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, Lock, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { statusLabel, statusTone, errorText } from "@/lib/domain";

export function PageHeader({ eyebrow, title, desc, actions }: { eyebrow: string; title: string; desc?: string; actions?: ReactNode }) {
  return (
    <header className="rise mb-7 flex flex-col gap-4 border-b border-border/80 pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-accent-foreground/70">
          <span className="h-px w-6 bg-accent" />
          <span className="text-[hsl(7_70%_42%)]">{eyebrow}</span>
        </div>
        <h1 className="font-display text-3xl leading-tight text-primary md:text-4xl" data-testid="text-page-title">{title}</h1>
        {desc && <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        tone === "good" && "bg-success/10 text-success",
        tone === "warn" && "bg-warning/12 text-[hsl(32_80%_32%)]",
        tone === "bad" && "bg-destructive/10 text-destructive",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}

export function Meter({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const tone = value >= 100 ? "bg-destructive" : value >= 80 ? "bg-warning" : "bg-primary";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("bar-fill h-full rounded-full", tone)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Kpi({ label, value, sub, delay = 0, tone }: { label: string; value: ReactNode; sub?: ReactNode; delay?: number; tone?: "accent" }) {
  return (
    <div
      className={cn(
        "rise group relative overflow-hidden rounded-xl border bg-card p-4 transition-transform duration-300 hover:-translate-y-0.5",
        tone === "accent" && "border-primary bg-primary text-primary-foreground",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={cn("text-xs", tone === "accent" ? "text-primary-foreground/70" : "text-muted-foreground")}>{label}</div>
      <div className="num mt-2 text-start text-2xl font-medium">{value}</div>
      {sub && <div className={cn("mt-1 text-[11px]", tone === "accent" ? "text-primary-foreground/60" : "text-muted-foreground")}>{sub}</div>}
      <span className="absolute inset-x-0 bottom-0 h-0.5 origin-right scale-x-0 bg-accent transition-transform duration-500 group-hover:scale-x-100" />
    </div>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" data-testid="status-loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg bg-muted/80" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center" data-testid="status-error">
      <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-destructive" />
      <p className="text-sm font-medium">تعذر تحميل البيانات</p>
      <p className="mt-1 text-xs text-muted-foreground">{errorText(error)}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} data-testid="button-retry">
        <RotateCw className="ml-1.5 h-3.5 w-3.5" /> إعادة المحاولة
      </Button>
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="girih relative overflow-hidden rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center" data-testid="status-empty">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-accent/50 bg-background">
        <span className="h-3 w-3 rotate-45 bg-accent" />
      </div>
      <p className="font-display text-lg text-primary">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">{desc}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ReadOnlyNotice() {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="status-readonly">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(7_70%_42%)]" />
        <span>هذه بيانات توضيحية للقراءة فقط. سجّل الدخول لإنشاء مساحة عمل خاصة بك وحفظ سجلاتك.</span>
      </div>
      <Link href="/sign-in" className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" data-testid="link-signin-save">
        تسجيل الدخول للحفظ
      </Link>
    </div>
  );
}
