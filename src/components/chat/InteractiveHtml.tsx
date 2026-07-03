// İnteraktif HTML yanıtları — modelin ürettiği ```html blokları sandbox'lı
// iframe'de canlı render edilir (Claude artifact benzeri).
//
// GÜVENLİK: iframe'e `allow-same-origin` VERİLMEZ. Snippet, uygulama
// origin'ine (Tauri IPC, localStorage) erişemez; yalnızca kendi izole
// belgesinde script çalıştırır. Yükseklik bildirimi postMessage ile yapılır
// ve kaynak (event.source) doğrulanır.
//
// Görünüm: çerçevesiz — kartın zemini uygulamanın zeminiyle aynı olduğundan
// içerik sohbete "gömülü" akar; kontroller (kod, yeniden çalıştır, büyüt,
// kopyala) yalnızca hover'da sağ üstte belirir. Yükseklik içeriğe göre
// otomatik büyür: uzun içerikte iç scrollbar birikmez.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, Copy, Play, RefreshCw, Maximize2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore } from "../../stores/settingsStore";

/**
 * Uygulamanın CANLI tema değişkenlerini okuyup iframe'e taşınacak tasarım
 * sistemi CSS'ini üretir. Model palet uydurmasın diye sistem promptu bu
 * değişken adlarını (--base, --surface, --accent…) referans verir; snippet
 * hiç stil vermese bile temel etiketler uygulamayla aynı görünür.
 */
function buildThemeCss(): string {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const isLight = document.documentElement.dataset.theme === "light";
  return `
:root{
  color-scheme:${isLight ? "light" : "dark"};
  --base:${v("--color-base", "#1a1a1a")};
  --surface:${v("--color-surface", "#222222")};
  --surface-2:${v("--color-surface-2", "#2d2d2d")};
  --surface-3:${v("--color-surface-3", "#3b3b3b")};
  --border:${v("--color-border", "rgba(255,255,255,0.07)")};
  --accent:${v("--color-accent", "#ffffff")};
  --accent-muted:${v("--color-accent-muted", "rgba(255,255,255,0.12)")};
  --text:${v("--color-text", "#f0eee6")};
  --text-secondary:${v("--color-text-secondary", "#b8b4a9")};
  --text-faint:${v("--color-text-faint", "#7d7a70")};
  --success:${v("--color-success", "#7ec488")};
  --warn:${v("--color-warn", "#e2b449")};
  --danger:${v("--color-danger", "#e77568")};
  --radius:${v("--radius", "8px")};
}
*{box-sizing:border-box}
body{margin:0;padding:2px 0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:14px;line-height:1.6;background:var(--base);color:var(--text);overflow:hidden}
h1,h2,h3,h4{color:var(--text);line-height:1.3;margin:0 0 .5em;font-weight:600}
h1{font-size:1.05rem}h2{font-size:.95rem}h3{font-size:.875rem}
p{color:var(--text-secondary);margin:.35em 0}
a{color:var(--text);text-decoration:underline;text-underline-offset:2px}
button{font:inherit;font-size:.8125rem;font-weight:500;padding:4px 11px;border-radius:var(--radius);
  cursor:pointer;background:var(--surface-2);color:var(--text-secondary);
  border:1px solid var(--border);transition:background .15s,color .15s}
button:hover{background:var(--surface-3);color:var(--text)}
input,textarea,select{font:inherit;font-size:.8571rem;padding:5px 9px;border-radius:var(--radius);
  background:var(--surface-2);color:var(--text);border:1px solid var(--border);outline:none}
input:focus,textarea:focus,select:focus{border-color:var(--text-faint)}
label{font-size:.8571rem}
table{border-collapse:collapse;width:100%;font-size:.8571rem}
th,td{padding:5px 9px;border:1px solid var(--border);text-align:left}
th{color:var(--text);background:var(--surface-2);font-weight:600}
code,pre{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.85em}
pre{background:var(--surface-2);padding:10px;border-radius:var(--radius);overflow:auto}
hr{border:none;border-top:1px solid var(--border);margin:12px 0}
::selection{background:var(--accent-muted)}
`;
}

/** İçerik yüksekliğini parent'a bildiren enjekte script. */
const HEIGHT_REPORTER = `<script>(function(){
  var send=function(){try{parent.postMessage({__axiomHtmlHeight:document.documentElement.scrollHeight},"*")}catch(e){}};
  try{new ResizeObserver(send).observe(document.body)}catch(e){setInterval(send,500)}
  window.addEventListener("load",send);send();
})();</script>`;

