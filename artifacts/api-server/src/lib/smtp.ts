import crypto from "node:crypto";
import tls from "node:tls";
import { logger } from "./logger";

/**
 * Minimal SMTP client (implicit TLS, AUTH LOGIN) so the app can send mail through the organization's own mailbox
 * (e.g. Hostinger: smtp.hostinger.com:465) with no third-party API and no extra dependency.
 */
export type Mail = { to: string; subject: string; html: string; text?: string };
export type MailResult = { sent: true } | { sent: false; error: string };

let override: ((m: Mail) => Promise<void>) | null = null;
/** Test hook: replaces the network transport. */
export const setMailTransport = (fn: ((m: Mail) => Promise<void>) | null) => { override = fn; };

export const smtpConfigured = () => !!(override || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD));

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const encodedSubject = (s: string) => `=?UTF-8?B?${b64(s)}?=`;
const wrap = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
const bare = (addr: string) => /<([^>]+)>/.exec(addr)?.[1] ?? addr;

function buildMessage(from: string, m: Mail): string {
  const boundary = `sq_${crypto.randomBytes(12).toString("hex")}`;
  const domain = bare(from).split("@")[1] ?? "localhost";
  const text = m.text ?? m.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return [
    `From: ${from}`, `To: ${m.to}`, `Subject: ${encodedSubject(m.subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", wrap(b64(text)),
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", wrap(b64(m.html)),
    `--${boundary}--`, "",
  ].join("\r\n");
}

function smtpSend(m: Mail): Promise<void> {
  const host = process.env.SMTP_HOST!, port = Number(process.env.SMTP_PORT ?? 465);
  const user = process.env.SMTP_USER!, pass = process.env.SMTP_PASSWORD!;
  const from = process.env.SMTP_FROM || `صرح د. سعد البقمي التعليمي <${user}>`;
  return new Promise<void>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    let buf = ""; let settled = false;
    const waiters: { want: number[]; res: (l: string) => void; rej: (e: Error) => void }[] = [];
    const finish = (err?: Error) => { if (settled) return; settled = true; socket.destroy(); err ? reject(err) : resolve(); };
    socket.setTimeout(20_000, () => finish(new Error("انتهت مهلة خادم البريد")));
    socket.on("error", (e) => finish(e));
    socket.on("data", (d) => {
      buf += d.toString("utf8");
      for (;;) {
        const lines = buf.split("\r\n"); if (lines.length < 2) return;
        // A reply is complete at the first line whose 4th character is a space ("250 OK"); "250-..." continues.
        const end = lines.findIndex((l, i) => i < lines.length - 1 && /^\d{3} /.test(l));
        if (end < 0) return;
        const reply = lines.slice(0, end + 1).join("\n"); buf = lines.slice(end + 1).join("\r\n");
        const w = waiters.shift(); if (!w) continue;
        const code = Number(reply.slice(0, 3));
        w.want.includes(code) ? w.res(reply) : w.rej(new Error(`SMTP ${reply.slice(0, 120)}`));
      }
    });
    const expect = (...want: number[]) => new Promise<string>((res, rej) => waiters.push({ want, res, rej }));
    const send = (line: string) => socket.write(line + "\r\n");
    (async () => {
      await expect(220);
      send(`EHLO ${process.env.SMTP_EHLO_NAME ?? "drsaad.tech"}`); await expect(250);
      send("AUTH LOGIN"); await expect(334); send(b64(user)); await expect(334); send(b64(pass)); await expect(235);
      send(`MAIL FROM:<${bare(from)}>`); await expect(250);
      send(`RCPT TO:<${m.to}>`); await expect(250, 251);
      send("DATA"); await expect(354);
      socket.write(buildMessage(from, m).replace(/^\./gm, "..") + "\r\n.\r\n"); await expect(250);
      send("QUIT"); finish();
    })().catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

/** Never throws; the caller decides what a delivery failure means (the app fails closed). */
export async function sendMail(m: Mail): Promise<MailResult> {
  if (/[\r\n]/.test(m.to) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m.to)) return { sent: false, error: "عنوان بريد غير صالح" };
  if (!smtpConfigured()) return { sent: false, error: "خدمة البريد غير مهيأة (SMTP_HOST / SMTP_USER / SMTP_PASSWORD)" };
  try { await (override ? override(m) : smtpSend(m)); return { sent: true }; }
  catch (e) { logger.error({ err: (e as Error).message }, "smtp send failed"); return { sent: false, error: "تعذر الاتصال بخادم البريد" }; }
}
