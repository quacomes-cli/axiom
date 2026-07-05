// Telefon bağla — TitleMenu'nün sağına açılan flyout paneli (submenu).
// Konumlandırmayı ebeveyn (TitleMenu) yapar; burası yalnızca içerik + eşleşme
// yaşam döngüsü. Mount'ta eşleştirme başlar, unmount'ta durur.

import { X, Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useRemoteStore } from "../../stores/remoteStore";
import { useT } from "../../i18n";

export function PhoneConnectPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const status = useRemoteStore((s) => s.status);
  const qrPayload = useRemoteStore((s) => s.qrPayload);
  const deviceName = useRemoteStore((s) => s.deviceName);
  const startPairing = useRemoteStore((s) => s.startPairing);
  const stopPairing = useRemoteStore((s) => s.stopPairing);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Panel açıkken eşleştir; kapanınca durdur.
  useEffect(() => {
    void startPairing();
    return () => stopPairing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!qrPayload) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(qrPayload, {
      width: 320,
      margin: 2,
      color: { dark: "#0a0a0a", light: "#f0eee6" },
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [qrPayload]);

  const paired = status === "paired";
  const connecting = status === "connecting" || status === "verifying";

  return (
    <div className="w-[196px] rounded-xl border border-border bg-surface-2 p-2 shadow-2xl">
      {/* Başlık */}
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <span className="text-[0.8214rem] font-medium text-text">{t("phoneConnect.title")}</span>
        <button
          onClick={onClose}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text-secondary"
        >
          <X size={13} strokeWidth={1.6} />
        </button>
      </div>

      {/* QR / durum */}
      <div className="flex flex-col items-center">
        {paired ? (
          <div className="flex flex-col items-center gap-2 py-7">
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
          <p className="py-10 text-center text-[0.7857rem] text-danger">
            {t("phoneConnect.error")}
          </p>
        ) : qrDataUrl ? (
          <div className="relative">
            <img src={qrDataUrl} alt="QR" className="block rounded-lg" style={{ width: 180, height: 180 }} />
            {connecting && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface-2/80">
                <Loader2 size={22} className="animate-spin text-text-secondary" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-[180px] items-center justify-center">
            <Loader2 size={22} className="animate-spin text-text-faint" />
          </div>
        )}
      </div>

      {/* Alt: ipucu + yeniden oluştur */}
      {!paired && (
        <div className="mt-1.5 flex flex-col items-center gap-1.5">
          <p className="text-center text-[0.6875rem] leading-tight text-text-faint">
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
    </div>
  );
}
