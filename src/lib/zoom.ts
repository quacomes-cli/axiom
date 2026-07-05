// Uygulama geneli yakınlaştırma — WebView2 (Chromium) CSS `zoom` özelliğini
// kök elemana uygular. Ayar localStorage'da tutulur, açılışta geri yüklenir.

const KEY = "axiom-zoom";
const MIN = 50;
const MAX = 200;
const STEP = 10;

export function getZoom(): number {
  const raw = Number(localStorage.getItem(KEY));
  if (!raw || Number.isNaN(raw)) return 100;
  return Math.min(MAX, Math.max(MIN, raw));
}

export function setZoom(pct: number): number {
  const clamped = Math.min(MAX, Math.max(MIN, Math.round(pct)));
  localStorage.setItem(KEY, String(clamped));
  document.documentElement.style.zoom = String(clamped / 100);
  return clamped;
}

export function stepZoom(delta: number): number {
  return setZoom(getZoom() + delta * STEP);
}

export function applySavedZoom(): void {
  setZoom(getZoom());
}
