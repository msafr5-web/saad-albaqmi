import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="girih flex min-h-[100dvh] w-full items-center justify-center bg-background px-4">
      <div className="rise max-w-md text-center">
        <div className="num text-6xl text-accent">404</div>
        <h1 className="mt-4 font-display text-2xl text-primary">الصفحة غير موجودة</h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">ربما نُقل الرابط أو كُتب بشكل غير صحيح.</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" data-testid="link-home">العودة للرئيسية</Link>
      </div>
    </div>
  );
}
