// Sesli sohbet parçacık görseli — canvas 2D.
//
// Merkeze doğru yoğunlaşan noktalar: dışa uzaklaştıkça küçülür, solar ve
// halo katmanıyla "bulanıklaşır". Yakın noktalar ince çizgilerle bağlanır
// (constellation). Renk: AI konuşurken MAVİ, kullanıcı konuşurken BEYAZ —
// geçişler her frame RGB lerp ile yumuşak.
//
// Ses tepkisi:
//   - AI sesi Rust'ta çalar → "tts-level" event'i {level, bands[4]} besler.
//   - Kullanıcı konuşması → WebAudio AnalyserNode (mikrofon FFT'si) besler.
//   - Kaynak yoksa (fallback TTS vb.) faza göre sentetik nabız üretilir.
// bands[i] i'inci yarıçap kuşağını iter — spektrum halka halka görünür.

import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { VoicePhase } from "../../hooks/useVoiceConversation";

const N = 90;
const CANVAS = 380; // css px (dpr ile ölçeklenir)
const MAX_R = 150;
const LINK_DIST = 46;

const COLOR_AI: [number, number, number] = [96, 156, 255]; // mavi
const COLOR_USER: [number, number, number] = [242, 242, 246]; // beyaz
const COLOR_IDLE: [number, number, number] = [168, 168, 178]; // soluk nötr

interface Particle {
  angle: number;
  baseR: number;
  size: number;
  spin: number; // açısal hız (iç halkalar hızlı)
  wobble: number; // radyal salınım fazı
  band: number; // 0..3 — hangi spektrum kuşağı iter
}

