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
      <div className="p-3 sm:p-5">
        <header className="hero-frame relative overflow-hidden rounded-[2rem] text-white sm:rounded-[2.5rem]">
          <nav className="relative z-10 mx-3 mt-3 flex items-center justify-between rounded-[1.5rem] bg-white px-4 py-3 text-foreground shadow-sm sm:mx-5 sm:mt-5 sm:px-6">
            <div className="flex items-center gap-3">
              <img src={`${basePath}/brand/lockup.png`} alt="معهد مهارات السعودية العالي للتدريب" className="h-9 w-auto" />
              <span className="hidden h-6 w-px bg-border md:block" />
              <span className="hidden text-sm font-semibold md:block">صرح د. سعد البقمي التعليمي</span>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/sign-in" className="rounded-full border border-accent px-4 py-1.5 text-sm text-accent transition-colors hover:bg-accent hover:text-accent-foreground" data-testid="link-signin">تسجيل الدخول</Link>
              <Link href="/sign-up" className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-transform hover:-translate-y-0.5" data-testid="link-signup">إنشاء حساب</Link>
            </div>
          </nav>
          <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pb-20 pt-16 text-center md:pb-28 md:pt-24">
            <span className="rise inline-flex items-center gap-2 rounded-full border border-white/40 px-3.5 py-1 text-xs" data-testid="badge-demo">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> عرض توضيحي ببيانات غير حقيقية · للقراءة فقط
            </span>
            <h1 className="rise mt-6 text-4xl font-bold leading-[1.35] md:text-5xl" style={{ animationDelay: "80ms" }}>
              صرحٌ واحد، وكل فروعه أمام عينيك
            </h1>
            <p className="rise mt-5 text-base leading-8 text-white/80" style={{ animationDelay: "160ms" }}>
              مساحة تنفيذية تربط الفروع والقاعات والأصول والدبلومات والطلاب والمدربين بالتكاليف التشغيلية، لتقارن الفروع بأرقام محسوبة من السجلات لا بالتقدير.
            </p>
            <div className="rise mt-6 flex flex-wrap justify-center gap-2" style={{ animationDelay: "200ms" }}>
              {["الفروع والمرافق", "الدبلومات والطلاب", "الجدولة", "التكاليف"].map((c) => (
                <span key={c} className="rounded-full border border-white/35 px-4 py-1.5 text-sm">{c}</span>
              ))}
            </div>
            <div className="rise mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: "240ms" }}>
              <Link href="/sign-up" className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3 text-sm font-semibold text-accent-foreground transition-transform hover:-translate-y-0.5" data-testid="link-hero-start">
                ابدأ مساحتك الخاصة <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              </Link>
              <a href="#demo" className="inline-flex items-center rounded-full border border-white/60 px-7 py-3 text-sm transition-colors hover:bg-white/10" data-testid="link-view-demo">استعرض اللوحة التوضيحية</a>
            </div>
          </div>
        </header>
      </div>

      <section className="mx-auto mt-2 grid max-w-[1280px] gap-3 px-4 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
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
            <div className="text-xs text-[hsl(22_90%_38%)]">لوحة توضيحية</div>
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