export function InteractiveHtml({ code }: { code: string }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const [runId, setRunId] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [height, setHeight] = useState(120);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Tema değişiminde iframe'i taze değişkenlerle yeniden kur
  const theme = useSettingsStore((s) => s.settings?.theme);

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><style>${buildThemeCss()}</style></head><body>${code}${HEIGHT_REPORTER}</body></html>`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, theme],
  );

  // Sandbox içinden gelen yükseklik bildirimi — yalnızca kendi iframe'imizden.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const h = (e.data as { __axiomHtmlHeight?: number })?.__axiomHtmlHeight;
      if (typeof h === "number" && h > 0) {
        setHeight(Math.min(Math.max(Math.ceil(h), 60), 4000));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const controls = (
    <div className={`absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-lg bg-surface/95 px-1 py-0.5 shadow-md transition-opacity ${fullscreen ? "opacity-100" : "opacity-0 group-hover/ihtml:opacity-100"}`}>
      <button
        onClick={() => setView(view === "preview" ? "code" : "preview")}
        className="flex items-center gap-1 rounded-md px-1.5 py-0 text-[0.7143rem] text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
        title={view === "preview" ? "Kodu göster" : "Önizlemeye dön"}
      >
        {view === "preview" ? <Code2 size={12} /> : <Play size={12} />}
        {view === "preview" ? "Kod" : "Önizle"}
      </button>
      {view === "preview" && (
        <button
          onClick={() => setRunId((n) => n + 1)}
          className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
          title="Yeniden çalıştır"
        >
          <RefreshCw size={12} />
        </button>
      )}
      <button
        onClick={() => setFullscreen((f) => !f)}
        className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
        title={fullscreen ? "Kapat" : "Büyüt"}
      >
        {fullscreen ? <X size={12} /> : <Maximize2 size={12} />}
      </button>
      <button
        onClick={copy}
        className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
        title="Kodu kopyala"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );

  const body =
    view === "preview" ? (
      <iframe
        key={`${runId}-${fullscreen ? "fs" : "inline"}`}
        ref={iframeRef}
        sandbox="allow-scripts allow-forms allow-modals"
        srcDoc={srcDoc}
        title="İnteraktif yanıt"
        className="w-full border-0"
        style={{ height: fullscreen ? "100%" : height, display: "block" }}
      />
    ) : (
      <pre
        className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-[0.7857rem] leading-relaxed text-text-secondary"
        style={{ maxHeight: fullscreen ? "100%" : 480, overflowY: "auto", userSelect: "text" }}
      >
        {code}
      </pre>
    );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-6" onClick={() => setFullscreen(false)}>
        <div
          className="group/ihtml relative max-h-[75vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-base shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {controls}
          <div className="max-h-[75vh] overflow-y-auto p-2">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/ihtml not-prose relative my-1">
      {controls}
      {body}
    </div>
  );
}

/**
 * Streaming sırasında ham HTML kodu yerine gösterilen "tasarlanıyor" bloğu —
 * kod yazım süreci kullanıcıya sızmaz, dönüşümlü durum mesajları akar.
 */
const DESIGN_STAGES = [
  "Arayüz tasarlanıyor…",
  "Bileşenler yerleştiriliyor…",
  "Etkileşimler bağlanıyor…",
  "Tema uygulanıyor…",
  "Son rötuşlar yapılıyor…",
];

export function DesigningIndicator() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setStage((s) => Math.min(s + 1, DESIGN_STAGES.length - 1)),
      1800,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="not-prose my-2 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <img src="/logo.svg" alt="Axiom" title={DESIGN_STAGES[stage]} width={15} height={15} />
      <AnimatePresence mode="wait">
        <motion.span
          key={stage}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="text-[0.8571rem] text-text-secondary"
        >
          {DESIGN_STAGES[stage]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** React düğüm ağacından düz metni toplar (rehype-highlight span'ları dahil). */
export function extractNodeText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    return extractNodeText((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

/**
 * Streaming metnini böler: ```html bloğu başladıysa (yarım ya da tam) kod
 * kısmı gizlenir — öncesi normal markdown akar, kod yerine DesigningIndicator
 * gösterilir. Blok kapandıktan SONRA gelen metin de akmaya devam eder.
 */
export function splitStreamingHtml(text: string): { before: string; designing: boolean; after: string } {
  const start = text.search(/```html\b/);
  if (start === -1) return { before: text, designing: false, after: "" };
  const before = text.slice(0, start).trimEnd();
  const closeIdx = text.indexOf("```", start + 6);
  const after = closeIdx === -1 ? "" : text.slice(closeIdx + 3);
  return { before, designing: true, after };
}
