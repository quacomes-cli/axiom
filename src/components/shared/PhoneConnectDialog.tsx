// Telefon bağla — compact açılır popover (modal DEĞİL). TitleMenu gibi sol-üst
// köşeden açılır; QR + altında "yeniden oluştur". Dışına tıklayınca/Esc kapanır.

import { AnimatePresence, motion } from "framer-motion";
import { X, Smartphone, Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useUiStore } from "../../stores/uiStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useT } from "../../i18n";

export function PhoneConnectDialog() {
  const t = useT();
  const open = useUiStore((s) => s.phoneConnectOpen);
  const setOpen = useUiStore((s) => s.setPhoneConnectOpen);
  const status = useRemoteStore((s) => s.status);
  const qrPayload = useRemoteStore((s) => s.qrPayload);
  const deviceName = useRemoteStore((s) => s.deviceName);
  const startPairing = useRemoteStore((s) => s.startPairing);
  const stopPairing = useRemoteStore((s) => s.stopPairing);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Açılınca eşleştirmeyi başlat, kapanınca durdur.
  useEffect(() => {
    if (open) void startPairing();
    else stopPairing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // QR payload değişince görüntü üret.
  useEffect(() => {
    if (!qrPayload) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(qrPayload, {
      width: 320,
      margin: 1,
      color: { dark: "#0a0a0a", light: "#f0eee6" },
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [qrPayload]);

  // Dışına tıklama + Esc ile kapat.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const id = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const paired = status === "paired";
  const connecting = status === "connecting" || status === "verifying";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="fixed left-2 top-[44px] z-[9997] w-[216px] rounded-xl border border-border bg-surface-2 p-2.5 shadow-2xl"
          style={{ transformOrigin: "top left" }}
        >
          {/* Başlık */}
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <Smartphone size={15} strokeWidth={1.6} className="text-text-secondary" />
            <span className="text-[0.8214rem] font-medium text-text">{t("phoneConnect.title")}</span>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text-secondary"
            >
              <X size={13} strokeWidth={1.6} />
            </button>
          </div>

          {/* QR / durum */}
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg bg-surface p-2">
            {paired ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-success/40 bg-success/10 text-success">
                  <Check size={22} strokeWidth={1.8} />
                </div>
                <p className="text-center text-[0.8214rem] text-text">
                  {deviceName
                    ? t("phoneConnect.deviceConnected", { name: deviceName })
                    : t("phoneConnect.paired")}
                </p>
              </div>
            ) : status === "error" ? (
              <div className="flex flex-col items-center gap-1 py-8 text-center">
                <p className="text-[0.7857rem] text-danger">{t("phoneConnect.error")}</p>
              </div>
            ) : qrDataUrl ? (
              <div className="relative">
                <img
                  src={qrDataUrl}
                  alt="QR"
                  className="rounded-lg"
                  style={{ width: 168, height: 168 }}
                />
                {connecting && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface-2/80">
                    <Loader2 size={22} className="animate-spin text-text-secondary" />
                  </div>
                )}
              </div>
            ) : (
              <Loader2 size={22} className="animate-spin text-text-faint" />
            )}
          </div>

          {/* Alt: durum ipucu + yeniden oluştur */}
          {!paired && (
            <div className="mt-2 flex flex-col items-center gap-1.5">
              <p className="text-center text-[0.6875rem] text-text-faint">
                {status === "error"
                  ? ""
                  : connecting
                    ? t("phoneConnect.connecting")
                    : t("phoneConnect.instructions")}
              </p>
              <button
                onClick={() => void startPairing()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-hover py-1.5 text-[0.7857rem] text-text-secondary hover:bg-surface-3"
              >
                <RefreshCw size={12} strokeWidth={1.7} />
                {t("phoneConnect.regenerate")}
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
