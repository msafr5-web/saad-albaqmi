import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import {
  LayoutDashboard, Building2, DoorOpen, Package, GraduationCap, Users, UserRound,
  Wallet, CalendarClock, UsersRound, FileBarChart, Settings, Nfc, LogOut, Menu, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/use-data";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const NAV = [
  { href: "/dashboard", label: "النظرة التنفيذية", icon: LayoutDashboard },
  { href: "/branches", label: "الفروع", icon: Building2 },
  { href: "/rooms", label: "القاعات والمعامل", icon: DoorOpen },
  { href: "/assets", label: "الأصول والجرد", icon: Package },
  { href: "/diplomas", label: "الدبلومات", icon: GraduationCap },
  { href: "/students", label: "الطلاب", icon: Users },
  { href: "/instructors", label: "المدربون", icon: UserRound },
  { href: "/finance", label: "المالية", icon: Wallet },
  { href: "/schedule", label: "الجدولة", icon: CalendarClock },
  { href: "/reports", label: "التقارير", icon: FileBarChart },
  { href: "/nfc", label: "أدوات NFC", icon: Nfc },
  { href: "/team", label: "فريق العمل", icon: UsersRound },
  { href: "/settings", label: "الإعدادات والتثبيت", icon: Settings },
];

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "الإدارة العليا", branch_manager: "مدير فرع", finance: "المالية",
  coordinator: "منسق", instructor: "مدرب", student: "طالب",
};

/** Mirrors the server's page list; the server remains the enforcement point for data. */
export function allowed(ws: { mode: string; pages: string[] } | undefined, href: string) {
  const page = href.slice(1);
  if (!ws) return page !== "team";
  if (ws.mode === "organization") return ws.pages.includes(page);
  return page !== "team";
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3" data-testid="link-brand">
      <img src={`${basePath}/logo.svg`} alt="" className="h-10 w-10 rounded-xl" />
      <div className="leading-tight">
        <div className="font-display text-[15px] text-sidebar-foreground">صرح د. سعد البقمي</div>
        <div className="text-[11px] text-sidebar-foreground/55">المنظومة التعليمية الموحدة</div>
      </div>
    </Link>
  );
}

function SideContent({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const ws = useWorkspace();
  return (
    <div className="girih flex h-full flex-col bg-sidebar p-4 text-sidebar-foreground">
      <div className="mb-6 px-1 pt-1"><Brand /></div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {NAV.filter((n) => allowed(ws.data, n.href)).map((n) => {
          const active = loc === n.href;
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              data-testid={`link-nav-${n.href.slice(1)}`}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <span className={cn("absolute right-0 top-2 bottom-2 w-0.5 rounded-full bg-sidebar-primary transition-opacity", active ? "opacity-100" : "opacity-0")} />
              <Icon className={cn("h-4 w-4 transition-transform group-hover:-translate-x-0.5", active && "text-sidebar-primary")} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 space-y-3 border-t border-sidebar-border pt-4">
        <div className="rounded-lg bg-sidebar-accent/70 p-3 text-[11px] leading-5">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-sidebar-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
            {ws.data?.mode === "organization" ? "مساحة المعهد" : ws.data?.mode === "personal" ? "مساحة عمل شخصية" : "مساحة توضيحية"}
          </div>
          <div className="text-sidebar-foreground/65">{ws.data?.label ?? "جارٍ التحقق من المساحة"}</div>
          <div className="mt-1 text-sidebar-foreground/45" data-testid="text-role">{ws.data?.mode === "organization" && ws.data.role ? `دورك: ${ROLE_LABELS[ws.data.role]}` : "لا توجد صلاحيات مؤسسية لهذا الحساب"}</div>
        </div>
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0 text-xs">
            <div className="truncate text-sidebar-foreground/85" data-testid="text-user-email">{user?.primaryEmailAddress?.emailAddress ?? ""}</div>
          </div>
          <button
            type="button"
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            data-testid="button-signout"
          >
            <LogOut className="h-3.5 w-3.5" /> خروج
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 right-0 z-30 hidden w-64 lg:block"><SideContent /></aside>
      <div className="sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-3 lg:hidden">
        <Brand />
        <button onClick={() => setOpen(true)} className="rounded-md p-2 text-sidebar-foreground" aria-label="القائمة" data-testid="button-menu">
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40 animate-in fade-in" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-72 animate-in slide-in-from-right duration-300">
            <button onClick={() => setOpen(false)} className="absolute left-3 top-4 z-10 rounded-md p-1.5 text-sidebar-foreground" aria-label="إغلاق" data-testid="button-menu-close">
              <X className="h-5 w-5" />
            </button>
            <SideContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <main className="lg:mr-64">
        <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  );
}
