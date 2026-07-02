import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ModalOverlay } from "../shared/ModalOverlay";
import {
  Download,
  X,
  Loader2,
  Search,
  Eye,
  Wrench,
  Brain,
  ArrowDownToLine,
  CheckCircle2,
  Settings2,
  Sparkles,
  MessageSquare,
  AlignLeft,
  Rocket,
} from "lucide-react";
import { useModelStore } from "../../stores/modelStore";
import { useUiStore } from "../../stores/uiStore";
import { ipc } from "../../lib/ipc";
import { lookupContextWindow, formatContext } from "./modelCatalog";
import type { HardwareProfile, LibraryModel, MemoryEstimate } from "../../types";

// Yetenek bazlı filtreler (çoklu seçilebilir)
const FILTER_CAPS = ["vision", "tools", "thinking", "embedding", "audio"] as const;

const PAGE_SIZE = 20;

function capabilityIcon(cap: string) {
  switch (cap) {
    case "vision":
      return <Eye size={10} strokeWidth={1.6} />;
    case "tools":
      return <Wrench size={10} strokeWidth={1.6} />;
    case "thinking":
      return <Brain size={10} strokeWidth={1.6} />;
    case "embedding":
      return <Sparkles size={10} strokeWidth={1.6} />;
    default:
      return <MessageSquare size={10} strokeWidth={1.6} />;
  }
}

const CAP_LABELS: Record<string, string> = {
  vision: "Görsel",
  tools: "Araçlar",
  thinking: "Düşünme",
  embedding: "Gömme",
  audio: "Ses",
  cloud: "Bulut",
};

const CAP_COLORS: Record<string, string> = {
  vision: "bg-blue-500/10 text-blue-400",
  tools: "bg-amber-500/10 text-amber-400",
  thinking: "bg-purple-500/10 text-purple-400",
  embedding: "bg-emerald-500/10 text-emerald-400",
  audio: "bg-pink-500/10 text-pink-400",
};

