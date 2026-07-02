import { useState, useEffect, useRef, useCallback, memo, useMemo, startTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp, Globe, ExternalLink, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  RotateCcw, Flag, Droplets, Wind,
  Sun, CloudSun, Cloud, CloudRain, CloudDrizzle, CloudLightning, CloudFog, Snowflake,
  ArrowLeftRight,
  MessageCircle,
  Paperclip,
  X,
  Wrench,
  Check,
  Cpu,
  Square,
  Zap,
  Brain,
  Sparkles,
  Plus,
  FileText,
  ImageIcon,
  Copy,
  Pencil,
  Trash2,
  Volume2,
  VolumeX,
  AlertTriangle,
  Loader,
} from "lucide-react";
import { createPortal } from "react-dom";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useChatStore, type ChatMessage, type ChatMode, modelSupportsTools, computeContextUsage } from "../../stores/chatStore";
import { useModelStore, modelSupportsVision, modelWeakAtTools } from "../../stores/modelStore";
import { useDocumentStore } from "../../stores/documentStore";
import { useUiStore } from "../../stores/uiStore";
import { useOptimizationStore } from "../../stores/optimizationStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { AppVersion } from "../../stores/appStore";
import { InteractiveHtml, extractNodeText } from "./InteractiveHtml";

/**
 * ReactMarkdown pre override'ı: ```html blokları sandbox'lı canlı önizleme
 * kartına dönüşür; diğer diller normal kod bloğu kalır. Yalnızca streaming
 * BİTMİŞ mesajlarda kullanılır — yarım HTML her token'da yeniden çalışmasın.
 */
const interactiveMarkdownComponents = {
  pre(props: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
    const child = props.children as { props?: { className?: string; children?: unknown } } | undefined;
    const cls = child?.props?.className ?? "";
    if (/language-html\b/.test(cls)) {
      return <InteractiveHtml code={extractNodeText(child?.props?.children).trimEnd()} />;
    }
    return <pre {...props} />;
  },
};
import { useFileDrop, isImagePath } from "../../hooks/useFileDrop";
import { AttachmentPreviews } from "../shared/AttachmentPreviews";
import { MicButton } from "../shared/MicButton";
import { ScreenshotButton } from "../shared/ScreenshotButton";
import { useTTS } from "../../hooks/useTTS";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAppStore } from "../../stores/appStore";
import { FaGithub, FaTelegram, FaDiscord } from "react-icons/fa6";
import { RiNotionFill } from "react-icons/ri";
import { ToolBlock } from "../code/ToolMessage";
import type { DocumentAttachment, WeatherData, CurrencyData, ModelInfo, ProviderKind } from "../../types";
import 'highlight.js/styles/base16/classic-dark.css';
import { useUserProfileStore } from "../../stores/userProfileStore";

const EMPTY_DOCS: DocumentAttachment[] = [];

const authenticatedTemplates = [
  (name: string) => `Merhaba, ${name}.`,
  (name: string) => `Hoş geldin ${name}.`,
  (name: string) => `Seni dinliyorum ${name}.`,
  (name: string) => `Söz sende ${name}.`
];

