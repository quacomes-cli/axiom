// Telefon bağla — QR eşleştirme diyaloğu. AboutDialog desenini izler.
// Açılınca rtcHost oturumu başlar, QR üretilir; telefon okutunca durum akar.

import { motion } from "framer-motion";
import { X, Smartphone, Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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

  // Diyalog açılınca eşleştirmeyi başlat, kapanınca durdur.
  useEffect(() => {
    if (open) void startPairing();
    else stopPairing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // QR payload değişince görüntüyü üret.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const paired = status === "paired";
  const connecting = status === "connecting" || status === "verifying";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2.5px)" }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[360px] rounded-2xl border border-border bg-surface-2 p-6 text-center shadow-2xl"
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text-secondary"
        >
          <X size={15} strokeWidth={1.6} />
        </button>

        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-3 text-text-secondary">
          <Smartphone size={20} strokeWidth={1.6} />
        </div>
        <p className="text-base font-medium text-text">{t("phoneConnect.title")}</p>
        <p className="mt-1 text-[0.8571rem] text-text-faint">{t("phoneConnect.instructions")}</p>

        {/* QR / durum alanı */}
        <div className="mt-5 flex min-h-[220px] flex-col items-center justify-center">
          {paired ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-success/40 bg-success/10 text-success">
                <Check size={28} strokeWidth={1.8} />
              </div>
              <p className="text-[0.9286rem] text-text">
                {deviceName
                  ? t("phoneConnect.deviceConnected", { name: deviceName })
                  : t("phoneConnect.paired")}
              </p>
            </div>
          ) : status === "error" ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[0.8571rem] text-danger">{t("phoneConnect.error")}</p>
              <button
                onClick={() => void startPairing()}
                className="flex items-center gap-1.5 rounded-lg border border-border-hover px-3 py-1.5 text-[0.8571rem] text-text-secondary hover:bg-surface-3"
              >
                <RefreshCw size={13} /> {t("phoneConnect.retry")}
              </button>
            </div>
          ) : qrDataUrl ? (
            <div className="relative">
              <img
                src={qrDataUrl}
                alt="QR"
                className="rounded-xl border border-border"
                style={{ width: 220, height: 220 }}
              />
              {connecting && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface-2/80">
                  <Loader2 size={26} className="animate-spin text-text-secondary" />
                </div>
              )}
            </div>
          ) : (
            <Loader2 size={26} className="animate-spin text-text-faint" />
          )}
        </div>

        {!paired && status !== "error" && (
          <p className="mt-4 text-[0.75rem] text-text-faint">
            {connecting ? t("phoneConnect.connecting") : t("phoneConnect.waiting")}
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
