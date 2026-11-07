import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { customFetch, withOtpChallenge } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { errorText } from "@/lib/domain";

type OtpInfo = { action: string; subjectType: string; subject: unknown };
type Pending = OtpInfo & { retry: () => void };

/** The server answers 428 + { otpRequired, otpAction, otpSubject } when a financial operation needs a confirmation code. */
function otpInfo(err: unknown): OtpInfo | null {
  const e = err as { status?: number; data?: { otpRequired?: boolean; otpAction?: string; otpSubject?: unknown; otpSubjectType?: string } } | null;
  if (!e || e.status !== 428 || !e.data?.otpRequired || !e.data.otpAction) return null;
  return { action: e.data.otpAction, subjectType: e.data.otpSubjectType ?? "record", subject: e.data.otpSubject };
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

/**
 * Confirmation-code step for money operations. Usage:
 *   const otp = useOtpGate();
 *   mutate(..., { onError: (e) => { if (!otp.handle(e, retry)) showError(e); } });
 *   ...render {otp.dialog} once in the component.
 * The code is emailed to the signed-in user; after it is verified the original request is repeated with the proof attached.
 */
export function useOtpGate(): { handle: (err: unknown, retry: () => void) => boolean; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const handle = useCallback((err: unknown, retry: () => void) => {
    const info = otpInfo(err);
    if (!info) return false;
    setPending({ ...info, retry });
    return true;
  }, []);
  return { handle, dialog: <OtpDialog pending={pending} onClose={() => setPending(null)} /> };
}

function OtpDialog({ pending, onClose }: { pending: Pending | null; onClose: () => void }) {
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const startedFor = useRef<Pending | null>(null);

  const send = useCallback(async (p: Pending) => {
    setBusy(true); setError(null); setCode("");
    try {
      const r = await customFetch<{ challengeId: string; destination: string }>("/api/otp/challenges", json({ action: p.action, subjectType: p.subjectType, subject: p.subject }));
      setChallengeId(r.challengeId); setDestination(r.destination); setCooldown(60);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }, []);

  // Send the first code as soon as the dialog opens for a new operation.
  useEffect(() => {
    if (pending && startedFor.current !== pending) { startedFor.current = pending; setChallengeId(null); void send(pending); }
    if (!pending) startedFor.current = null;
  }, [pending, send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const confirm = async () => {
    if (!pending || !challengeId || code.length !== 6) return;
    setBusy(true); setError(null);
    try {
      await customFetch(`/api/otp/challenges/${challengeId}/verify`, json({ code }));
      const retry = pending.retry;
      withOtpChallenge(challengeId);       // attached to the very next write request, then cleared
      onClose();
      retry();
    } catch (e) { setError(errorText(e)); setCode(""); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 font-display text-xl text-primary"><ShieldCheck className="h-5 w-5" /> تأكيد العملية</DialogTitle>
          <DialogDescription>
            {challengeId ? `أرسلنا رمزًا من 6 أرقام إلى ${destination}. أدخله لتأكيد العملية؛ الرمز صالح لخمس دقائق.` : busy ? "جارٍ إرسال رمز التأكيد..." : "تعذر إرسال الرمز."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-2" dir="ltr">
          <InputOTP maxLength={6} value={code} onChange={setCode} disabled={!challengeId || busy} data-testid="input-otp">
            <InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
          </InputOTP>
        </div>
        {error && <p className="text-center text-sm text-destructive" data-testid="text-otp-error">{error}</p>}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={confirm} disabled={!challengeId || busy || code.length !== 6} data-testid="button-otp-confirm">{busy ? "جارٍ التحقق..." : "تأكيد"}</Button>
          <Button variant="outline" onClick={() => pending && send(pending)} disabled={busy || cooldown > 0} data-testid="button-otp-resend">{cooldown > 0 ? `إعادة الإرسال (${cooldown})` : "إعادة إرسال الرمز"}</Button>
          <Button variant="ghost" onClick={onClose} data-testid="button-otp-cancel">إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
