import { Download, MonitorSmartphone, ShieldCheck, ShieldAlert, Smartphone, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/bits";
import { useInstallPrompt, usePageTitle, useWorkspace } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";

const steps = [
  { icon: MonitorSmartphone, title: "Chrome و Edge على الحاسب", text: "افتح القائمة أو أيقونة التثبيت في شريط العنوان، ثم اختر «تثبيت التطبيق»." },
  { icon: Smartphone, title: "Android", text: "من قائمة المتصفح اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»." },
  { icon: Smartphone, title: "iPhone و iPad (Safari)", text: "اضغط زر المشاركة، ثم «إضافة إلى الشاشة الرئيسية»، ثم «إضافة»." },
];

export default function SettingsPage() {
  usePageTitle("الإعدادات والتثبيت");
  const ws = useWorkspace();
  const { canPrompt, installed, install } = useInstallPrompt();
  const { toast } = useToast();

  return (
    <>
      <PageHeader eyebrow="النظام" title="الإعدادات والتثبيت" desc="تثبيت التطبيق على أجهزتك، ونطاق مساحة العمل والأمان في هذا الإصدار." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rise rounded-xl border bg-card p-6">
          <h2 className="font-display text-xl text-primary">تثبيت التطبيق</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">هذا تطبيق ويب قابل للتثبيت يعمل على الحاسب والجوال من المتصفح، وليس تطبيقًا أصليًا من المتاجر. لا تُخزَّن بيانات المعهد أو الطلاب أو المالية للعمل دون اتصال.</p>
          <div className="mt-5">
            {installed ? (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> التطبيق مثبت ويعمل في نافذة مستقلة.</div>
            ) : canPrompt ? (
              <Button className="gap-1.5" data-testid="button-install" onClick={async () => { const ok = await install(); toast({ title: ok ? "بدأ التثبيت" : "أُلغي التثبيت" }); }}>
                <Download className="h-4 w-4" /> تثبيت على هذا الجهاز
              </Button>
            ) : (
              <p className="rounded-lg bg-muted p-3 text-xs leading-6 text-muted-foreground" data-testid="text-install-unavailable">متصفحك لا يعرض نافذة تثبيت مباشرة الآن. استخدم الخطوات أدناه حسب جهازك.</p>
            )}
          </div>
          <ol className="mt-6 space-y-4">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent text-xs">{i + 1}</span>
                <div><div className="flex items-center gap-1.5 text-sm font-medium"><s.icon className="h-4 w-4 text-primary" />{s.title}</div><p className="mt-0.5 text-xs leading-6 text-muted-foreground">{s.text}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="rise space-y-4" style={{ animationDelay: "80ms" }}>
          <div className="rounded-xl border bg-primary p-6 text-primary-foreground">
            <div className="text-xs text-primary-foreground/60">مساحة العمل الحالية</div>
            <div className="mt-1 font-display text-2xl" data-testid="text-workspace-label">{ws.data?.label ?? "..."}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-primary-foreground/10 px-2.5 py-1">{ws.data?.mode === "organization" ? "مساحة المعهد المشتركة" : ws.data?.mode === "personal" ? "مساحة شخصية خاصة" : "بيانات توضيحية"}</span>
              <span className="rounded-full bg-primary-foreground/10 px-2.5 py-1">{ws.data?.canWrite ? "قراءة وكتابة" : "قراءة فقط"}</span>
            </div>
          </div>
          <div className="rounded-xl border bg-card p-6">
            <h3 className="mb-3 flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-success" /> مفعّل في هذا الإصدار</h3>
            <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
              <li>تسجيل دخول آمن؛ التسجيل وحده لا يمنح أي صلاحية على المعهد، والحساب غير المدعو يحصل على مساحة خاصة فارغة.</li>
              <li>مساحة مشتركة وأدوار (الإدارة العليا، مدير الفرع، المالية، المنسق، المدرب، الطالب) بنطاق فرع يفرضه الخادم.</li>
              <li>تحقق الخادم من العلاقات بين السجلات وتعارضات الجدولة والسعة.</li>
              <li>البيانات التوضيحية العامة للقراءة فقط ولا تحتوي بيانات حقيقية.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-accent/40 bg-accent/10 p-6">
            <h3 className="mb-3 flex items-center gap-2 font-medium"><ShieldAlert className="h-4 w-4 text-[hsl(32_80%_32%)]" /> غير مفعّل بعد</h3>
            <ul className="space-y-2 text-sm leading-6">
              <li>سجل تدقيق مفصل للعمليات المالية، والنسخ الاحتياطي والاستعادة المختبرة.</li>
              <li>الإشعارات، وسياسات الأقساط والإهلاك وتوزيع الطاقة المعتمدة.</li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">لا تُدخل بيانات تشغيلية حقيقية للمعهد قبل تفعيل هذه الضوابط.</p>
          </div>
        </section>
      </div>
    </>
  );
}
