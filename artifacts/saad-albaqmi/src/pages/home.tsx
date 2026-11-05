import { Link } from "wouter";
import { ArrowLeft, Building2, CalendarClock, Wallet, GraduationCap } from "lucide-react";
import { Overview } from "@/components/overview";
import { usePageTitle } from "@/hooks/use-data";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const pillars = [
  { icon: Building2, t: "الفروع والمرافق", d: "الفروع والقاعات والمعامل والأصول في سجل واحد مترابط." },
  { icon: GraduationCap, t: "التدريب والطلاب", d: "الدبلومات والمدربون والطلاب والحضور والدرجات." },
  { icon: CalendarClock, t: "جدولة بلا تعارض", d: "يرفض الخادم تداخل القاعة أو المدرب أو الطلاب وتجاوز السعة." },
  { icon: Wallet, t: "التكاليف التشغيلية", d: "مصروفات وفواتير وتحصيل، مع تنبيه عند 80% و100% من الميزانية." },
];

export default function HomePage() {
  usePageTitle("");
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="girih relative overflow-hidden bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-5 md:px-8">
          <div className="flex items-center gap-3">
            <img src={`${basePath}/logo.svg`} alt="" className="h-10 w-10 rounded-xl" />
            <span className="font-display text-lg">صرح د. سعد البقمي التعليمي</span>
          </div>
          <div className="flex gap-2">
            <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground" data-testid="link-signin">دخول</Link>
            <Link href="/sign-up" className="rounded-lg bg-sidebar-primary px-4 py-2 text-sm font-medium text-sidebar-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-signup">إنشاء حساب</Link>
          </div>
        </div>
        <div className="mx-auto max-w-[1280px] px-4 pb-16 pt-10 md:px-8 md:pb-24 md:pt-16">
          <span className="rise inline-flex items-center gap-2 rounded-full border border-sidebar-primary/50 px-3 py-1 text-xs text-sidebar-primary" data-testid="badge-demo">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sidebar-primary" /> عرض توضيحي ببيانات غير حقيقية · للقراءة فقط
          </span>
          <h1 className="rise mt-6 max-w-3xl font-display text-4xl leading-[1.25] md:text-6xl" style={{ animationDelay: "80ms" }}>
            صرحٌ واحد،<br /><span className="text-sidebar-primary">وكل فروعه</span> أمام عينيك.
          </h1>
          <p className="rise mt-6 max-w-2xl text-base leading-8 text-sidebar-foreground/75" style={{ animationDelay: "160ms" }}>
            مساحة تنفيذية تربط الفروع والقاعات والأصول والدبلومات والطلاب والمدربين بالتكاليف التشغيلية، لتقارن الفروع بأرقام محسوبة من السجلات لا بالتقدير.
          </p>
          <div className="rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
            <Link href="/sign-up" className="group inline-flex items-center gap-2 rounded-lg bg-sidebar-primary px-5 py-3 text-sm font-medium text-sidebar-primary-foreground" data-testid="link-hero-start">
              ابدأ مساحتك الخاصة <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            </Link>
            <a href="#demo" className="inline-flex items-center rounded-lg border border-sidebar-foreground/25 px-5 py-3 text-sm" data-testid="link-view-demo">استعرض اللوحة التوضيحية</a>
          </div>
        </div>
      </header>

      <section className="mx-auto -mt-8 grid max-w-[1280px] gap-3 px-4 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
        {pillars.map((p, i) => (
          <div key={p.t} className="rise rounded-xl border bg-card p-5 transition-transform hover:-translate-y-1" style={{ animationDelay: `${300 + i * 70}ms` }}>
            <p.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-medium">{p.t}</div>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">{p.d}</p>
          </div>
        ))}
      </section>

      <main id="demo" className="mx-auto max-w-[1280px] px-4 py-14 md:px-8">
        <div className="mb-6 flex flex-col gap-2 border-b pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs text-[hsl(38_60%_38%)]">لوحة توضيحية</div>
            <h2 className="font-display text-3xl text-primary">النظرة التنفيذية</h2>
          </div>
          <p className="max-w-md text-xs leading-6 text-muted-foreground">الأرقام أدناه بيانات توضيحية مشتركة للقراءة فقط. عند تسجيل الدخول تحصل على مساحة عمل شخصية فارغة؛ مساحة المعهد المشتركة وأدوار الفريق غير مفعلة بعد.</p>
        </div>
        <Overview publicView />
      </main>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">صرح د. سعد البقمي التعليمي · إصدار تشغيلي أول</footer>
    </div>
  );
}
