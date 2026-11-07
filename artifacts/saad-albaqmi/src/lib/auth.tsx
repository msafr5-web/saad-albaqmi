import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Show as ClerkShow, useClerk, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Two interchangeable sign-in back ends chosen at BUILD time: Clerk (default) or the self-hosted one (VITE_AUTH_MODE=local,
 * which needs no external provider or subscription). Everything else in the app talks to the helpers below only.
 */
export const LOCAL_AUTH = import.meta.env.VITE_AUTH_MODE === "local";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type Status = "loading" | "in" | "out";
type Ctx = { status: Status; email: string; mustChange: boolean; refresh: () => Promise<void>; signOut: () => Promise<void> };
const LocalCtx = createContext<Ctx>({ status: "loading", email: "", mustChange: false, refresh: async () => {}, signOut: async () => {} });

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${basePath}${path}`, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? "تعذر إتمام العملية");
  return data;
}

export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<{ status: Status; email: string; mustChange: boolean }>({ status: "loading", email: "", mustChange: false });
  const refresh = useCallback(async () => {
    try {
      const me = await api<{ signedIn: boolean; email?: string; mustChange?: boolean }>("GET", "/api/auth/me");
      setState(me.signedIn ? { status: "in", email: me.email ?? "", mustChange: !!me.mustChange } : { status: "out", email: "", mustChange: false });
    } catch { setState({ status: "out", email: "", mustChange: false }); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const signOut = useCallback(async () => {
    try { await api("POST", "/api/auth/logout", {}); } catch { /* the cookie is cleared by the server when it answers */ }
    qc.clear(); await refresh(); window.location.assign(basePath || "/");
  }, [qc, refresh]);
  const value = useMemo(() => ({ ...state, refresh, signOut }), [state, refresh, signOut]);
  return <LocalCtx.Provider value={value}>{children}</LocalCtx.Provider>;
}

/** Renders children only for the matching sign-in state (same contract as Clerk's <Show>). */
export function Show({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) {
  if (!LOCAL_AUTH) return <ClerkShow when={when}>{children}</ClerkShow>;
  return <LocalShow when={when}>{children}</LocalShow>;
}
function LocalShow({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) {
  const { status, mustChange } = useContext(LocalCtx);
  if (status === "loading") return when === "signed-in" ? <div className="p-8 text-sm text-muted-foreground">جارٍ التحميل...</div> : null;
  if (when === "signed-in") return status === "in" ? (mustChange ? <ChangePasswordForm forced /> : <>{children}</>) : null;
  return status === "out" ? <>{children}</> : null;
}

export function useAuthUser(): { email: string } {
  if (LOCAL_AUTH) { const c = useContext(LocalCtx); return { email: c.email }; }
  const { user } = useUser();
  return { email: user?.primaryEmailAddress?.emailAddress ?? "" };
}

export function useSignOutAction(): () => void {
  if (LOCAL_AUTH) { const c = useContext(LocalCtx); return () => { void c.signOut(); }; }
  const { signOut } = useClerk();
  return () => { void signOut({ redirectUrl: basePath || "/" }); };
}

const field = "mt-1 w-full rounded-lg border border-[#d6d3cc] bg-[#f4f3f0] px-3 py-2.5 text-sm text-[#0e100f] outline-none focus:border-[#0e100f]";
const btn = "mt-2 w-full rounded-lg bg-[#0e100f] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="w-[440px] max-w-full rounded-2xl border border-[#e3e1dc] bg-white p-8 shadow-xl" dir="rtl">
      <img src={`${basePath}/logo.svg`} alt="" className="mx-auto mb-3 h-12 w-12" />
      <h1 className="text-center text-2xl text-[#0e100f]">{title}</h1>
      {subtitle ? <p className="mt-1 text-center text-sm text-[#5a5f5c]">{subtitle}</p> : null}
      <div className="mt-6 space-y-3">{children}</div>
    </div>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(""); try { await action(); } catch (x) { setError((x as Error).message); } finally { setBusy(false); } };
  return { busy, error, submit };
}

/** Self-hosted sign-in. "?setup=1" opens the one-time owner setup (needs the setup token printed by the server installer). */
export function LocalSignIn() {
  const { refresh } = useContext(LocalCtx); const qc = useQueryClient();
  const setupMode = new URLSearchParams(window.location.search).has("setup");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [token, setToken] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    await api("POST", setupMode ? "/api/auth/setup-owner" : "/api/auth/login", setupMode ? { email, password, setupToken: token } : { email, password });
    qc.clear(); await refresh(); window.location.assign(`${basePath}/dashboard`);
  });
  return (
    <Card title={setupMode ? "إعداد حساب المالك" : "مرحبًا بعودتك"} subtitle={setupMode ? "أول مرة فقط: أدخل رمز الإعداد الذي أعطاك إياه مسؤول الخادم" : "سجّل الدخول إلى مساحة عملك"}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm text-[#0e100f]">البريد الإلكتروني<input className={field} type="email" autoComplete="username" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" /></label>
        <label className="block text-sm text-[#0e100f]">كلمة المرور<input className={field} type="password" autoComplete={setupMode ? "new-password" : "current-password"} required dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" /></label>
        {setupMode ? <label className="block text-sm text-[#0e100f]">رمز الإعداد<input className={field} type="password" required dir="ltr" value={token} onChange={(e) => setToken(e.target.value)} /></label> : null}
        {error ? <p role="alert" className="rounded-lg border border-[#e3e1dc] bg-[#f4f3f0] p-3 text-sm text-[#c0392b]">{error}</p> : null}
        <button className={btn} disabled={busy} data-testid="button-login">{busy ? "جارٍ التحقق..." : setupMode ? "إنشاء حساب المالك" : "تسجيل الدخول"}</button>
        <p className="pt-2 text-center text-xs text-[#5a5f5c]">الحسابات تُصدرها الإدارة العليا؛ لا يوجد تسجيل ذاتي.</p>
      </form>
    </Card>
  );
}

function ChangePasswordForm({ forced }: { forced?: boolean }) {
  const { refresh } = useContext(LocalCtx);
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    if (next !== again) throw new Error("كلمتا المرور غير متطابقتين");
    await api("POST", "/api/auth/change-password", { currentPassword: cur, newPassword: next });
    await refresh();
  });
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-4">
      <Card title={forced ? "غيّر كلمة المرور المؤقتة" : "تغيير كلمة المرور"} subtitle="10 أحرف على الأقل، تحوي حروفًا وأرقامًا">
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-[#0e100f]">كلمة المرور الحالية (المؤقتة)<input className={field} type="password" required dir="ltr" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
          <label className="block text-sm text-[#0e100f]">كلمة المرور الجديدة<input className={field} type="password" required dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <label className="block text-sm text-[#0e100f]">تأكيد كلمة المرور<input className={field} type="password" required dir="ltr" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
          {error ? <p role="alert" className="rounded-lg border border-[#e3e1dc] bg-[#f4f3f0] p-3 text-sm text-[#c0392b]">{error}</p> : null}
          <button className={btn} disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ ومتابعة"}</button>
        </form>
      </Card>
    </div>
  );
}
