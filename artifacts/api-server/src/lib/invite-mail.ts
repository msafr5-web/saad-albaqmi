import { logger } from "./logger";
import type { Role } from "./education-access";

const ROLE_AR: Record<Role, string> = {
  super_admin: "الإدارة العليا", branch_manager: "مدير فرع", finance: "المالية",
  coordinator: "منسق", instructor: "مدرب", student: "طالب",
  warehouse_keeper: "أمين مستودع", procurement_officer: "مختص مشتريات", hr_officer: "مسؤول موارد بشرية",
};

export type MailResult = { sent: true } | { sent: false; error: string };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Sends the invitation through Resend. Never throws: the invitation row exists either way, and the caller reports the outcome. */
export async function sendInviteEmail(to: string, role: Role): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return { sent: false, error: "خدمة البريد غير مهيأة (RESEND_API_KEY / RESEND_FROM_EMAIL)" };
  const base = process.env.APP_PUBLIC_URL?.replace(/\/$/, "");
  const link = base ? `${base}/sign-up` : null;
  const html = `<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.8"><h2>دعوة للانضمام إلى صرح د. سعد البقمي التعليمي</h2>
<p>تمت دعوتك بدور <b>${esc(ROLE_AR[role])}</b>.</p><p>سجّل الدخول أو أنشئ حسابًا بهذا البريد نفسه (${esc(to)}) وتحقق منه لتفعيل صلاحيتك.</p>${link ? `<p><a href="${esc(link)}">فتح التطبيق</a></p>` : ""}</div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "دعوة للانضمام إلى صرح د. سعد البقمي التعليمي", html }),
    });
    if (!r.ok) { const t = await r.text(); logger.error({ status: r.status, body: t }, "invite email failed"); return { sent: false, error: `رفض مزود البريد الإرسال (${r.status})` }; }
    return { sent: true };
  } catch (e) {
    logger.error({ err: e }, "invite email failed");
    return { sent: false, error: "تعذر الاتصال بمزود البريد" };
  }
}
