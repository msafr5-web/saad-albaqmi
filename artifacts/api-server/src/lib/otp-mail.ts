import { logger } from "./logger";

export type OtpMailResult = { sent: true } | { sent: false; error: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Masks an address for display and for the audit trail: a***@example.com */
export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

/** Sends the confirmation code through Resend. Never throws; the caller decides what a delivery failure means (fail closed). */
export async function sendOtpEmail(to: string, code: string, actionLabel: string, ttlMinutes: number): Promise<OtpMailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return { sent: false, error: "خدمة البريد غير مهيأة (RESEND_API_KEY / RESEND_FROM_EMAIL)" };
  const html = `<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.9"><h2>رمز تأكيد العملية</h2>
<p>العملية: <b>${esc(actionLabel)}</b></p>
<p style="font-size:30px;letter-spacing:8px;font-weight:700;direction:ltr;text-align:right">${esc(code)}</p>
<p>الرمز صالح لمدة ${ttlMinutes} دقائق ويُستخدم مرة واحدة. إن لم تطلب هذه العملية فتجاهل الرسالة وأبلغ الإدارة، ولا تشارك الرمز مع أحد.</p></div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "رمز تأكيد العملية — صرح د. سعد البقمي", html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { logger.error({ status: r.status }, "otp email failed"); return { sent: false, error: `رفض مزود البريد الإرسال (${r.status})` }; }
    return { sent: true };
  } catch (e) {
    logger.error({ err: e }, "otp email failed");
    return { sent: false, error: "تعذر الاتصال بمزود البريد" };
  }
}
