import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import NfcPage from "@/pages/nfc";
import {
  DashboardPage, BranchesPage, RoomsPage, AssetsPage, DiplomasPage, StudentsPage,
  InstructorsPage, FinancePage, SchedulePage,
} from "@/pages/modules";
import { AppShell, allowed } from "@/components/shell";
import TeamPage from "@/pages/team";
import { useWorkspace } from "@/hooks/use-data";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#18514d",
    colorForeground: "#13302e",
    colorMutedForeground: "#566b69",
    colorDanger: "#bb4130",
    colorBackground: "#fcfaf5",
    colorInput: "#f6f1e6",
    colorInputForeground: "#13302e",
    colorNeutral: "#13302e",
    fontFamily: "'IBM Plex Sans Arabic', system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#fcfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#e2d9c6] shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#18514d] text-2xl",
    headerSubtitle: "text-[#566b69]",
    socialButtonsBlockButtonText: "text-[#13302e]",
    formFieldLabel: "text-[#13302e]",
    footerActionLink: "text-[#18514d] font-semibold",
    footerActionText: "text-[#566b69]",
    dividerText: "text-[#566b69]",
    identityPreviewEditButton: "text-[#18514d]",
    formFieldSuccessText: "text-[#2b7a5a]",
    alertText: "text-[#13302e]",
    logoBox: "h-12 justify-center",
    logoImage: "h-12 w-12",
    socialButtonsBlockButton: "border-[#e2d9c6] bg-[#fcfaf5]",
    formButtonPrimary: "bg-[#18514d] text-[#f7f1e4]",
    formFieldInput: "border-[#d8ccb4] bg-[#f6f1e6]",
    footerAction: "justify-center",
    dividerLine: "bg-[#e2d9c6]",
    alert: "border-[#e2d9c6] bg-[#f6f1e6]",
    otpCodeFieldInput: "border-[#d8ccb4]",
    formFieldRow: "gap-3",
    main: "gap-5",
  },
};

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-2">
      <div className="flex items-center justify-center bg-background px-4 py-10">{children}</div>
      <div className="girih relative hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="font-display text-lg">صرح د. سعد البقمي التعليمي</div>
        <div>
          <p className="font-display text-4xl leading-[1.4]">الفروع والتدريب والتكاليف<br /><span className="text-sidebar-primary">في مساحة واحدة.</span></p>
          <p className="mt-4 max-w-md text-sm leading-7 text-sidebar-foreground/70">التسجيل لا يمنح صلاحيات على مساحة المعهد. تُمنح الصلاحيات بدعوة من الإدارة العليا حسب الدور والفرع، وإلا تحصل على مساحة شخصية خاصة وفارغة.</p>
        </div>
        <div className="text-xs text-sidebar-foreground/45">إصدار تشغيلي أول</div>
      </div>
    </div>
  );
}

function SignInPage() {
  useEffect(() => { document.title = "تسجيل الدخول | صرح د. سعد البقمي التعليمي"; }, []);
  return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>;
}

function SignUpPage() {
  useEffect(() => { document.title = "إنشاء حساب | صرح د. سعد البقمي التعليمي"; }, []);
  return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/dashboard" /></Show>
      <Show when="signed-out"><HomePage /></Show>
    </>
  );
}

function RoleGate({ page, children }: { page: string; children: ReactNode }) {
  const ws = useWorkspace();
  if (ws.isLoading) return <div className="p-8 text-sm text-muted-foreground">جارٍ التحقق من صلاحياتك...</div>;
  if (!ws.data || !allowed(ws.data, `/${page}`)) return <Redirect to="/dashboard" />;
  return <>{children}</>;
}

function protect(Page: ComponentType, page: string) {
  return function Protected() {
    return (
      <>
        <Show when="signed-in"><AppShell>{page === "dashboard" ? <Page /> : <RoleGate page={page}><Page /></RoleGate>}</AppShell></Show>
        <Show when="signed-out"><Redirect to="/" /></Show>
      </>
    );
  };
}

const P = {
  dashboard: protect(DashboardPage, "dashboard"), branches: protect(BranchesPage, "branches"), rooms: protect(RoomsPage, "rooms"),
  assets: protect(AssetsPage, "assets"), diplomas: protect(DiplomasPage, "diplomas"), students: protect(StudentsPage, "students"),
  instructors: protect(InstructorsPage, "instructors"), finance: protect(FinancePage, "finance"), schedule: protect(SchedulePage, "schedule"),
  reports: protect(ReportsPage, "reports"), settings: protect(SettingsPage, "settings"), nfc: protect(NfcPage, "nfc"), team: protect(TeamPage, "team"),
};

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        locale: "ar-SA",
        signIn: { start: { title: "مرحبًا بعودتك", subtitle: "سجّل الدخول إلى مساحة عملك", actionText: "ليس لديك حساب؟", actionLink: "أنشئ حسابًا" } },
        signUp: { start: { title: "إنشاء حساب", subtitle: "استخدم البريد الذي وصلته به الدعوة إن كانت لديك دعوة", actionText: "لديك حساب؟", actionLink: "سجّل الدخول" } },
        formFieldLabel__emailAddress: "البريد الإلكتروني",
        formFieldLabel__password: "كلمة المرور",
        formFieldLabel__firstName: "الاسم الأول",
        formFieldLabel__lastName: "اسم العائلة",
        formButtonPrimary: "متابعة",
        dividerText: "أو",
        socialButtonsBlockButton: "المتابعة عبر {{provider|titleize}}",
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/dashboard" component={P.dashboard} />
              <Route path="/branches" component={P.branches} />
              <Route path="/rooms" component={P.rooms} />
              <Route path="/assets" component={P.assets} />
              <Route path="/diplomas" component={P.diplomas} />
              <Route path="/students" component={P.students} />
              <Route path="/instructors" component={P.instructors} />
              <Route path="/finance" component={P.finance} />
              <Route path="/schedule" component={P.schedule} />
              <Route path="/reports" component={P.reports} />
              <Route path="/nfc" component={P.nfc} />
              <Route path="/team" component={P.team} />
              <Route path="/settings" component={P.settings} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
