import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Rocket,
  Zap,
  Database,
  Layers,
  Loader2,
  Box,
  CheckCircle2,
  AlertTriangle,
  Gauge,
  ChevronRight,
  Download,
  ArrowLeft,
} from "lucide-react";
import { PageHeader } from "../shared/PageHeader";
import { ModalOverlay } from "../shared/ModalOverlay";
import { useModelStore } from "../../stores/modelStore";
import { useOptimizationStore } from "../../stores/optimizationStore";
import { ipc } from "../../lib/ipc";
import type { ModelInfo } from "../../types";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

// Quantization hedefleri (kaynak F16/F32 olmalı)
const QUANT_TARGETS = [
  { id: "q8_0", label: "Q8_0", descKey: "accelerate.q8Desc" },
  { id: "q5_K_M", label: "Q5_K_M", descKey: "accelerate.q5Desc" },
  { id: "q4_K_M", label: "Q4_K_M", descKey: "accelerate.q4Desc" },
  { id: "q3_K_M", label: "Q3_K_M", descKey: "accelerate.q3Desc" },
];

const KV_TYPES = [
  { id: "f16", label: "F16", descKey: "accelerate.kvF16Desc" },
  { id: "q8_0", label: "Q8_0", descKey: "accelerate.kvQ8Desc" },
  { id: "q4_0", label: "Q4_0", descKey: "accelerate.kvQ4Desc" },
];

function isF16(quant?: string | null) {
  if (!quant) return false;
  const q = quant.toUpperCase();
  return q.includes("F16") || q.includes("F32") || q.includes("FP16") || q.includes("BF16");
}

