import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Nfc } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Payment-card proportions (ISO 7810 ID-1, 85.60 x 53.98 mm). */
const RATIO = 85.6 / 53.98;
const SPECTRUM = ["#e5389b", "#d9482b", "#f08a24", "#f3c623", "#4f9b34"];

export type CardData = {
  number: string; holderName: string; holderNumber: string; label: string; qr: string; secondsLeft: number; stepSeconds: number; status: string;
};

function useQrImage(text: string) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#0e100f", light: "#ffffff" } }).then((u) => { if (live) setSrc(u); }).catch(() => { if (live) setSrc(""); });
    return () => { live = false; };
  }, [text]);
  return src;
}

/** Circular countdown around the QR code: the code is valid for ~30 seconds, so a screenshot is useless. */
function Countdown({ left, total }: { left: number; total: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90" aria-label={`يتجدد الرمز خلال ${left} ثانية`}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="3" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="#f3c623" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, left) / total)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      <text x="18" y="18" textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#fff" transform="rotate(90 18 18)">{left}</text>
    </svg>
  );
}

const face = "absolute inset-0 overflow-hidden rounded-[22px] shadow-[0_18px_28px_-10px_rgba(14,16,15,.45)] [backface-visibility:hidden] [-webkit-backface-visibility:hidden]";

/**
 * The digital card, drawn like a bank card: chip, contactless mark, grouped number, holder name. Tap to flip to the back,
 * which shows the rotating QR code. Respects reduced-motion (no flip animation, instant swap).
 */
export function IdCard({ data, flipped, onFlip }: { data: CardData; flipped: boolean; onFlip: () => void }) {
  const qr = useQrImage(data.qr);
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const revoked = data.status !== "active";
  return (
    <div className="mx-auto w-full max-w-[420px]" style={{ perspective: 1400 }}>
      <button type="button" onClick={onFlip} aria-label={flipped ? "إظهار وجه البطاقة" : "إظهار رمز QR"} data-testid="button-flip-card"
        className="relative block w-full text-right outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" style={{ aspectRatio: String(RATIO), transformStyle: "preserve-3d", transition: reduce ? "none" : "transform 700ms cubic-bezier(.2,.7,.2,1)", transform: flipped ? "rotateY(180deg)" : "none" }}>   {/* no CSS filter here: it would flatten the 3D flip */}
        {/* front */}
        <div className={face} style={{ background: "linear-gradient(135deg,#0e100f 0%,#1d2a31 55%,#2b3d47 100%)", color: "#fff", visibility: reduce && flipped ? "hidden" : "visible" }} data-testid="card-front">
          <div className="absolute inset-x-0 top-0 h-1.5 flex">{SPECTRUM.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}</div>
          <div className="girih absolute inset-0 opacity-[.12]" />
          <div className="absolute inset-0 flex flex-col justify-between p-5 sm:p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5"><img src={`${basePath}/logo-mark.svg`} alt="" className="h-8 w-8" /><div className="leading-tight"><div className="font-display text-[13px]">صرح د. سعد البقمي</div><div className="text-[10px] text-white/55">بطاقة {data.label} الرقمية</div></div></div>
              <Nfc className="h-7 w-7 text-white/80" aria-hidden />
            </div>
            <div className="flex items-center gap-3">
              {/* EMV-style chip */}
              <svg viewBox="0 0 48 36" className="h-9 w-12" aria-hidden><rect x="1" y="1" width="46" height="34" rx="6" fill="#d9b45f" stroke="#a8872f" /><path d="M1 12h14M1 24h14M33 12h14M33 24h14M15 1v34M33 1v34M15 18h18" stroke="#a8872f" strokeWidth="1.2" fill="none" /><rect x="15" y="9" width="18" height="18" rx="3" fill="#e8c978" stroke="#a8872f" /></svg>
              <span className="text-[11px] tracking-wide text-white/60">اضغط لإظهار الرمز</span>
            </div>
            <div>
              <div className="num mb-2 text-[20px] font-medium tracking-[.16em] sm:text-[22px]" dir="ltr" style={{ textShadow: "0 1px 0 rgba(0,0,0,.4)" }} data-testid="text-card-number">{data.number}</div>
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0"><div className="text-[9px] uppercase tracking-widest text-white/45">حامل البطاقة</div><div className="truncate font-display text-[17px] sm:text-[19px]" data-testid="text-card-holder">{data.holderName}</div></div>
                <div className="shrink-0 text-left"><div className="text-[9px] uppercase tracking-widest text-white/45">الرقم</div><div className="num text-[13px]" dir="ltr">{data.holderNumber}</div></div>
              </div>
            </div>
          </div>
          {revoked && <div className="absolute inset-0 flex items-center justify-center bg-black/70 font-display text-xl">البطاقة موقوفة</div>}
        </div>
        {/* back */}
        <div className={face} style={{ transform: "rotateY(180deg)", background: "linear-gradient(135deg,#2b3d47 0%,#1d2a31 60%,#0e100f 100%)", color: "#fff", visibility: reduce && !flipped ? "hidden" : "visible" }} data-testid="card-back">
          <div className="absolute inset-x-0 top-5 h-9 bg-black/70" />
          <div className="absolute inset-0 flex flex-col items-center justify-end gap-2 p-4 pt-16">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-1.5">{qr ? <img src={qr} alt="رمز QR للبطاقة" className="h-[124px] w-[124px] sm:h-[148px] sm:w-[148px]" data-testid="img-card-qr" /> : <div className="h-[124px] w-[124px] animate-pulse rounded bg-muted sm:h-[148px] sm:w-[148px]" />}</div>
              <div className="flex flex-col items-center gap-1.5"><Countdown left={data.secondsLeft} total={data.stepSeconds} /><span className="max-w-[88px] text-center text-[10px] leading-4 text-white/60">يتجدد تلقائيًا؛ لا تشاركه</span></div>
            </div>
            <div className="text-[10px] text-white/45">قدّم الرمز للمدرب أو المنسق عند الدخول</div>
          </div>
        </div>
      </button>
    </div>
  );
}