export function ModelExplore() {
  const [search, setSearch] = useState("");
  const [activeCaps, setActiveCaps] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<LibraryModel | null>(null);
  const [hw, setHw] = useState<HardwareProfile | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [catalog, setCatalog] = useState<LibraryModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const installedModels = useModelStore((s) => s.models);
  const ollamaOnline = useModelStore((s) => s.ollamaOnline);
  const checkLifecycle = useModelStore((s) => s.checkOllamaLifecycle);
  const loadModels = useModelStore((s) => s.loadModels);
  const setView = useUiStore((s) => s.setView);

  useEffect(() => {
    void checkLifecycle();
    void loadModels();
    ipc.hardwareProfile().then(setHw).catch(() => { });
    setCatalogLoading(true);
    ipc
      .ollamaLibrary()
      .then((models) => {
        setCatalog(models);
        setCatalogLoading(false);
      })
      .catch((e) => {
        setCatalogError(String(e));
        setCatalogLoading(false);
      });
  }, [checkLifecycle, loadModels]);

  const ollamaModels = useMemo(
    () => installedModels.filter((m) => m.provider === "ollama"),
    [installedModels],
  );
  const installedIds = useMemo(
    () => new Set(ollamaModels.map((m) => m.id.split(":")[0])),
    [ollamaModels],
  );
  const installedFullIds = useMemo(
    () => new Set(ollamaModels.map((m) => m.id)),
    [ollamaModels],
  );

  // Katalogda gerçekten bulunan yetenekler → yalnızca anlamlı filtre çiplerini göster
  const availableCaps = useMemo(() => {
    const present = new Set<string>();
    for (const m of catalog) for (const c of m.capabilities) present.add(c);
    return FILTER_CAPS.filter((c) => present.has(c));
  }, [catalog]);

  function toggleCap(cap: string) {
    setActiveCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }

  const filtered = useMemo(() => {
    setVisibleCount(PAGE_SIZE);
    const q = search.trim().toLowerCase();
    return catalog.filter((m) => {
      // Tüm seçili yetenekler modelde olmalı (AND)
      for (const cap of activeCaps) {
        if (!m.capabilities.includes(cap)) return false;
      }
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.capabilities.some((c) => c.toLowerCase().includes(q)) ||
        m.sizes.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [search, catalog, activeCaps]);

  const visibleModels = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  return (
    <div className="h-full overflow-y-auto p-6" style={{ scrollbarWidth: "none" }}>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">
            Modeller{!catalogLoading && catalog.length > 0 && ` (${filtered.length})`}
          </h1>
          <p className="mt-0.5 text-[0.9286rem] text-text-faint">
            Keşfet, indir ve yerel olarak çalıştır
          </p>
        </div>
        <div style={{
          display: "flex",
          flexDirection: "row",
          gap: ".5rem",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <button
            onClick={() => setView("accelerate" as any)}
            className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-3.5 py-2 text-[0.9286rem] text-text-secondary transition-all duration-200 hover:bg-surface-3 hover:text-text"
          >
            <Rocket size={14} strokeWidth={1.4} />
            Hızlandır
          </button>
          <button
            onClick={() => setView("models-manage" as any)}
            className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-3.5 py-2 text-[0.9286rem] text-text-secondary transition-all duration-200 hover:bg-surface-3 hover:text-text"
          >
            <Settings2 size={14} strokeWidth={1.4} />
            Düzenle
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
        <Search size={14} strokeWidth={1.4} className="text-text-faint" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Model ara..."
          className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
        />
      </div>

      {/* Filters */}
      {availableCaps.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          {availableCaps.map((cap) => {
            const active = activeCaps.has(cap);
            return (
              <button
                key={cap}
                onClick={() => toggleCap(cap)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.7857rem] font-medium transition-colors ${active
                    ? CAP_COLORS[cap] ?? "bg-surface-3 text-text"
                    : "bg-surface-2 text-text-faint hover:bg-surface-3 hover:text-text-secondary"
                  }`}
              >
                {capabilityIcon(cap)}
                {CAP_LABELS[cap] ?? cap}
              </button>
            );
          })}
          {activeCaps.size > 0 && (
            <button
              onClick={() => setActiveCaps(new Set())}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[0.7857rem] text-text-faint transition-colors hover:text-text-secondary"
            >
              <X size={11} strokeWidth={1.6} />
              Temizle
            </button>
          )}
        </div>
      )}

      {/* Status */}
      {!ollamaOnline && (
        <div className="mb-4 rounded-xl bg-warn/8 px-3.5 py-2.5 text-[0.9286rem] text-warn">
          Ollama çalışmıyor — model indirmek için önce Ollama'yı başlat.
        </div>
      )}

      {/* Loading skeleton */}
      {catalogLoading && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4"
            >
              <div className="space-y-2">
                <div className="h-4 w-28 animate-pulse rounded bg-hover" />
                <div className="h-3 w-full animate-pulse rounded bg-hover" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-hover" />
              </div>
              <div className="flex gap-1.5">
                <div className="h-5 w-14 animate-pulse rounded-md bg-hover" />
                <div className="h-5 w-16 animate-pulse rounded-md bg-hover" />
              </div>
              <div className="flex gap-1.5">
                <div className="h-5 w-8 animate-pulse rounded bg-hover" />
                <div className="h-5 w-8 animate-pulse rounded bg-hover" />
                <div className="h-5 w-8 animate-pulse rounded bg-hover" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {catalogError && !catalogLoading && (
        <div className="py-16 text-center">
          <p className="mb-2 text-sm text-danger">Model kataloğu yüklenemedi</p>
          <p className="text-[0.8571rem] text-text-faint">{catalogError}</p>
          <button
            onClick={() => {
              setCatalogLoading(true);
              setCatalogError(null);
              ipc
                .ollamaLibrary()
                .then((models) => {
                  setCatalog(models);
                  setCatalogLoading(false);
                })
                .catch((e) => {
                  setCatalogError(String(e));
                  setCatalogLoading(false);
                });
            }}
            className="mt-3 rounded-lg bg-surface-2 px-4 py-2 text-[0.9286rem] text-text-secondary transition-colors hover:bg-surface-3"
          >
            Tekrar Dene
          </button>
        </div>
      )}

      {/* Grid */}
      {!catalogLoading && !catalogError && (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleModels.map((model) => {
              const installed = installedIds.has(model.id);

              return (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model)}
                  className="group relative flex flex-col gap-2.5 rounded-2xl bg-surface-2 p-4 text-left transition-all duration-200 hover:bg-surface-3"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[1rem] font-medium text-text">{model.id}</span>
                        {installed && (
                          <CheckCircle2 size={13} strokeWidth={1.6} className="shrink-0 text-success" />
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[0.8571rem] leading-relaxed text-text-faint">
                        {model.description}
                      </p>
                    </div>
                  </div>

                  {/* Tags row */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {model.capabilities
                      .filter((c) => c !== "cloud" && c !== "e2b" && c !== "e4b")
                      .map((cap) => (
                        <span
                          key={cap}
                          className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7143rem] font-medium ${CAP_COLORS[cap] ?? "bg-surface-3 text-text-faint"}`}
                        >
                          {capabilityIcon(cap)}
                          {CAP_LABELS[cap] ?? cap}
                        </span>
                      ))}
                    {(() => {
                      const ctx = lookupContextWindow(model.id);
                      return ctx ? (
                        <span className="flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[0.7143rem] text-text-faint" title={`${ctx.toLocaleString()} token bağlam`}>
                          <AlignLeft size={9} strokeWidth={1.6} />
                          {formatContext(ctx)}
                        </span>
                      ) : null;
                    })()}
                    <span className="flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[0.7143rem] text-text-faint">
                      <ArrowDownToLine size={9} strokeWidth={1.6} />
                      {model.pulls}
                    </span>
                  </div>

                  {/* Sizes preview */}
                  {model.sizes.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[0.7857rem] text-text-faint">
                      {model.sizes.slice(0, 4).map((s) => (
                        <span key={s} className="rounded bg-surface px-1.5 py-0.5">
                          {s}
                        </span>
                      ))}
                      {model.sizes.length > 4 && (
                        <span className="text-text-faint">+{model.sizes.length - 4}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {visibleCount < filtered.length && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="rounded-xl bg-surface-2 px-5 py-2.5 text-[0.9286rem] text-text-secondary transition-colors hover:bg-surface-3 hover:text-text"
              >
                Daha Fazla Göster ({filtered.length - visibleCount} model kaldı)
              </button>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-text-faint">
              Aradığın modeli bulamadık.
            </div>
          )}
        </>
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {selectedModel && (
          <ModelDetailModal
            model={selectedModel}
            hw={hw}
            installedIds={installedIds}
            installedFullIds={installedFullIds}
            ollamaOnline={ollamaOnline}
            onClose={() => setSelectedModel(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Fit assessment ---------------------------------------------------------

type FitLevel = "great" | "ok" | "tight" | "no";

interface VariantFit {
  estimate: MemoryEstimate;
  level: FitLevel;
}

function assessFit(est: MemoryEstimate, hw: HardwareProfile | null): FitLevel {
  if (!hw) return "ok";
  // Tamamen GPU belleğine sığıyor → en hızlı
  if (est.fitsVram) return "great";
  // VRAM yok ama RAM'e rahat sığıyor (toplam RAM'in %70'inden az) → çalışır
  if (est.fitsRam) {
    const ratio = est.totalMb / hw.totalRamMb;
    return ratio <= 0.7 ? "ok" : "tight";
  }
  return "no";
}

const FIT_META: Record<FitLevel, { label: string; cls: string; dot: string }> = {
  great: { label: "Mükemmel", cls: "text-emerald-400", dot: "bg-emerald-400" },
  ok: { label: "İyi çalışır", cls: "text-blue-400", dot: "bg-blue-400" },
  tight: { label: "Yavaş olabilir", cls: "text-amber-400", dot: "bg-amber-400" },
  no: { label: "Yetersiz bellek", cls: "text-red-400", dot: "bg-red-400" },
};

function formatGb(mb: number): string {
  const gb = mb / 1024;
  return gb >= 10 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
}

function translatePullStatus(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("manifest")) return "Manifest alınıyor";
  if (s.includes("downloading") || s.includes("pulling")) return "İndiriliyor";
  if (s.includes("verifying")) return "Doğrulanıyor";
  if (s.includes("writing")) return "Yazılıyor";
  if (s.includes("success")) return "Tamamlandı";
  return status || "İndiriliyor";
}

// ---- Detail Modal -----------------------------------------------------------

function ModelDetailModal({
  model,
  hw,
  installedIds,
  installedFullIds,
  ollamaOnline,
  onClose,
}: {
  model: LibraryModel;
  hw: HardwareProfile | null;
  installedIds: Set<string>;
  installedFullIds: Set<string>;
  ollamaOnline: boolean;
  onClose: () => void;
}) {
  const pullModel = useModelStore((s) => s.pullModel);
  const pulling = useModelStore((s) => s.pulling);
  const pullProgress = useModelStore((s) => s.pullProgress);
  const [pullingTag, setPullingTag] = useState<string | null>(null);
  const [fits, setFits] = useState<Record<string, VariantFit>>({});

  const installed = installedIds.has(model.id);

  // Her boyut varyantı için bellek tahmini çek + cihaza uyumunu değerlendir
  useEffect(() => {
    let cancelled = false;
    setFits({});
    if (model.sizes.length === 0) return;

    (async () => {
      const results = await Promise.all(
        model.sizes.map(async (sizeTag) => {
          try {
            const estimate = await ipc.memoryEstimate({
              hwOverride: hw ?? undefined,
              paramCount: sizeTag,
            });
            return [sizeTag, { estimate, level: assessFit(estimate, hw) }] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, VariantFit> = {};
      for (const r of results) if (r) map[r[0]] = r[1];
      setFits(map);
    })();

    return () => { cancelled = true; };
  }, [model.id, model.sizes, hw]);

  async function handlePull(sizeTag: string) {
    const tag = `${model.id}:${sizeTag}`;
    setPullingTag(tag);
    await pullModel("ollama", tag);
    setPullingTag(null);
  }

  return (
    <ModalOverlay onClose={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 pb-4 pt-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text">{model.id}</h2>
              {installed && (
                <span className="rounded bg-success/15 px-1.5 py-0.5 text-[0.7143rem] font-medium text-success">
                  Yüklü
                </span>
              )}
            </div>
            <p className="mt-1 text-[0.9286rem] leading-relaxed text-text-secondary">
              {model.description}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong"
          >
            <X size={14} strokeWidth={1.4} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: "thin" }}>
          {/* Capabilities */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {model.capabilities
              .filter((c) => c !== "cloud" && c !== "e2b" && c !== "e4b")
              .map((cap) => (
                <span
                  key={cap}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[0.7857rem] font-medium ${CAP_COLORS[cap] ?? "bg-surface-2 text-text-faint"}`}
                >
                  {capabilityIcon(cap)}
                  {CAP_LABELS[cap] ?? cap}
                </span>
              ))}
            {(() => {
              const ctx = lookupContextWindow(model.id);
              return ctx ? (
                <span className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-[0.7857rem] text-text-faint" title={`${ctx.toLocaleString()} token bağlam penceresi`}>
                  <AlignLeft size={11} strokeWidth={1.6} />
                  {formatContext(ctx)} bağlam
                </span>
              ) : null;
            })()}
            <span className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-[0.7857rem] text-text-faint">
              <ArrowDownToLine size={11} strokeWidth={1.6} />
              {model.pulls} indirme
            </span>
            {model.updated && (
              <span className="rounded-lg bg-surface-2 px-2 py-1 text-[0.7857rem] text-text-faint">
                {model.updated}
              </span>
            )}
          </div>

          {/* Hardware */}
          {hw && (
            <div className="mb-4 rounded-xl bg-surface-2 p-3">
              <div className="mb-2 text-[0.7143rem] font-medium uppercase tracking-widest text-text-faint">
                Sistem Bilgisi
              </div>
              <div className="flex items-center gap-4 text-[0.8571rem] text-text-secondary">
                {hw.gpuName && (
                  <span>GPU: {hw.gpuName} ({hw.gpuVramMb ? `${(hw.gpuVramMb / 1024).toFixed(0)} GB` : "?"})</span>
                )}
                <span>RAM: {(hw.totalRamMb / 1024).toFixed(0)} GB</span>
              </div>
            </div>
          )}

          {/* Variants */}
          {model.sizes.length > 0 && (
            <>
              <div className="mb-2 text-[0.7143rem] font-medium uppercase tracking-widest text-text-faint">
                Boyutlar
              </div>
              <div className="space-y-1.5">
                {model.sizes.map((sizeTag) => {
                  const fullTag = `${model.id}:${sizeTag}`;
                  const isPulling = pullingTag === fullTag || pulling === fullTag;
                  const variantInstalled =
                    installedFullIds.has(fullTag) ||
                    installedFullIds.has(`${model.id}:${sizeTag}-latest`);
                  const fit = fits[sizeTag];
                  const progress = pullProgress[fullTag];

                  return (
                    <div
                      key={sizeTag}
                      className="rounded-xl bg-surface-2 px-3.5 py-3 transition-colors hover:bg-surface-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[0.9286rem] font-medium text-text">
                              {sizeTag}
                            </span>
                            {variantInstalled && (
                              <CheckCircle2 size={12} strokeWidth={1.6} className="text-success" />
                            )}
                          </div>
                          {fit && !isPulling && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${FIT_META[fit.level].dot}`} />
                              <span className={`text-[0.7857rem] ${FIT_META[fit.level].cls}`}>
                                {FIT_META[fit.level].label}
                              </span>
                              <span className="text-[0.7857rem] text-text-faint">
                                · ~{formatGb(fit.estimate.totalMb)} bellek
                              </span>
                            </div>
                          )}
                        </div>

                        {variantInstalled ? (
                          <span className="flex h-8 items-center gap-1.5 rounded-lg bg-success/10 px-3 text-[0.8571rem] text-success">
                            <CheckCircle2 size={13} strokeWidth={1.4} />
                            Yüklü
                          </span>
                        ) : (
                          <button
                            onClick={() => handlePull(sizeTag)}
                            disabled={!ollamaOnline || isPulling}
                            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-surface-3 px-3 text-[0.8571rem] text-text-secondary transition-colors hover:bg-hover-strong hover:text-text disabled:opacity-40"
                          >
                            {isPulling ? (
                              <>
                                <Loader2 size={13} strokeWidth={1.4} className="animate-spin" />
                                {progress && progress.percent >= 0 ? `%${progress.percent}` : "İndiriliyor"}
                              </>
                            ) : (
                              <>
                                <Download size={13} strokeWidth={1.4} />
                                İndir
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {isPulling && progress && (
                        <div className="mt-2.5">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                            {progress.percent >= 0 ? (
                              <div
                                className="h-full rounded-full bg-blue-400 transition-all duration-300"
                                style={{ width: `${progress.percent}%` }}
                              />
                            ) : (
                              <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400/60" />
                            )}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[0.7143rem] text-text-faint">
                            <span>{translatePullStatus(progress.status)}</span>
                            {progress.total > 0 && (
                              <span className="font-mono">
                                {formatGb(progress.completed / 1024 / 1024)} / {formatGb(progress.total / 1024 / 1024)}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {model.sizes.length === 0 && (
            <div className="rounded-xl bg-surface-2 p-4 text-center text-[0.9286rem] text-text-faint">
              Bu model için boyut bilgisi mevcut değil. Terminalde{" "}
              <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.8571rem]">
                ollama pull {model.id}
              </code>{" "}
              ile indirebilirsin.
            </div>
          )}
        </div>
      </motion.div>
    </ModalOverlay>
  );
}