function progressBar(p: { status: string; completed: number; total: number; percent: number } | undefined) {
  if (!p) return null;
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        {p.percent >= 0 ? (
          <div className="h-full rounded-full bg-blue-400 transition-all duration-300" style={{ width: `${p.percent}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400/60" />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[0.7143rem] text-text-faint">
        <span>{p.status}</span>
        <span className="font-mono">{p.percent >= 0 ? `%${p.percent}` : ""}</span>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  subtitle,
  children,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${accent ?? "bg-blue-500/15 text-blue-400"}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <p className="mt-0.5 text-[0.8571rem] leading-relaxed text-text-faint">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function AcceleratePage() {
  const t = useT();
  const models = useModelStore((s) => s.models);
  const loadModels = useModelStore((s) => s.loadModels);
  const checkOllama = useModelStore((s) => s.checkOllama);
  const ollamaOnline = useModelStore((s) => s.ollamaOnline);
  const quantizeModel = useModelStore((s) => s.quantizeModel);
  const quantizeProgress = useModelStore((s) => s.quantizeProgress);
  const quantizing = useModelStore((s) => s.quantizing);
  const pullModel = useModelStore((s) => s.pullModel);
  const pullProgress = useModelStore((s) => s.pullProgress);

  const config = useOptimizationStore((s) => s.config);
  const loadConfig = useOptimizationStore((s) => s.loadConfig);
  const saveConfig = useOptimizationStore((s) => s.saveConfig);
  const setPreset = useOptimizationStore((s) => s.setPreset);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetQuant, setTargetQuant] = useState("q4_K_M");
  const [f16Modal, setF16Modal] = useState(false);
  const [f16Tag, setF16Tag] = useState("");
  const [f16Suggestions, setF16Suggestions] = useState<string[]>([]);
  const [f16Loading, setF16Loading] = useState(false);
  const [kvTarget, setKvTarget] = useState<string>("f16");
  const [restartModal, setRestartModal] = useState<null | "kv" | "speed">(null);
  const [restarting, setRestarting] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ollamaModels = useMemo(
    () => models.filter((m) => m.provider === "ollama"),
    [models],
  );

  useEffect(() => {
    void checkOllama();
    void loadModels();
    void loadConfig();
  }, [checkOllama, loadModels, loadConfig]);

  useEffect(() => {
    if (config?.kvCacheType) setKvTarget(config.kvCacheType);
  }, [config?.kvCacheType]);

  const selected: ModelInfo | undefined = ollamaModels.find((m) => m.id === selectedId);
  const targetTag = selected ? `${selected.id}-${targetQuant.toLowerCase().replace(/_/g, "")}` : "";
  const activeQuantProgress = targetTag ? quantizeProgress[targetTag] : undefined;
  const f16PullProgress = f16Tag ? pullProgress[f16Tag] : undefined;
  const isBusy = !!quantizing || !!busyMsg;

  async function runQuantize(fromTag: string) {
    setErr(null);
    try {
      await quantizeModel(fromTag, targetTag, targetQuant);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function onQuantizeClick() {
    if (!selected) return;
    if (isF16(selected.quantization)) {
      void runQuantize(selected.id);
      return;
    }
    // Kaynak F16 değil → registry'den gerçek F16 tag'lerini bul, kullanıcıya sun
    setErr(null);
    setF16Suggestions([]);
    setF16Tag(`${selected.id}-fp16`); // yedek tahmin
    setF16Modal(true);
    setF16Loading(true);
    try {
      const size = selected.id.includes(":") ? selected.id.split(":").slice(1).join(":").toLowerCase() : "";
      const tags = await ipc.ollamaRegistryTags(selected.id); // tam tag'ler döner
      const f16re = /(fp16|bf16|f16)/i;
      const incompatible = /(mlx|mxfp|nvfp|cloud|qat)/i; // Ollama quantize için uygun değil
      const cand = tags.filter((t) => f16re.test(t) && !incompatible.test(t));
      const sized = cand.filter((t) => !size || t.toLowerCase().includes(size));
      const picks = (sized.length ? sized : cand)
        // instruct (-it-) varyantını öne al
        .sort((a, b) => (b.includes("-it-") ? 1 : 0) - (a.includes("-it-") ? 1 : 0));
      if (picks.length) {
        setF16Suggestions(picks);
        setF16Tag(picks[0]);
      }
    } catch {
      // Registry'de yok (özel/yerel model) — yedek tahmin kalır, kullanıcı düzenleyebilir
    } finally {
      setF16Loading(false);
    }
  }

  async function confirmF16Download() {
    setF16Modal(false);
    setErr(null);
    setBusyMsg(t("accelerate.busyF16"));
    try {
      await pullModel("ollama", f16Tag);
      setBusyMsg(null);
      await runQuantize(f16Tag);
    } catch (e) {
      setBusyMsg(null);
      setErr(t("accelerate.f16Failed", { err: String(e) }));
    }
  }

  async function applyKvCache() {
    if (!config) return;
    setRestarting(true);
    setErr(null);
    try {
      await saveConfig({
        ...config,
        kvCacheType: kvTarget,
        // KV cache quantization flash attention gerektirir
        flashAttention: kvTarget === "f16" ? config.flashAttention : true,
      });
      await ipc.ollamaRestart();
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await ipc.ollamaStatus()) break;
      }
      await checkOllama();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRestarting(false);
      setRestartModal(null);
    }
  }

  async function applySpeedProfile() {
    setRestarting(true);
    setErr(null);
    try {
      await setPreset("hiz"); // flash attention'ı da açar
      await ipc.ollamaRestart();
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await ipc.ollamaStatus()) break;
      }
      await checkOllama();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRestarting(false);
      setRestartModal(null);
    }
  }

  const setView = useUiStore((s) => s.setView);

  return (
    <div className="h-full overflow-y-auto p-6" style={{ scrollbarWidth: "none" }}>
      <div className="mb-2 flex items-center gap-3">
        <button
          onClick={() => setView("models")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong hover:text-text"
        >
          <ArrowLeft size={16} strokeWidth={1.4} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-text">{t("accelerate.title")}</h1>
        </div>
      </div>
      <PageHeader
        title={t("models.accelerate")}
        subtitle={t("accelerate.subtitle")}
      />

      {!ollamaOnline && (
        <div className="mb-4 rounded-xl bg-warn/8 px-3.5 py-2.5 text-[0.9286rem] text-warn">
          {t("accelerate.ollamaNotRunning")}
        </div>
      )}

      {err && (
        <div className="mb-4 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-[0.9286rem] text-red-400">
          {err}
        </div>
      )}

      {/* Model seçici */}
      <div className="mb-5">
        <div className="mb-2 text-[0.7143rem] font-medium uppercase tracking-widest text-text-faint">
          {t("accelerate.selectModel")}
        </div>
        {ollamaModels.length === 0 ? (
          <div className="rounded-xl bg-surface-2 py-8 text-center text-xs text-text-faint">
            {t("accelerate.noModels")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {ollamaModels.map((m) => {
              const active = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  onClick={() => { setSelectedId(m.id); setErr(null); }}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${active ? "bg-accent/15 ring-1 ring-accent/30" : "bg-surface-2 hover:bg-surface-3"
                    }`}
                >
                  <Box size={14} strokeWidth={1.5} className={active ? "text-accent" : "text-text-faint"} />
                  <div className="min-w-0">
                    <div className="truncate text-[0.9286rem] text-text">{m.id}</div>
                    {m.quantization && (
                      <div className="text-[0.7143rem] text-text-faint">{m.quantization}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="space-y-3">
          {/* Quantization */}
          <Card
            icon={<Layers size={18} strokeWidth={1.6} />}
            title="Quantization"
            subtitle={t("accelerate.quantSubtitle", { current: selected.quantization ?? t("accelerate.currentUnknown") })}
          >
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {QUANT_TARGETS.map((q) => {
                const on = targetQuant === q.id;
                return (
                  <button
                    key={q.id}
                    onClick={() => setTargetQuant(q.id)}
                    title={t(q.descKey)}
                    className={`rounded-lg px-2 py-2 text-center transition-colors ${on ? "bg-accent/15 text-accent ring-1 ring-accent/30" : "bg-surface-2 text-text-secondary hover:bg-surface-3"
                      }`}
                  >
                    <div className="text-[0.8571rem] font-medium">{q.label}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[0.7857rem] text-text-faint">{t(QUANT_TARGETS.find((q) => q.id === targetQuant)?.descKey ?? "")}</p>

            {(activeQuantProgress || f16PullProgress) ? (
              progressBar(f16PullProgress ?? activeQuantProgress)
            ) : (
              <button
                onClick={onQuantizeClick}
                disabled={!ollamaOnline || isBusy}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent/15 py-2.5 text-sm text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
              >
                <Rocket size={14} strokeWidth={1.6} />
                {t("accelerate.accelerateAs", { tag: targetTag || "model" })}
              </button>
            )}
            {busyMsg && <p className="mt-2 text-[0.7857rem] text-text-faint">{busyMsg}</p>}
          </Card>

          {/* KV-cache quantization */}
          <Card
            icon={<Database size={18} strokeWidth={1.6} />}
            title="KV-cache Quantization"
            subtitle={t("accelerate.kvSubtitle")}
            accent="bg-purple-500/15 text-purple-400"
          >
            <div className="grid grid-cols-3 gap-1.5">
              {KV_TYPES.map((k) => {
                const on = kvTarget === k.id;
                return (
                  <button
                    key={k.id}
                    onClick={() => setKvTarget(k.id)}
                    title={t(k.descKey)}
                    className={`rounded-lg px-2 py-2 text-center transition-colors ${on ? "bg-purple-500/15 text-purple-300 ring-1 ring-purple-400/30" : "bg-surface-2 text-text-secondary hover:bg-surface-3"
                      }`}
                  >
                    <div className="text-[0.8571rem] font-medium">{k.label}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[0.7857rem] text-text-faint">{t(KV_TYPES.find((k) => k.id === kvTarget)?.descKey ?? "")}</p>
            {kvTarget !== "f16" && !config?.flashAttention && (
              <div className="mt-2 flex items-center gap-1.5 text-[0.7857rem] text-amber-400">
                <AlertTriangle size={12} /> {t("accelerate.flashRequired")}
              </div>
            )}
            <button
              onClick={() => setRestartModal("kv")}
              disabled={!ollamaOnline || (config?.kvCacheType ?? "f16") === kvTarget}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-500/15 py-2.5 text-sm text-purple-300 transition-colors hover:bg-purple-500/25 disabled:opacity-40"
            >
              <Database size={14} strokeWidth={1.6} />
              {t("accelerate.applyRestart")}
            </button>
          </Card>

          {/* Flash Attention + optimum */}
          <Card
            icon={<Zap size={18} strokeWidth={1.6} />}
            title={t("accelerate.flashSetTitle")}
            subtitle={t("accelerate.autoSubtitle")}
            accent="bg-amber-500/15 text-amber-400"
          >
            <div className="flex items-center gap-2 text-[0.7857rem] text-text-faint">
              <Gauge size={12} />
              {t("accelerate.flashStatusLabel")} {config?.flashAttention ? t("accelerate.flashOn") : t("accelerate.flashOff")} · {t("accelerate.profileLabel")} {config?.preset ?? "—"}
            </div>
            <button
              onClick={() => setRestartModal("speed")}
              disabled={!ollamaOnline}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500/15 py-2.5 text-sm text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-40"
            >
              <Zap size={14} strokeWidth={1.6} />
              {t("accelerate.setFastest")}
            </button>
          </Card>

          {/* Speculative decoding (deneysel/devre dışı) */}
          <div className="rounded-2xl bg-surface p-4 opacity-60">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-text-faint">
                <ChevronRight size={18} strokeWidth={1.6} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text-secondary">Speculative Decoding</h3>
                  <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.6429rem] font-medium uppercase text-text-faint">
                    {t("accelerate.experimentalSoon")}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.8571rem] leading-relaxed text-text-faint">
                  {t("accelerate.draftDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* F16 indirme onay modalı */}
      <AnimatePresence>
        {f16Modal && selected && (
          <ModalOverlay onClose={() => setF16Modal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="mx-4 w-full max-w-md rounded-2xl border border-border bg-surface-2 p-5 shadow-xl max-h-[90vh] overflow-y-auto"
            >
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15">
                  <Download size={18} className="text-amber-400" />
                </div>
                <h3 className="text-sm font-semibold text-text">{t("accelerate.f16Needed")}</h3>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-text-faint">
                <span className="text-text-secondary">{selected.id}</span> {t("accelerate.f16ExplainMid")}
                ({selected.quantization ?? "?"}). {t("accelerate.f16ExplainRest")}
              </p>

              {f16Loading ? (
                <div className="mb-3 flex items-center gap-2 text-xs text-text-faint">
                  <Loader2 size={13} className="animate-spin" /> {t("accelerate.searchingTags")}
                </div>
              ) : f16Suggestions.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {f16Suggestions.map((t) => (
                    <button
                      key={t}
                      onClick={() => setF16Tag(t)}
                      className={`rounded-lg px-2.5 py-1 text-[0.7857rem] transition-colors ${f16Tag === t
                          ? "bg-accent/20 text-accent"
                          : "bg-surface-3 text-text-secondary hover:bg-hover"
                        }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-[0.7857rem] text-amber-400/80">
                  {t("accelerate.noF16Tag")}
                </p>
              )}

              <input
                value={f16Tag}
                onChange={(e) => setF16Tag(e.target.value)}
                className="mb-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
                placeholder={t("accelerate.f16Placeholder")}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setF16Modal(false)}
                  className="flex-1 rounded-xl bg-surface-3 py-2 text-sm text-text-secondary transition-colors hover:bg-hover"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={confirmF16Download}
                  disabled={!f16Tag.trim()}
                  className="flex-1 rounded-xl bg-accent/15 py-2 text-sm text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
                >
                  {t("accelerate.downloadAccelerate")}
                </button>
              </div>
            </motion.div>
          </ModalOverlay>
        )}
      </AnimatePresence>

      {/* Yeniden başlatma onay modalı (KV / hız) */}
      <AnimatePresence>
        {restartModal && (
          <ModalOverlay onClose={() => !restarting && setRestartModal(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-surface-2 p-5 shadow-xl max-h-[90vh] overflow-y-auto"
            >
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15">
                  <AlertTriangle size={18} className="text-amber-400" />
                </div>
                <h3 className="text-sm font-semibold text-text">{t("accelerate.restartQ")}</h3>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-text-faint">
                {t("accelerate.restartExplain")}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={restarting}
                  onClick={() => setRestartModal(null)}
                  className="flex-1 rounded-xl bg-surface-3 py-2 text-sm text-text-secondary transition-colors hover:bg-hover"
                >
                  {t("optimization.no")}
                </button>
                <button
                  disabled={restarting}
                  onClick={restartModal === "kv" ? applyKvCache : applySpeedProfile}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent/15 py-2 text-sm text-accent transition-colors hover:bg-accent/25"
                >
                  {restarting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t("optimization.restarting")}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      {t("accelerate.yesApply")}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </ModalOverlay>
        )}
      </AnimatePresence>
    </div>
  );
}
