// Kamera + QR okuma. getUserMedia ile arka kamera açılır, her karede jsQR
// ile QR aranır; bulununca pairFromQr çağrılır.

import { onCleanup, onMount, createSignal } from "solid-js";
import jsQR from "jsqr";
import { pairFromQr } from "../lib/session";
import { useT } from "../i18n";

export default function Scanner(props: { onBack: () => void }) {
  const t = useT();
  let video: HTMLVideoElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let raf = 0;
  let stream: MediaStream | null = null;
  let handled = false;
  const [error, setError] = createSignal<string | null>(null);

  const stop = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  const tick = () => {
    if (handled || !video || !canvas) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
        if (code && code.data) {
          handled = true;
          void pairFromQr(code.data).then((ok) => {
            if (!ok) {
              handled = false; // yanlış QR — taramaya devam
            } else {
              stop();
            }
          });
        }
      }
    }
    raf = requestAnimationFrame(tick);
  };

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      raf = requestAnimationFrame(tick);
    } catch (e) {
      setError(String(e));
    }
  });

  onCleanup(stop);

  return (
    <div class="relative flex h-full w-full flex-col items-center justify-center bg-surface-dark overflow-hidden">
      <video
        ref={video}
        playsinline
        muted
        class="absolute inset-0 h-full w-full object-cover"
      />
      <canvas ref={canvas} class="hidden" />

      {/* Target framing box */}
      <div class="pointer-events-none relative z-10 flex flex-col items-center gap-8">
        <div class="relative h-60 w-60">
          {/* Pulsing glow target outline */}
          <div class="h-full w-full rounded-[2.5rem] border-2 border-accent-colorful shadow-[0_0_0_9999px_rgba(10,10,10,0.65)] animate-pulse" />
          {/* Corner design accents */}
          <div class="absolute -top-1 -left-1 h-6 w-6 border-t-4 border-l-4 border-accent-colorful rounded-tl-xl" />
          <div class="absolute -top-1 -right-1 h-6 w-6 border-t-4 border-r-4 border-accent-colorful rounded-tr-xl" />
          <div class="absolute -bottom-1 -left-1 h-6 w-6 border-b-4 border-l-4 border-accent-colorful rounded-bl-xl" />
          <div class="absolute -bottom-1 -right-1 h-6 w-6 border-b-4 border-r-4 border-accent-colorful rounded-br-xl" />
        </div>
        <p class="text-[1rem] font-medium text-text bg-surface-dark/40 backdrop-blur-md px-4 py-2 rounded-full border border-border shadow-lg drop-shadow-md">
          {error() ? t("scanner.cameraError") : t("scanner.alignQr")}
        </p>
      </div>

      <button
        onClick={() => {
          stop();
          props.onBack();
        }}
        class="absolute left-6 top-12 z-20 rounded-full border border-border/40 bg-surface-dark/50 px-5 py-2.5 text-[0.9rem] font-medium text-text shadow-lg backdrop-blur-md transition-all duration-200 active:scale-95 hover:bg-surface-dark/70"
      >
        {t("scanner.back")}
      </button>

      {error() && (
        <div class="absolute bottom-12 z-10 mx-6 rounded-xl border border-danger/20 bg-danger/10 px-5 py-3 text-center text-[0.85rem] text-danger backdrop-blur-md shadow-lg max-w-[280px]">
          {error()}
        </div>
      )}
    </div>
  );
}
