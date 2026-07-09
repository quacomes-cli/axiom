// Sesli mod ikonu — el yazımı SVG. Kapsayıcıda `voice-mode-btn` sınıfı varsa
// hover'da (veya `.active` iken sürekli) çubuklar dalga animasyonu yapar
// (styles/index.css: .voice-wave-bar + @keyframes voice-wave).

const BARS = [
  { x: 3, h: 8, delay: 0 },
  { x: 7.5, h: 14, delay: 0.12 },
  { x: 12, h: 18, delay: 0.24 },
  { x: 16.5, h: 12, delay: 0.36 },
  { x: 21, h: 7, delay: 0.48 },
];

export function VoiceWaveIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {BARS.map((b, i) => (
        <rect
          key={i}
          x={b.x - 1}
          y={12 - b.h / 2}
          width={2}
          height={b.h}
          rx={1}
          fill="currentColor"
          className="voice-wave-bar"
          style={{ animationDelay: `${b.delay}s` }}
        />
      ))}
    </svg>
  );
}
