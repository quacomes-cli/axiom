// İnteraktif HTML yanıt kartı — modelin ürettiği ```html blokları sandbox'lı
// iframe'de canlı render edilir (Claude artifact benzeri).
//
// GÜVENLİK: iframe'e `allow-same-origin` VERİLMEZ. Böylece snippet, uygulama
// origin'ine (dolayısıyla Tauri IPC köprüsüne, localStorage'a) erişemez;
// yalnızca kendi izole belgesinde script çalıştırabilir. Harici ağ istekleri
// CSP ile değil sandbox origin'sizliğiyle sınırlıdır — model zaten
// self-contained üretmeye yönlendirilir (sistem promptu).

import { useMemo, useState } from "react";
import { Check, Code2, Copy, Play, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";

/**
 * Uygulamanın CANLI tema değişkenlerini okuyup iframe'e taşınacak tasarım
 * sistemi CSS'ini üretir. Model palet uydurmasın diye sistem promptu bu
 * değişken adlarını (--base, --surface, --accent…) referans verir; snippet
 * hiç stil vermese bile temel etiketler (buton, input, başlık, tablo)
 * uygulamayla aynı görünür. Tema değişince yeniden hesaplanır.
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
body{margin:0;padding:16px;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:14px;line-height:1.6;background:var(--base);color:var(--text)}
h1,h2,h3,h4{color:var(--text);line-height:1.3;margin:0 0 .5em}
h1{font-size:1.25rem}h2{font-size:1.1rem}h3{font-size:1rem}
p{color:var(--text-secondary);margin:.4em 0}
a{color:var(--text);text-decoration:underline;text-underline-offset:2px}
button{font:inherit;padding:6px 14px;border-radius:var(--radius);cursor:pointer;
  background:var(--surface-3);color:var(--text);border:1px solid var(--border);
  transition:background .15s}
button:hover{background:var(--accent-muted)}
input,textarea,select{font:inherit;padding:6px 10px;border-radius:var(--radius);
  background:var(--surface-2);color:var(--text);border:1px solid var(--border);outline:none}
input:focus,textarea:focus,select:focus{border-color:var(--text-faint)}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 10px;border:1px solid var(--border);text-align:left}
th{color:var(--text);background:var(--surface-2)}
code,pre{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.85em}
pre{background:var(--surface-2);padding:10px;border-radius:var(--radius);overflow:auto}
hr{border:none;border-top:1px solid var(--border);margin:12px 0}
::selection{background:var(--accent-muted)}
`;
}

export function InteractiveHtml({ code }: { code: string }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [tall, setTall] = useState(false);
  const [copied, setCopied] = useState(false);
  const [runId, setRunId] = useState(0);
  // Tema değişiminde iframe'i taze değişkenlerle yeniden kur
  const theme = useSettingsStore((s) => s.settings?.theme);

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><style>${buildThemeCss()}</style></head><body>${code}</body></html>`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, theme],
  );

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="not-prose my-2 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="px-1.5 text-[0.7143rem] uppercase tracking-wider text-text-faint">
          İnteraktif içerik
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setView(view === "preview" ? "code" : "preview")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
            title={view === "preview" ? "Kodu göster" : "Önizlemeyi göster"}
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
            onClick={() => setTall((t) => !t)}
            className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
            title={tall ? "Küçült" : "Büyüt"}
          >
            {tall ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={copy}
            className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
            title="Kodu kopyala"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      {view === "preview" ? (
        <iframe
          key={runId}
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={srcDoc}
          title="İnteraktif yanıt"
          className="w-full border-0 bg-base"
          style={{ height: tall ? 560 : 340 }}
        />
      ) : (
        <pre
          className="m-0 overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[0.7857rem] leading-relaxed text-text-secondary"
          style={{ maxHeight: tall ? 560 : 340, overflowY: "auto", userSelect: "text" }}
        >
          {code}
        </pre>
      )}
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
