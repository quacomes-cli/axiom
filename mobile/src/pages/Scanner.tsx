// Kamera + QR okuma. getUserMedia ile arka kamera açılır, her karede jsQR
// ile QR aranır; bulununca pairFromQr çağrılır.

import { onCleanup, onMount, createSignal } from "solid-js";
import jsQR from "jsqr";
import { pairFromQr } from "../lib/session";

export default function Scanner(props: { onBack: () => void }) {
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
    <div class="relative flex h-full w-full flex-col items-center justify-center bg-surface-dark">
      <video
        ref={video}
        playsinline
        muted
        class="absolute inset-0 h-full w-full object-cover"
      />
      <canvas ref={canvas} class="hidden" />

      {/* Hedefleme çerçevesi */}
      <div class="pointer-events-none relative z-10 flex flex-col items-center gap-6">
        <div class="h-56 w-56 rounded-3xl border-2 border-text/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
        <p class="text-[0.95rem] text-text drop-shadow">
          {error() ? "Kameraya erişilemedi" : "QR kodu çerçeveye hizala"}
        </p>
      </div>

      <button
        onClick={() => {
          stop();
          props.onBack();
        }}
        class="absolute left-4 top-4 z-10 rounded-full bg-black/40 px-4 py-2 text-[0.9rem] text-white backdrop-blur"
      >
        Geri
      </button>

      {error() && (
        <p class="absolute bottom-8 z-10 px-6 text-center text-[0.8rem] text-danger">
          {error()}
        </p>
      )}
    </div>
  );
}