export function VoiceParticles({ phase }: { phase: VoicePhase }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS * dpr;
    canvas.height = CANVAS * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    // Parçacıklar: merkez-yoğun dağılım (pow eğrisi dışa seyrekleşir).
    const parts: Particle[] = Array.from({ length: N }, () => {
      const r = MAX_R * Math.pow(Math.random(), 1.7);
      return {
        angle: Math.random() * Math.PI * 2,
        baseR: r,
        size: 1.0 + 2.6 * (1 - r / MAX_R),
        spin: (0.0018 + 0.004 * (1 - r / MAX_R)) * (Math.random() < 0.5 ? -1 : 1),
        wobble: Math.random() * Math.PI * 2,
        band: Math.min(3, Math.floor((r / MAX_R) * 4)),
      };
    });

    // --- Ses kaynakları -------------------------------------------------------
    let level = 0; // yumuşatılmış anlık düzey
    let bands = [0, 0, 0, 0];
    let targetLevel = 0;
    let targetBands = [0, 0, 0, 0];
    let lastFeedAt = 0;

    let unlistenTts: UnlistenFn | null = null;
    void listen<{ level: number; bands: number[] }>("tts-level", (e) => {
      targetLevel = e.payload.level;
      targetBands = e.payload.bands;
      lastFeedAt = performance.now();
    }).then((u) => {
      unlistenTts = u;
    });

    // Mikrofon FFT — kullanıcı konuşurken gerçek spektrum.
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let micStream: MediaStream | null = null;
    void (async () => {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioCtx = new AudioContext();
        const src = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.55;
        src.connect(analyser);
      } catch {
        /* mikrofon analizi yoksa sentetik nabız devrede */
      }
    })();
    const fft = new Uint8Array(128);

    const readMic = () => {
      if (!analyser) return false;
      analyser.getByteFrequencyData(fft);
      // 128 bin → 4 kuşak (konuşma bandı ağırlıklı alt yarı).
      const groups = [
        [1, 6],
        [6, 16],
        [16, 36],
        [36, 72],
      ];
      let sum = 0;
      targetBands = groups.map(([a, b]) => {
        let acc = 0;
        for (let i = a; i < b; i++) acc += fft[i];
        const v = acc / (b - a) / 255;
        sum += v;
        return Math.min(1, v * 1.6);
      });
      targetLevel = Math.min(1, (sum / 4) * 1.8);
      lastFeedAt = performance.now();
      return true;
    };

    // --- Renk -----------------------------------------------------------------
    let color: [number, number, number] = [...COLOR_IDLE];

    const targetColor = (): [number, number, number] => {
      const p = phaseRef.current;
      if (p === "responding" || p === "speaking") return COLOR_AI;
      if (p === "hearing") return COLOR_USER;
      return COLOR_IDLE;
    };

    // --- Çizim döngüsü ----------------------------------------------------------
    let raf = 0;
    let t = 0;
    const cx = CANVAS / 2;
    const cy = CANVAS / 2;

    const frame = () => {
      t += 1 / 60;
      const p = phaseRef.current;

      // Kaynak seçimi: kullanıcı konuşuyor → mic FFT; AI → tts-level;
      // 300ms'dir veri yoksa ama konuşma fazındaysak sentetik nabız.
      if (p === "hearing" || p === "listening") {
        readMic();
      }
      const stale = performance.now() - lastFeedAt > 300;
      if (stale) {
        if (p === "responding" || p === "speaking") {
          // Fallback TTS (tarayıcı sesi) — inandırıcı sentetik konuşma ritmi.
          targetLevel = 0.35 + 0.25 * Math.abs(Math.sin(t * 6.3)) * Math.abs(Math.sin(t * 1.7));
          targetBands = [0, 1, 2, 3].map(
            (i) => 0.25 + 0.3 * Math.abs(Math.sin(t * (4.1 + i * 1.3) + i)),
          );
        } else if (p !== "hearing") {
          targetLevel = 0.06 + 0.04 * Math.sin(t * 1.2); // sakin nefes
          targetBands = [0.05, 0.05, 0.05, 0.05];
        }
      }

      // Yumuşatma: atak hızlı, bırakma yavaş (ses canlı hissettirsin).
      const upA = 0.35;
      const downA = 0.08;
      level += (targetLevel - level) * (targetLevel > level ? upA : downA);
      bands = bands.map((b, i) => {
        const tb = targetBands[i] ?? 0;
        return b + (tb - b) * (tb > b ? upA : downA);
      });

      // Renk lerp — yumuşak mavi↔beyaz geçişi.
      const tc = targetColor();
      color = color.map((c, i) => c + (tc[i] - c) * 0.055) as [number, number, number];
      const [cr, cg, cb] = color.map(Math.round);

      ctx.clearRect(0, 0, CANVAS, CANVAS);

      // Konumları hesapla.
      const pos: { x: number; y: number; a: number; s: number }[] = new Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        const pt = parts[i];
        pt.angle += pt.spin * (1 + level * 2.2);
        const push = 1 + 0.22 * level + 0.4 * bands[pt.band] * (0.4 + pt.baseR / MAX_R);
        const wob = 1 + 0.05 * Math.sin(t * 2.4 + pt.wobble);
        const r = pt.baseR * push * wob;
        const rn = Math.min(1, r / MAX_R);
        pos[i] = {
          x: cx + Math.cos(pt.angle) * r,
          y: cy + Math.sin(pt.angle) * r,
          // Dışa doğru solma — "bulanıklaşma"nın alpha bileşeni.
          a: Math.pow(1 - rn, 1.5) * 0.85 + 0.08,
          s: pt.size * (1 - 0.55 * rn) * (1 + 0.5 * level),
        };
      }

      // Bağlantılar (noktalar birbirine bağlı) — ses arttıkça belirginleşir.
      ctx.lineWidth = 0.6;
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const dx = pos[i].x - pos[j].x;
          const dy = pos[i].y - pos[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK_DIST * LINK_DIST) continue;
          const d = Math.sqrt(d2);
          const la =
            (1 - d / LINK_DIST) * 0.22 * Math.min(pos[i].a, pos[j].a) * (0.5 + level);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${la.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(pos[i].x, pos[i].y);
          ctx.lineTo(pos[j].x, pos[j].y);
          ctx.stroke();
        }
      }

      // Noktalar: halo (bulanıklık hissi) + çekirdek.
      for (const q of pos) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(q.a * 0.16).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.s * 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${cr},${cg},${cb},${q.a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.s, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      if (unlistenTts) unlistenTts();
      micStream?.getTracks().forEach((tr) => tr.stop());
      void audioCtx?.close();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: CANVAS, height: CANVAS }}
      className="pointer-events-none"
    />
  );
}