const unauthenticatedTemplates = [
  "Nasıl yardımcı olabilirim?",
  "Yeni bir çalışma başlatalım.",
  "Sorunuzu analiz etmeye hazırım.",
  "Lütfen bir komut girin."
];

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function Favicon({
  domain,
  size = 20,
  className = "",
}: {
  domain: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-surface-3 text-[0.6429rem] font-bold text-text-faint ${className}`}
        style={{ width: size, height: size }}
        title={domain}
      >
        {domain.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={faviconUrl(domain)}
      alt={domain}
      title={domain}
      width={size}
      height={size}
      className={`${className}`}
      onError={() => setFailed(true)}
    />
  );
}

function CollapsibleSearchResults({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const results = msg.searchResults ?? [];
  if (results.length === 0) return null;

  const domains = results.map((r) => getDomain(r.url));
  const uniqueDomains = [...new Set(domains)];

  return (
    <div className="rounded-2xl bg-surface p-3 transition-colors">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <Globe size={14} strokeWidth={1.4} className="shrink-0 text-text-faint" />

        {expanded ? (
          <span className="flex-1 text-xs text-text-faint">
            {results.length} kaynaktan bilgi çekildi
          </span>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <div className="flex -space-x-1.5">
              {uniqueDomains.slice(0, 5).map((domain) => (
                <Favicon
                  key={domain}
                  domain={domain}
                  size={20}
                  className="border border-surface"
                />
              ))}
            </div>
            <span className="text-xs text-text-faint">
              {results.length} kaynak
            </span>
          </div>
        )}

        <ChevronDown
          size={14}
          strokeWidth={1.6}
          className={`shrink-0 text-text-faint transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2">
              {results.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 rounded-xl bg-surface-2 p-2.5 transition-colors hover:bg-surface-3"
                >
                  <Favicon
                    domain={getDomain(r.url)}
                    size={24}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium leading-snug text-text line-clamp-1">
                        {r.title}
                      </h4>
                      <ExternalLink
                        size={11}
                        strokeWidth={1.4}
                        className="mt-0.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-faint line-clamp-2">
                      {r.snippet}
                    </p>
                    <p className="mt-0.5 truncate text-[0.7143rem] text-text-faint/50">
                      {getDomain(r.url)}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FullSearchResults({ msg }: { msg: ChatMessage }) {
  const results = msg.searchResults ?? [];
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-text-faint">
        <Globe size={13} strokeWidth={1.4} />
        <span>"{msg.text}" için arama sonuçları</span>
      </div>
      <div className="space-y-2.5">
        {results.map((r, i) => (
          <a
            key={i}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-xl bg-surface-2 p-3 transition-colors hover:bg-surface-3"
          >
            <div className="flex items-start gap-3">
              <Favicon
                domain={getDomain(r.url)}
                size={24}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium leading-snug text-text line-clamp-1">
                    {r.title}
                  </h4>
                  <ExternalLink
                    size={11}
                    strokeWidth={1.4}
                    className="mt-0.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-text-faint line-clamp-2">
                  {r.snippet}
                </p>
                <p className="mt-0.5 truncate text-[0.7143rem] text-text-faint/50">
                  {getDomain(r.url)}
                </p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function turkishDay(dateStr: string): string {
  const days = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const d = new Date(dateStr + "T00:00:00");
  return days[d.getDay()] ?? "";
}

function WeatherIcon({ code, size = 24 }: { code: string; size?: number }) {
  const props = { size, strokeWidth: 1.6 };
  switch (code) {
    case "clear":
      return <Sun {...props} className="text-amber-400" />;
    case "partly_cloudy":
      return <CloudSun {...props} className="text-[#8ab8c2]" />;
    case "cloudy":
      return <Cloud {...props} className="text-gray-400" />;
    case "fog":
      return <CloudFog {...props} className="text-gray-400" />;
    case "light_rain":
      return <CloudDrizzle {...props} className="text-blue-300" />;
    case "rain":
      return <CloudRain {...props} className="text-blue-400" />;
    case "snow":
      return <Snowflake {...props} className="text-cyan-300" />;
    case "thunder":
      return <CloudLightning {...props} className="text-yellow-300" />;
    default:
      return <CloudSun {...props} className="text-[#8ab8c2]" />;
  }
}

function WeatherCard({ data }: { data: WeatherData }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-2 to-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-text">{data.city}</h3>
          <p className="mt-0.5 text-sm text-text-secondary">{data.description}</p>
        </div>
        <WeatherIcon code={data.icon} size={32} />
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-medium tracking-tight text-text">
          {data.tempC}°
        </span>
        <span className="text-sm text-text-faint">
          Hissedilen {data.feelsLikeC}°
        </span>
      </div>

      <div className="mt-3 flex gap-4 text-xs text-text-faint">
        <span className="flex items-center gap-1">
          <Wind size={12} strokeWidth={1.4} /> {data.windKph} km/s
        </span>
        <span className="flex items-center gap-1">
          <Droplets size={12} strokeWidth={1.4} /> %{data.humidity}
        </span>
      </div>

      {data.forecast.length > 0 && (
        <div className="mt-4 flex gap-1 border-t border-border pt-3">
          {data.forecast.map((day, i) => (
            <div
              key={i}
              className="flex flex-1 flex-col items-center gap-1 text-center"
            >
              <span className="text-[1.1429rem] font-medium text-text-faint">
                {i === 0 ? "Bugün" : turkishDay(day.date)}
              </span>
              <WeatherIcon code={day.icon} size={16} />
              <span className="text-[1.1429rem] text-text">
                {day.maxTempC}°
              </span>
              <span className="text-[1.1429rem] text-text-faint">
                {day.minTempC}°
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CURRENCY_COLORS: Record<string, { badge: string; accent: string }> = {
  USD: { badge: "bg-emerald-500/20 text-emerald-400", accent: "border-emerald-500/30" },
  EUR: { badge: "bg-[#8ab8c2]/20 text-blue-400", accent: "border-[#8ab8c2]/30" },
  GBP: { badge: "bg-purple-500/20 text-purple-400", accent: "border-purple-500/30" },
  JPY: { badge: "bg-red-500/20 text-red-400", accent: "border-red-500/30" },
  CHF: { badge: "bg-orange-500/20 text-orange-400", accent: "border-orange-500/30" },
};

function CurrencyCard({ data }: { data: CurrencyData & { targetCode?: string; initialAmount?: number } }) {
  const targetCode = data.targetCode ?? "USD";
  const rate = data.rates.find((r) => r.code === targetCode) ?? data.rates[0];
  if (!rate) return null;

  const colors = CURRENCY_COLORS[rate.code] ?? { badge: "bg-surface-3 text-text-faint", accent: "border-border" };

  const [foreignVal, setForeignVal] = useState(() => String(data.initialAmount ?? 1));
  const [tryVal, setTryVal] = useState(() =>
    ((data.initialAmount ?? 1) * rate.rate).toFixed(2)
  );

  function onForeignChange(val: string) {
    setForeignVal(val);
    const num = parseFloat(val.replace(",", "."));
    setTryVal(isNaN(num) ? "" : (num * rate.rate).toFixed(2));
  }

  function onTryChange(val: string) {
    setTryVal(val);
    const num = parseFloat(val.replace(",", "."));
    setForeignVal(isNaN(num) ? "" : (num / rate.rate).toFixed(2));
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-2 to-surface p-5">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ${colors.badge}`}>
          {rate.symbol}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold text-text">{rate.code}</span>
            <span className="text-xs text-text-faint">/ TRY</span>
          </div>
          <p className="text-xs text-text-faint">{rate.name}</p>
        </div>
        <div className="text-right">
          <span className="font-mono text-xl font-semibold tabular-nums text-text">
            ₺{rate.rate.toFixed(2)}
          </span>
          <p className="text-[0.7143rem] text-text-faint">1 {rate.code} karşılığı</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className={`flex-1 rounded-xl border ${colors.accent} bg-surface-3/40 px-3 py-2.5`}>
          <label className="mb-0.5 block text-[0.7143rem] font-medium uppercase tracking-wider text-text-faint">
            {rate.code}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={foreignVal}
            onChange={(e) => onForeignChange(e.target.value)}
            className="w-full bg-transparent font-mono text-base font-medium tabular-nums text-text outline-none placeholder:text-text-faint"
            placeholder="0.00"
          />
        </div>

        <ArrowLeftRight size={14} strokeWidth={1.6} className="shrink-0 text-text-faint" />

        <div className="flex-1 rounded-xl border border-border bg-surface-3/40 px-3 py-2.5">
          <label className="mb-0.5 block text-[0.7143rem] font-medium uppercase tracking-wider text-text-faint">
            TRY
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={tryVal}
            onChange={(e) => onTryChange(e.target.value)}
            className="w-full bg-transparent font-mono text-base font-medium tabular-nums text-text outline-none placeholder:text-text-faint"
            placeholder="0.00"
          />
        </div>
      </div>
    </div>
  );
}

interface ExtractedLink {
  url: string;
  label: string;
  domain: string;
}

function extractLinksFromText(text: string): ExtractedLink[] {
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(text)) !== null) {
    const domain = getDomain(m[2]);
    if (!seen.has(domain)) {
      seen.add(domain);
      links.push({ url: m[2], label: m[1], domain });
    }
  }
  const bareRe = /(?<!\]\()(?<!\()(https?:\/\/[^\s)<>]+)/g;
  while ((m = bareRe.exec(text)) !== null) {
    const domain = getDomain(m[0]);
    if (!seen.has(domain)) {
      seen.add(domain);
      links.push({ url: m[0], label: domain, domain });
    }
  }
  return links;
}

function CitationPills({ links }: { links: ExtractedLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="relative mb-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" style={{ maskImage: "linear-gradient(to right, black 85%, transparent 100%)", WebkitMaskImage: "linear-gradient(to right, black 85%, transparent 100%)" }}>
        {links.map((link, i) => (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-[0.7143rem] text-text-faint transition-colors hover:bg-surface-3 hover:text-text-secondary"
            title={link.label}
          >
            <Favicon domain={link.domain} size={12} />
            <span className="max-w-[100px] truncate">{link.domain}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const thinkingRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (expanded && isStreaming && thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [content, expanded, isStreaming]);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
      >
        {isStreaming ? (
          <Loader size={12} strokeWidth={1.4} className="animate-spin" />
        ) : (
          <Brain size={12} strokeWidth={1.6} />
        )}
        <span style={{ height: "14.25px" }}>Düşünüyor</span>
        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.pre
            ref={thinkingRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-1 overflow-hidden rounded-lg border border-border/30 bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-faint"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto" }}
          >
            {content}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

const THROTTLE_MS = 80;

function StreamingMarkdown({ text }: { text: string }) {
  const [rendered, setRendered] = useState(text);
  const lastUpdate = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = performance.now();
    const elapsed = now - lastUpdate.current;

    if (elapsed >= THROTTLE_MS) {
      lastUpdate.current = now;
      startTransition(() => setRendered(text));
    } else {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        lastUpdate.current = performance.now();
        startTransition(() => setRendered(text));
      }, THROTTLE_MS - elapsed);
    }

    return () => { if (pending.current) clearTimeout(pending.current); };
  }, [text]);

  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}>{rendered}</ReactMarkdown>;
}

function MessageActions({ msg, chatId, onEdit }: { msg: ChatMessage; chatId: string; onEdit: () => void }) {
  const [copied, setCopied] = useState(false);
  const [reported, setReported] = useState(false);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);
  const switchMessageVersion = useChatStore((s) => s.switchMessageVersion);
  const thinking = useChatStore((s) => s.thinking);
  const { speak, speakingId, supported: ttsSupported } = useTTS();
  const ttsEnabled = useSettingsStore((s) => s.settings?.tts?.enabled) ?? true;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [msg.text]);

  // Rapor: teşhis şablonunu panoya kopyalar + bildirim merkezine kayıt düşer.
  const handleReport = useCallback(() => {
    const model = useModelStore.getState().models.find((m) => m.isActive);
    const report = [
      "## Axiom Yanıt Raporu",
      `Tarih: ${new Date().toLocaleString("tr-TR")}`,
      `Model: ${model ? `${model.id} (${model.provider})` : "bilinmiyor"}`,
      `Uygulama: v${AppVersion}`,
      "",
      "### Sorunlu yanıt",
      msg.text,
    ].join("\n");
    navigator.clipboard.writeText(report);
    useNotificationStore.getState().add({
      taskId: `report-${msg.id}`,
      title: "Yanıt raporlandı",
      content: "Rapor şablonu panoya kopyalandı — geliştiriciye iletebilirsin.",
    });
    setReported(true);
    setTimeout(() => setReported(false), 1500);
  }, [msg]);

  const showTtsBtn = ttsSupported && ttsEnabled && msg.role === "agent" && msg.text.trim().length > 0;
  const isSpeakingThis = speakingId === msg.id;
  const versionCount = msg.alternates?.length ?? 0;
  const versionIdx = msg.versionIndex ?? Math.max(0, versionCount - 1);

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      {msg.role === "agent" && versionCount > 1 && (
        <span className="mr-1 flex items-center gap-0.5 text-[0.7143rem] tabular-nums text-text-faint">
          <button
            onClick={() => switchMessageVersion(chatId, msg.id, -1)}
            disabled={versionIdx === 0}
            className="rounded-md p-0.5 hover:bg-hover hover:text-text-secondary disabled:opacity-30"
            title="Önceki sürüm"
          >
            <ChevronLeft size={12} strokeWidth={1.8} />
          </button>
          {versionIdx + 1}/{versionCount}
          <button
            onClick={() => switchMessageVersion(chatId, msg.id, 1)}
            disabled={versionIdx >= versionCount - 1}
            className="rounded-md p-0.5 hover:bg-hover hover:text-text-secondary disabled:opacity-30"
            title="Sonraki sürüm"
          >
            <ChevronRight size={12} strokeWidth={1.8} />
          </button>
        </span>
      )}
      {msg.role === "agent" && (
        <button
          onClick={() => void regenerateMessage(chatId, msg.id)}
          disabled={thinking}
          className="rounded-md p-1 text-text-faint hover:bg-hover hover:text-text-secondary disabled:opacity-40"
          title="Yeniden oluştur"
        >
          <RotateCcw size={13} strokeWidth={1.6} />
        </button>
      )}
      {msg.role === "agent" && (
        <button
          onClick={handleReport}
          className="rounded-md p-1 text-text-faint hover:bg-hover hover:text-text-secondary"
          title="Yanıtı raporla"
        >
          {reported ? <Check size={13} strokeWidth={1.6} /> : <Flag size={13} strokeWidth={1.6} />}
        </button>
      )}
      {showTtsBtn && (
        <button
          onClick={() => speak(msg.id, msg.text)}
          className={`rounded-md p-1 ${isSpeakingThis
              ? "text-blue-400 hover:bg-hover"
              : "text-text-faint hover:bg-hover hover:text-text-secondary"
            }`}
          title={isSpeakingThis ? "Durdur" : "Sesli oku"}
        >
          {isSpeakingThis ? (
            <VolumeX size={13} strokeWidth={1.6} className="animate-pulse" />
          ) : (
            <Volume2 size={13} strokeWidth={1.6} />
          )}
        </button>
      )}
      <button
        onClick={handleCopy}
        className="rounded-md p-1 text-text-faint hover:bg-hover hover:text-text-secondary"
        title="Kopyala"
      >
        {copied ? <Check size={13} strokeWidth={1.6} /> : <Copy size={13} strokeWidth={1.6} />}
      </button>
      {msg.role === "user" && (
        <>
          <button
            onClick={onEdit}
            className="rounded-md p-1 text-text-faint hover:bg-hover hover:text-text-secondary"
            title="Düzenle"
          >
            <Pencil size={13} strokeWidth={1.6} />
          </button>
          <button
            onClick={() => deleteMessage(chatId, msg.id)}
            className="rounded-md p-1 text-text-faint hover:bg-hover hover:text-red-400"
            title="Sil"
          >
            <Trash2 size={13} strokeWidth={1.6} />
          </button>
        </>
      )}
    </div>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.img
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.15 }}
          src={`data:image/png;base64,${src}`}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={onClose}
          className="absolute right-4 top-12 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
        >
          <X size={20} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

function MessageImages({ images }: { images: string[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const gridClass = images.length === 1
    ? "grid-cols-1 max-w-[280px]"
    : images.length === 2
      ? "grid-cols-2 max-w-[360px]"
      : "grid-cols-3 max-w-[420px]";

  return (
    <>
      <div className={`grid ${gridClass} gap-1.5 mb-1.5`}>
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setLightboxIdx(i)}
            className="overflow-hidden rounded-lg border border-border/20 transition-opacity hover:opacity-80"
          >
            <img
              src={`data:image/png;base64,${img}`}
              className="h-auto w-full object-cover"
              style={{ maxHeight: images.length === 1 ? 300 : 150 }}
            />
          </button>
        ))}
      </div>
      {lightboxIdx !== null && (
        <ImageLightbox
          src={images[lightboxIdx]}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  );
}

const MessageBubble = memo(function MessageBubble({
  msg,
  chatId,
  isStreaming,
  onToggleAction,
}: {
  msg: ChatMessage;
  chatId: string;
  isStreaming: boolean;
  onToggleAction?: (idx: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.text);
  const editMessage = useChatStore((s) => s.editMessage);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== msg.text) {
      editMessage(chatId, msg.id, trimmed);
    }
    setEditing(false);
  }, [editText, msg.text, msg.id, chatId, editMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditText(msg.text);
    setEditing(false);
  }, [msg.text]);

  if (msg.role === "search") {
    if (msg.fromToggle) {
      return <CollapsibleSearchResults msg={msg} />;
    }
    return <FullSearchResults msg={msg} />;
  }

  if (msg.role === "card") {
    if (msg.cardType === "weather" && msg.cardData) {
      return <WeatherCard data={msg.cardData as WeatherData} />;
    }
    if (msg.cardType === "currency" && msg.cardData) {
      return <CurrencyCard data={msg.cardData as CurrencyData} />;
    }
    return null;
  }

  if (msg.role === "user") {
    if (editing) {
      return (
        <div className="flex justify-end">
          <div className="w-[75%] space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                if (e.key === "Escape") handleCancelEdit();
              }}
              className="w-full resize-none rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-sm leading-relaxed text-text outline-none focus:border-primary"
              rows={Math.min(editText.split("\n").length + 1, 8)}
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <button onClick={handleCancelEdit} className="rounded-lg px-3 py-1 text-xs text-text-secondary hover:bg-hover">İptal</button>
              <button onClick={handleSaveEdit} className="rounded-lg bg-primary px-3 py-1 text-xs text-white hover:bg-primary/80">Kaydet</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="group flex flex-column items-start justify-end gap-1.5" style={{
        display: "flex",
        flexDirection: "column-reverse",
        alignItems: "end"
      }
      } >
        <MessageActions msg={msg} chatId={chatId} onEdit={() => { setEditText(msg.text); setEditing(true); }} />
        <div className="flex max-w-[75%] flex-col items-end">
          {msg.images && msg.images.length > 0 ? (
            <MessageImages images={msg.images} />
          ) : msg.imageCount ? (
            <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-surface-2/50 px-3 py-2 text-xs text-text-faint">
              <ImageIcon size={14} />
              <span>{msg.imageCount} resim (önbellek temizlendi)</span>
            </div>
          ) : null}
          <div
            className="prose prose-sm w-full rounded-2xl bg-surface-2 px-4 py-2.5 text-sm leading-relaxed text-text dark:prose-invert"
            style={{ userSelect: "text" }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}>{msg.text}</ReactMarkdown>
          </div>
        </div>
      </div >
    );
  }

  const displayText = msg.text.replace(/```tool:\w+[\s\S]*?```/g, "").trim();
  const extractedLinks = displayText ? extractLinksFromText(displayText) : [];

  return (
    <div className="group" style={{
      marginBottom: "1rem"
    }}>
      {msg.thinkingContent && (
        <ThinkingBlock content={msg.thinkingContent} isStreaming={isStreaming && !msg.text} />
      )}
      {msg.toolActions && msg.toolActions.length > 0 && (
        <div className="mb-2">
          {msg.toolActions.map((action, idx) => (
            <ToolBlock
              key={idx}
              action={action}
              onToggle={() => onToggleAction?.(idx)}
            />
          ))}
        </div>
      )}
      {extractedLinks.length > 0 && <CitationPills links={extractedLinks} />}
      {displayText && (
        <div
          className="prose prose-sm max-w-none text-sm leading-relaxed text-text-secondary dark:prose-invert"
          style={{ userSelect: "text" }}
        >
          {isStreaming ? (
            <StreamingMarkdown text={displayText} />
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
              components={interactiveMarkdownComponents}
            >{displayText}</ReactMarkdown>
          )}
        </div>
      )}
      {!isStreaming && displayText && (
        <div className="mt-1">
          <MessageActions msg={msg} chatId={chatId} onEdit={() => { }} />
        </div>
      )}
    </div>
  );
});

interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const APP_SLASH_ICONS: Record<string, React.ReactNode> = {
  github: <FaGithub size={14} />,
  telegram: <FaTelegram size={14} />,
  discord: <FaDiscord size={14} />,
  notion: <RiNotionFill size={14} />,
};

const BASE_SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/compact",
    label: "Sıkıştır",
    description: "Konuşma bağlamını sıkıştır",
    icon: <MessageCircle size={14} strokeWidth={1.6} />,
  },
];

function useSlashCommands(): SlashCommand[] {
  const apps = useAppStore((s) => s.apps);
  const appCommands: SlashCommand[] = apps
    .filter((a) => a.tools.length > 0)
    .map((a) => ({
      command: `/${a.id}`,
      label: a.name,
      description: a.description,
      icon: APP_SLASH_ICONS[a.id] ?? <Wrench size={14} strokeWidth={1.6} />,
    }));
  return [...BASE_SLASH_COMMANDS, ...appCommands];
}

const MODE_OPTIONS: { value: ChatMode; icon: typeof Zap; label: string }[] = [
  { value: "fast", icon: Zap, label: "Hızlı" },
  { value: "balanced", icon: Sparkles, label: "Dengeli" },
  { value: "thinking", icon: Brain, label: "Derin Düşünme" },
];

export function ModeSelector({ mode, onChange }: { mode?: ChatMode; onChange?: (m: ChatMode) => void } = {}) {
  const storeMode = useChatStore((s) => s.chatMode);
  const storeSet = useChatStore((s) => s.setChatMode);
  const chatMode = mode ?? storeMode;
  const setChatMode = onChange ?? storeSet;
  const activeModel = useModelStore((s) => s.models.find((m) => m.isActive));
  const hasThinking = activeModel?.capabilities?.includes("thinking") ?? false;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasThinking && chatMode === "thinking") setChatMode("balanced");
  }, [hasThinking, chatMode, setChatMode]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const current = MODE_OPTIONS.find((m) => m.value === chatMode) ?? MODE_OPTIONS[1];
  const CurrentIcon = current.icon;

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.7857rem] text-text-faint transition-all duration-200 hover:bg-hover hover:text-text-secondary"
      >
        <CurrentIcon size={12} strokeWidth={1.6} />
        <span style={{ height: 20, fontSize: 13 }}>{current.label}</span>
        {open ? <ChevronUp size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-1.5 w-40 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg"
          >
            <div className="py-0">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const disabled = opt.value === "thinking" && !hasThinking;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    title={disabled ? "Bu model derin düşünme yeteneğini desteklemiyor" : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (disabled) return;
                      setChatMode(opt.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${disabled
                      ? "cursor-not-allowed text-text-faint/40"
                      : chatMode === opt.value
                        ? "bg-hover text-text hover:bg-hover-strong"
                        : "text-text-secondary hover:bg-hover-strong"
                      }`}
                  >
                    <Icon size={14} strokeWidth={1.6} />
                    <span style={{ height: 20 }}>{opt.label}</span>
                    {chatMode === opt.value && !disabled && <Check size={14} strokeWidth={2} className="ml-auto shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function modelFamily(id: string) {
  return id.split(":")[0] ?? id;
}

function variantLabel(m: { id: string; parameterCount?: string | null; quantization?: string | null }) {
  // Etikette önce boyut tag'i (örn. "12b"), yoksa parametre sayısı; ardından quant.
  const tag = m.id.includes(":") ? m.id.split(":").slice(1).join(":") : null;
  const parts: string[] = [];
  if (tag) parts.push(tag);
  else if (m.parameterCount) parts.push(m.parameterCount);
  if (m.quantization) parts.push(m.quantization);
  return parts.join(" · ");
}

function sizeLabel(m: { parameterCount?: string | null; quantization?: string | null }) {
  const parts: string[] = [];
  if (m.parameterCount) parts.push(m.parameterCount);
  if (m.quantization) parts.push(m.quantization);
  return parts.join(" · ");
}

/** Aynı ailenin birden fazla indirilmiş boyutu olduğunda yana açılan alt menülü satır. */
function ModelGroupRow({
  group,
  onSelect,
}: {
  group: ModelInfo[];
  onSelect: (provider: ProviderKind, id: string) => void;
}) {
  const [subOpen, setSubOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const family = modelFamily(group[0].id);
  const activeVariant = group.find((m) => m.isActive);
  const SUB_W = 184;

  function computePos() {
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    // Tercihen sağa aç; ekranın sağına sığmazsa sola aç.
    const rightCandidate = r.right + 6;
    const left =
      rightCandidate + SUB_W <= window.innerWidth - 8
        ? rightCandidate
        : r.left - SUB_W - 6;
    setPos({ left, top: r.top });
  }

  function openSub() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    enterTimer.current = setTimeout(() => {
      computePos();
      setSubOpen(true);
    }, 110);
  }
  function closeSub() {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    leaveTimer.current = setTimeout(() => setSubOpen(false), 240);
  }

  return (
    <div className="relative" onMouseEnter={openSub} onMouseLeave={closeSub}>
      <button
        ref={rowRef}
        type="button"
        onClick={() => { computePos(); setSubOpen((v) => !v); }}
        className={`flex w-full items-center gap-1 px-2 py-1.25 text-left hover:bg-hover-strong ${activeVariant ? "bg-hover text-text" : "text-text-secondary"}`}
      >
        <div className="min-w-0 flex-1 flex flex-row items-center justify-start gap-2">
          <span className="truncate text-sm font-medium">{family}</span>
          {activeVariant ? (
            <span className="text-[0.7143rem] text-accent">{variantLabel(activeVariant)}</span>
          ) : (
            <span className="text-[0.7143rem] text-text-faint">{group.length} boyut</span>
          )}
        </div>
        {activeVariant && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
        <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-text-faint" />
      </button>

      {createPortal(
        <AnimatePresence>
          {subOpen && pos && (
            <motion.div
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 4 }}
              transition={{ duration: 0.13 }}
              onMouseEnter={() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }}
              onMouseLeave={closeSub}
              style={{ position: "fixed", left: pos.left, top: pos.top, width: SUB_W }}
              className="z-[60] overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg"
            >
              <div className="max-h-64 overflow-y-auto scrollbar-none py-0">
                {group.map((m) => (
                  <button
                    key={`${m.provider}-${m.id}`}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onSelect(m.provider, m.id); }}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-hover-strong ${m.isActive ? "bg-hover text-text" : "text-text-secondary"}`}
                  >
                    <span className="flex-1 truncate text-[0.9286rem]">{variantLabel(m) || m.id}</span>
                    {m.isActive && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export function ModelSelector() {
  const models = useModelStore((s) => s.models);
  const activeModel = useModelStore((s) => s.models.find((m) => m.isActive));
  const setActive = useModelStore((s) => s.setActive);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Ollama modellerini aileye göre grupla; cloud modeller tekil kalır.
  const groups = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const m of models) {
      const key = m.provider === "cloud" ? `cloud:${m.id}` : `ollama:${modelFamily(m.id)}`;
      const arr = map.get(key);
      if (arr) arr.push(m);
      else map.set(key, [m]);
    }
    return Array.from(map.values());
  }, [models]);

  function selectModel(provider: ProviderKind, id: string) {
    setActive(provider, id);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.7857rem] text-text-faint transition-all duration-200 hover:bg-hover hover:text-text-secondary"
      >
        <Cpu size={12} strokeWidth={1.6} />
        <span className="max-w-[120px] truncate" style={{ height: 20, fontSize: 13 }}>
          {activeModel ? modelFamily(activeModel.id) : "Model seç"}
        </span>
        {open ? <ChevronUp size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-0 mb-1.5 w-56 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg"
          >
            <div className="max-h-64 overflow-y-auto scrollbar-none py-0">
              {groups.length === 0 && (
                <p className="px-3 py-2 text-xs text-text-faint">Model bulunamadı</p>
              )}
              {groups.map((group) => {
                // Tek boyutlu aile veya cloud → doğrudan seçilebilir satır
                if (group.length === 1) {
                  const m = group[0];
                  return (
                    <button
                      key={`${m.provider}-${m.id}`}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectModel(m.provider, m.id); }}
                      className={`flex w-full items-center gap-1 px-2 py-1.25 text-left hover:bg-hover-strong ${m.isActive ? "bg-hover text-text" : "text-text-secondary"}`}
                    >
                      <div className="min-w-0 flex-1 flex flex-row items-center justify-start gap-2">
                        <div className="flex items-center gap-1">
                          <span className="truncate text-sm font-medium">{modelFamily(m.id)}</span>
                          {m.provider === "cloud" && (
                            <span className="shrink-0 rounded bg-accent-muted px-1 py-0.5 text-[0.6429rem] font-medium uppercase text-text-faint">
                              cloud
                            </span>
                          )}
                        </div>
                        {sizeLabel(m) && (
                          <span className="text-[0.7143rem] text-text-faint">{sizeLabel(m)}</span>
                        )}
                      </div>
                      {m.isActive && <Check size={14} strokeWidth={2} className="shrink-0 text-accent" />}
                    </button>
                  );
                }
                // Çok boyutlu aile → yana açılan alt menü
                return (
                  <ModelGroupRow
                    key={`group-${modelFamily(group[0].id)}`}
                    group={group}
                    onSelect={selectModel}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChatPanel() {
  const chat = useChatStore((s) => s.activeChat());
  const thinking = useChatStore((s) => s.thinking);
  const thinkingStatus = useChatStore((s) => s.thinkingStatus);
  const send = useChatStore((s) => s.send);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const toolUseEnabled = useChatStore((s) => s.toolUseEnabled);
  const setToolUseEnabled = useChatStore((s) => s.setToolUseEnabled);
  const toggleToolCollapse = useChatStore((s) => s.toggleToolCollapse);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const SLASH_COMMANDS = useSlashCommands();
  const [draft, setDraft] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeModel = useModelStore((s) => s.models.find((m) => m.isActive));
  const numCtx = useOptimizationStore((s) => s.config?.numCtx);
  const chatMessages = chat?.messages ?? [];
  const ctxLimit = numCtx ?? activeModel?.contextLength ?? 4096;
  const contextUsage = useMemo(
    () => computeContextUsage(chatMessages, ctxLimit),
    [chatMessages, ctxLimit],
  );

  useEffect(() => {
    if (!plusMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) setPlusMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [plusMenuOpen]);

  const chatId = activeChatId;
  const docs = useDocumentStore((s) => s.chatDocuments[chatId ?? ""] ?? EMPTY_DOCS);
  const addDocument = useDocumentStore((s) => s.addDocument);
  const addPastedFile = useDocumentStore((s) => s.addPastedFile);
  const removeDocument = useDocumentStore((s) => s.removeDocument);
  const clearDocuments = useDocumentStore((s) => s.clearDocumentsForChat);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const cd = e.clipboardData;
    if (!cd) return;
    const files: File[] = [];
    if (cd.files && cd.files.length) {
      for (const f of Array.from(cd.files)) files.push(f);
    } else {
      for (const it of Array.from(cd.items)) {
        if (it.kind === "file") { const f = it.getAsFile(); if (f) files.push(f); }
      }
    }
    if (files.length === 0) return; // düz metin → normal yapıştır
    const cid = chatId;
    if (!cid) return;
    const accepted = files.filter((f) =>
      f.type.startsWith("image/")
        ? modelSupportsVision(activeModel)
        : f.type.startsWith("text/") || f.type === "application/json" || f.type === "application/xml" || f.type === ""
    );
    if (accepted.length === 0) return;
    e.preventDefault();
    for (const f of accepted) void addPastedFile(cid, f);
  }

  const view = useUiStore((s) => s.view);
  const pendingScrollMessageId = useUiStore((s) => s.pendingScrollMessageId);
  const requestScrollToMessage = useUiStore((s) => s.requestScrollToMessage);

  // SearchModal'dan gelen mesaj scroll talebini yerine getir.
  useEffect(() => {
    if (!pendingScrollMessageId || view !== "chat") return;
    // Mesajın DOM'a render olması için bir tick bekle
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-msg-id="${CSS.escape(pendingScrollMessageId)}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-blue-400/60", "rounded-lg");
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-blue-400/60", "rounded-lg");
        }, 1500);
      }
      requestScrollToMessage(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [pendingScrollMessageId, view, chatId, requestScrollToMessage]);
  const onDropPaths = useCallback(
    (paths: string[]) => {
      if (!chatId) return;
      for (const p of paths) {
        if (isImagePath(p) && !modelSupportsVision(activeModel)) continue;
        void addDocument(chatId, p);
      }
    },
    [chatId, addDocument, activeModel],
  );
  const dragOver = useFileDrop(onDropPaths, view === "chat" && !!chatId);

  async function handleAttachFile() {
    try {
      const selected = await dialogOpen({
        multiple: true,
        filters: [
          {
            name: "Belgeler",
            extensions: [
              "txt", "md", "json", "csv", "xml", "yaml", "yml", "toml",
              "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "rs",
              "go", "java", "c", "h", "cpp", "hpp", "sql", "sh", "ps1",
              "log", "mjs", "mts",
            ],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      let cid = chatId;
      if (!cid) {
        useChatStore.getState().newChat();
        cid = useChatStore.getState().activeChatId!;
      }
      for (const rawPath of paths) {
        const p = typeof rawPath === "string" ? rawPath : String(rawPath);
        await addDocument(cid, p);
      }
    } catch (e) {
      console.error("Belge yükleme hatası:", e);
    }
  }

  async function handleAttachImage() {
    try {
      const selected = await dialogOpen({
        multiple: true,
        filters: [
          {
            name: "Resimler",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      let cid = chatId;
      if (!cid) {
        useChatStore.getState().newChat();
        cid = useChatStore.getState().activeChatId!;
      }
      for (const rawPath of paths) {
        const p = typeof rawPath === "string" ? rawPath : String(rawPath);
        await addDocument(cid, p);
      }
    } catch (e) {
      console.error("Resim yükleme hatası:", e);
    }
  }

  const messages = chatMessages;
  const isEmpty = messages.length === 0 && !thinking;

  const slashPrefix = draft.startsWith("/") ? draft.split(" ")[0].toLowerCase() : null;
  const showSlash = slashPrefix !== null && !draft.includes(" ");
  const filteredCommands = showSlash
    ? SLASH_COMMANDS.filter((c) => c.command.startsWith(slashPrefix!))
    : [];

  useEffect(() => {
    setSlashIndex(0);
  }, [draft]);

  const lastMsgText = messages[messages.length - 1]?.text;
  useEffect(() => {
    if (!isEmpty) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, thinking, lastMsgText, isEmpty]);

  useEffect(() => {
    if (!thinking) inputRef.current?.focus();
  }, [thinking]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !showSlash) {
        e.preventDefault();
        (e.target as HTMLTextAreaElement).form?.requestSubmit();
        return;
      }
      if (filteredCommands.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === "Tab" || (e.key === "Enter" && showSlash)) {
        e.preventDefault();
        const cmd = filteredCommands[slashIndex];
        if (cmd) setDraft(cmd.command + " ");
      }
    },
    [filteredCommands, slashIndex, showSlash]
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (showSlash && filteredCommands.length > 0) return;
    const text = draft.trim();
    if (!text || thinking || !activeModel) return;
    void send(text);
    setDraft("");
    if (chatId && docs.length > 0) clearDocuments(chatId);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
        inputRef.current.focus();
      }
    });
  }

  const inputForm = (
    <div className="relative w-full">
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-[5%] bottom-0 top-[0px] z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/50 bg-accent/[0.08] backdrop-blur-sm"
          >
            <span className="flex items-center gap-2 text-sm text-text-secondary">
              <Paperclip size={14} strokeWidth={1.6} /> Dosyaları bırak — belge ve resimler eklenir
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {filteredCommands.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-1.5 w-full h-max-[50vh] overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg"
          >
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.command}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDraft(cmd.command + " ");
                  inputRef.current?.focus();
                }}
                onMouseEnter={() => setSlashIndex(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${i === slashIndex ? "bg-hover-strong text-text" : "text-text-secondary"
                  }`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${i === slashIndex ? "bg-active text-text" : "bg-surface-3 text-text-faint"
                  }`}>
                  {cmd.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{cmd.command}</span>
                  <span className="ml-2 text-xs text-text-faint">{cmd.description}</span>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AttachmentPreviews
        docs={docs}
        onRemove={(id) => chatId && removeDocument(chatId, id)}
        className="w-[90%] mx-auto"
      />

      <form
        onSubmit={submit}
        className="group/form flex mx-auto w-[90%] gap-3 rounded-2xl bg-surface-2 px-1 py-1.5 pb-2 transition-colors duration-200 focus-within:bg-surface-3"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: ".25em"
        }}
      >
        <div
          className="flex w-full gap-3 px-3 pt-2 pr-3"
          style={{
            display: "flex",
            flexDirection: "row",
            gap: ".5em"
          }}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={
              activeModel
                ? "Mesaj yaz..."
                : "Model seçilmedi — Bir model seç"
            }
            disabled={thinking || !activeModel}
            className="flex-1 resize-none bg-transparent text-sm text-text outline-none placeholder:text-text-faint disabled:opacity-50"
            style={{ maxHeight: 160 }}
          />
          {thinking ? (
            <button
              type="button"
              onClick={stopGeneration}
              title="Durdur"
              className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-active text-text-secondary transition-all duration-200 hover:bg-red-500/20 hover:text-red-400"
            >
              <Square size={10} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || !activeModel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-active text-text-secondary transition-all duration-200 hover:bg-border-hover hover:text-text disabled:opacity-30"
            >
              <ArrowUp size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-1 px-1">
          <div ref={plusMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setPlusMenuOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-all duration-200 hover:bg-hover hover:text-text-secondary"
            >
              <Plus size={16} strokeWidth={1.8} />
            </button>
            <AnimatePresence>
              {plusMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-0 mb-1.5 w-44 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg"
                >
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setPlusMenuOpen(false);
                      handleAttachFile();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-hover-strong"
                  >
                    <FileText size={14} strokeWidth={1.6} className="text-text-faint" />
                    <span>Belge Ekle</span>
                  </button>
                  {modelSupportsVision(activeModel) && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setPlusMenuOpen(false);
                        handleAttachImage();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-hover-strong"
                    >
                      <ImageIcon size={14} strokeWidth={1.6} className="text-text-faint" />
                      <span>Resim Ekle</span>
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {modelSupportsTools(activeModel) && (
            <button
              type="button"
              onClick={() => setToolUseEnabled(!toolUseEnabled)}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.7857rem] transition-all duration-200 ${toolUseEnabled
                ? "bg-accent-muted text-text-secondary"
                : "text-text-faint hover:bg-hover hover:text-text-secondary"
                }`}
              title={toolUseEnabled ? "Araçlar açık — kapat" : "Araçlar kapalı — aç"}
            >
              <Wrench size={12} strokeWidth={1.6} />
              <span style={{ height: 20, fontSize: 13 }}>Araçlar</span>
            </button>
          )}
          {modelSupportsTools(activeModel) && toolUseEnabled && modelWeakAtTools(activeModel) && (
            <div
              className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[0.7857rem] text-amber-500"
              title="Bu model küçük (≈14B altı) ve araç çağırmada güvenilmez olabilir: olmayan araç/parametre uydurabilir. Sağlıklı araç kullanımı için daha güçlü bir model (örn. qwen2.5:14b, llama3.3:70b veya bir cloud modeli) seç."
            >
              <AlertTriangle size={12} strokeWidth={1.8} />
              <span style={{ height: 20, fontSize: 12 }}>zayıf model</span>
            </div>
          )}
          {contextUsage.total > 0 && messages.length > 0 && (() => {
            const pct = Math.min(100, (contextUsage.used / contextUsage.total) * 100);
            const r = 7;
            const circ = 2 * Math.PI * r;
            const offset = circ - (pct / 100) * circ;
            return (
              <div
                className="flex items-center gap-1 px-1"
                title={`Context: ${contextUsage.used} / ${contextUsage.total} token`}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                  <circle cx="9" cy="9" r={r} fill="none" className="stroke-surface-3 group-focus-within/form:stroke-[rgba(255,255,255,0.12)]" strokeWidth="2" />
                  <circle
                    cx="9" cy="9" r={r} fill="none"
                    stroke="#60a5fa"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={circ}
                    strokeDashoffset={offset}
                    transform="rotate(-90 9 9)"
                    className="transition-all duration-500"
                  />
                </svg>
                <span className="text-[0.7143rem] tabular-nums text-text-faint">
                  {Math.round(pct)}%
                </span>
              </div>
            );
          })()}
          <MicButton
            onTranscript={(text) =>
              setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
            }
            disabled={thinking || !activeModel}
          />
          {modelSupportsVision(activeModel) && chatId && (
            <ScreenshotButton
              onCapture={(file) => {
                void addPastedFile(chatId, file);
              }}
              disabled={thinking}
            />
          )}
          <ModeSelector />
          <ModelSelector />
        </div>
      </form>
      <p className="mt-1 mx-auto text-accent/35" style={{
        textAlign: "center",
        width: "fit-content",
        fontSize: 13
      }}>(Deneysel Sürüm) Geliştirme aşamasındadır, hata yapabilir...</p>
    </div>
  );

  const profile = useUserProfileStore((s) => s.profile);

  const [authIndex] = useState(() => Math.floor(Math.random() * authenticatedTemplates.length));
  const [unauthIndex] = useState(() => Math.floor(Math.random() * unauthenticatedTemplates.length));

  const userName = profile?.name?.split(" ")[0] || "Kullanıcı";
  const renderedAuthText = authenticatedTemplates[authIndex](userName);
  const renderedUnauthText = unauthenticatedTemplates[unauthIndex];

  return (
    <div className="flex h-full flex-col">
      <AnimatePresence mode="wait">
        {isEmpty ? (
          <motion.div
            key="hero"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30, transition: { duration: 0.25 } }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-1 flex-col items-center justify-center px-6"
          >
            <div className="mb-10 flex flex-row items-center justify-center gap-3 select-none">
              

              <h1 className="text-xl md:text-3xl tracking-tight flex items-center justify-center text-center gap-3 w-full">
                {activeModel ? (
                  profile?.name ? (
                    <span
                      className="text-text-faint inline-block text-3xl md:text-4xl tracking-normal" // Ponto bir tık küçültüldü patlamasın diye
                      style={{
                        fontFamily: "'Indie Flower', cursive",
                        fontWeight: 500,
                      }}
                    >
                      {renderedAuthText}
                    </span>
                  ) : (
                    <span className="font-normal text-text-faint text-base md:text-4xl" style={{
                      fontFamily: "'Indie Flower', cursive",
                      fontWeight: 500,
                    }}>
                      {renderedUnauthText}
                    </span>
                  )
                ) : (
                  <span className="text-4xl font-normal text-neutral-500 max-w-xl block text-center leading-snug" style={{
                    fontFamily: "'Indie Flower', cursive",
                    fontWeight: 500,
                  }}>
                    Merhaba!
                  </span>
                )}
              </h1>
            </div>
            <div className="w-full max-w-2xl">{inputForm}</div>
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-2xl space-y-5">
                {messages.map((m, i) => {
                  const isLast = i === messages.length - 1;
                  const isStreaming = isLast && thinking && m.role === "agent";
                  return (
                    <div key={m.id} data-msg-id={m.id} className="mb-0">
                      <MessageBubble
                        msg={m}
                        chatId={chatId ?? ""}
                        isStreaming={isStreaming}
                        onToggleAction={chatId ? (idx) => toggleToolCollapse(chatId, m.id, idx) : undefined}
                      />
                    </div>
                  );
                })}

                {thinking && messages[messages.length - 1]?.text === "" && !messages[messages.length - 1]?.thinkingContent && (
                  <div className="flex items-center gap-2 text-sm text-text-faint">
                    <Loader
                      size={16}
                      strokeWidth={1.4}
                      className="animate-spin"
                    />
                    <span>{thinkingStatus || "Model hazırlanıyor..."}</span>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="px-6 pb-5">
              <div className="mx-auto max-w-2xl">{inputForm}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
