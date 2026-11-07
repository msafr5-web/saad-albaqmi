import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, Keyboard, Nfc, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** What the scanner reads: a card payload (SQ1.… / ST1.…) or a room tag (RM1.…). */
const KNOWN = /^(SQ1|ST1|RM1)\./;

type NdefReaderLike = { scan: () => Promise<void>; onreading: ((e: { message: { records: { recordType: string; data?: DataView }[] } }) => void) | null; abort?: () => void };
type NdefCtor = new () => NdefReaderLike & { signal?: unknown };
const ndef = (): NdefCtor | undefined => (typeof window !== "undefined" ? (window as unknown as { NDEFReader?: NdefCtor }).NDEFReader : undefined);
const hasCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/**
 * "Bring the card close" sheet, in the spirit of NFC Tools: three ways to read a code on any phone —
 *   NFC (Chrome on Android), camera QR (every phone, including iPhone) and typing the code (fallback).
 * It only decodes; the server verifies signature, expiry, status and permissions.
 */
export function ScanSheet({ open, title, hint, onClose, onCode }: { open: boolean; title: string; hint: string; onClose: () => void; onCode: (code: string) => void }) {
  const [mode, setMode] = useState<"camera" | "nfc" | "manual">(hasCamera() ? "camera" : ndef() ? "nfc" : "manual");
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef({ code: "", at: 0 });

  const emit = useCallback((raw: string) => {
    const code = raw.trim();
    if (!KNOWN.test(code)) return;
    const now = Date.now();
    if (lastRef.current.code === code && now - lastRef.current.at < 3000) return;       // one physical tap must not count twice
    lastRef.current = { code, at: now };
    if (navigator.vibrate) navigator.vibrate(60);
    onCode(code);
  }, [onCode]);

  useEffect(() => { if (open) { setError(null); setManual(""); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-md" dir="rtl">
        <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">{title}</DialogTitle><DialogDescription>{hint}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted p-1 text-xs">
          {([["camera", "كاميرا QR", Camera, hasCamera()], ["nfc", "قراءة NFC", Nfc, !!ndef()], ["manual", "إدخال الرمز", Keyboard, true]] as const).map(([k, label, Icon, ok]) => (
            <button key={k} type="button" disabled={!ok} onClick={() => { setMode(k); setError(null); }} data-testid={`scan-mode-${k}`}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition-colors disabled:opacity-40 ${mode === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}><Icon className="h-3.5 w-3.5" />{label}</button>
          ))}
        </div>
        {mode === "camera" && <CameraScan onCode={emit} onError={setError} />}
        {mode === "nfc" && <NfcScan onCode={emit} onError={setError} />}
        {mode === "manual" && (
          <div className="space-y-3">
            <Input dir="ltr" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="SQ1.… أو ST1.…" data-testid="input-scan-manual" />
            <Button className="w-full" disabled={!KNOWN.test(manual.trim())} onClick={() => { emit(manual); setManual(""); }} data-testid="button-scan-manual">تأكيد الرمز</Button>
          </div>
        )}
        {error && <p className="text-center text-sm text-destructive" data-testid="text-scan-error">{error}</p>}
        <Button variant="outline" className="gap-1.5" onClick={onClose}><X className="h-4 w-4" /> إغلاق</Button>
      </DialogContent>
    </Dialog>
  );
}

function CameraScan({ onCode, onError }: { onCode: (c: string) => void; onError: (m: string | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null; let raf = 0; let stopped = false; let last = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream; await video.current.play(); onError(null);
        const tick = (t: number) => {
          raf = requestAnimationFrame(tick);
          const v = video.current, c = canvas.current;
          if (!v || !c || v.readyState < 2 || t - last < 120) return;                // ~8 frames per second is plenty for QR
          last = t; c.width = v.videoWidth; c.height = v.videoHeight;
          const ctx = c.getContext("2d", { willReadFrequently: true }); if (!ctx) return;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (hit?.data) onCode(hit.data);
        };
        raf = requestAnimationFrame(tick);
      } catch { onError("تعذر تشغيل الكاميرا. اسمح بالوصول إليها من إعدادات المتصفح أو استخدم الإدخال اليدوي."); }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode, onError]);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black" data-testid="camera-view">
      <video ref={video} playsInline muted className="aspect-square w-full object-cover" />
      <canvas ref={canvas} className="hidden" />
      <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.45)]" />
    </div>
  );
}

function NfcScan({ onCode, onError }: { onCode: (c: string) => void; onError: (m: string | null) => void }) {
  const [state, setState] = useState<"idle" | "listening">("idle");
  useEffect(() => () => { /* the reader stops when the page is left */ }, []);
  const start = async () => {
    const Ctor = ndef(); if (!Ctor) return onError("هذا الجهاز لا يدعم قراءة NFC من المتصفح (يلزم Chrome على Android).");
    try {
      const reader = new Ctor();
      await reader.scan(); setState("listening"); onError(null);
      reader.onreading = (e) => {
        for (const r of e.message.records) if ((r.recordType === "text" || r.recordType === "url") && r.data) {
          const text = new TextDecoder(r.recordType === "text" ? undefined : "utf-8").decode(r.data.buffer.slice(r.data.byteOffset + (r.recordType === "text" ? 1 + (r.data.getUint8(0) & 0x3f) : 0), r.data.byteOffset + r.data.byteLength));
          onCode(text.trim());
        }
      };
    } catch { onError("لم يُسمح بـ NFC. فعّله في الجهاز واسمح للصفحة بالوصول."); }
  };
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <div className={`flex h-28 w-28 items-center justify-center rounded-full bg-secondary ${state === "listening" ? "animate-pulse" : ""}`}><Nfc className="h-12 w-12 text-primary" /></div>
      <p className="text-sm text-muted-foreground">{state === "listening" ? "قرّب البطاقة أو الوسم من ظهر الجهاز" : "اضغط للبدء ثم قرّب البطاقة من ظهر الجهاز"}</p>
      {state === "idle" && <Button onClick={start} data-testid="button-nfc-start">بدء القراءة</Button>}
    </div>
  );
}
