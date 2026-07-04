import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ModalOverlay } from "../shared/ModalOverlay";
import {
  Plus,
  Trash2,
  Check,
  Download,
  Wifi,
  WifiOff,
  Cloud,
  HardDrive,
  X,
  Loader2,
  Key,
  ChevronDown,
  ChevronUp,
  Info,
  Cpu,
  Layers,
  ArrowLeft,
} from "lucide-react";
import { HardwarePanel } from "./HardwarePanel";
import { OptimizationPanel } from "./OptimizationPanel";
import { useModelStore } from "../../stores/modelStore";
import { useUiStore } from "../../stores/uiStore";
import { ipc } from "../../lib/ipc";
import { useT } from "../../i18n";
import type {
  ModelInfo,
  ModelDetail,
  CloudProviderConfig,
  CloudModelDef,
} from "../../types";

// ---- Tabs ------------------------------------------------------------------

const TABS = [
  { id: "ollama", label: "Ollama", icon: HardDrive },
  { id: "cloud", label: "Cloud API", icon: Cloud },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ---- Main ------------------------------------------------------------------

export function ModelManage() {
  const t = useT();
  const [tab, setTab] = useState<TabId>("ollama");
  const setView = useUiStore((s) => s.setView);

  const loadModels = useModelStore((s) => s.loadModels);
  const checkLifecycle = useModelStore((s) => s.checkOllamaLifecycle);
  const loadCloud = useModelStore((s) => s.loadCloudProviders);

  useEffect(() => {
    void checkLifecycle();
    void loadModels();
    void loadCloud();
  }, [checkLifecycle, loadModels, loadCloud]);

  return (
    <div
      className="h-full overflow-y-auto p-6"
      style={{ scrollbarWidth: "none" }}
    >
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => setView("models")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong hover:text-text"
        >
          <ArrowLeft size={16} strokeWidth={1.4} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-text">{t("models.manageTitle")}</h1>
        </div>
      </div>

      <HardwarePanel />
      <OptimizationPanel />

      {/* Tab bar */}
      <div className="mb-4 mt-5 flex gap-1 rounded-lg bg-surface p-1">
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.9286rem] font-medium transition-colors duration-150 ${active
                  ? "text-text"
                  : "text-text-faint hover:text-text-secondary"
                }`}
            >
              {active && (
                <motion.div
                  layoutId="models-manage-tab"
                  className="absolute inset-0 rounded-lg bg-surface-3"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <Icon size={14} strokeWidth={1.4} />
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "ollama" && <OllamaSection />}
      {tab === "cloud" && <CloudSection />}
    </div>
  );
}

// ---- Ollama Section --------------------------------------------------------

function OllamaSection() {
  const t = useT();
  const ollamaOnline = useModelStore((s) => s.ollamaOnline);
  const ollamaStatus = useModelStore((s) => s.ollamaStatus);
  const ollamaInstalling = useModelStore((s) => s.ollamaInstalling);
  const ollamaStarting = useModelStore((s) => s.ollamaStarting);
  const installOllama = useModelStore((s) => s.installOllama);
  const startOllama = useModelStore((s) => s.startOllama);
  const models = useModelStore((s) => s.models);
  const loading = useModelStore((s) => s.loading);
  const error = useModelStore((s) => s.error);

  const ollamaModels = models.filter((m) => m.provider === "ollama");

  if (ollamaStatus && !ollamaStatus.installed) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-surface px-6 py-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2">
            <Download size={22} strokeWidth={1.3} className="text-text-faint" />
          </div>
          <h3 className="mb-1 text-[1rem] font-medium text-text">
            {t("models.ollamaNotInstalled")}
          </h3>
          <p className="mb-4 text-[0.9286rem] text-text-faint">
            {t("models.ollamaNeeded")}
            <br />
            {t("models.ollamaAutoInstall")}
          </p>
          <button
            onClick={installOllama}
            disabled={ollamaInstalling}
            className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-[0.9286rem] text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {ollamaInstalling ? (
              <>
                <Loader2 size={14} strokeWidth={1.4} className="animate-spin" />
                {t("models.installing")}
              </>
            ) : (
              <>
                <Download size={14} strokeWidth={1.4} />
                {t("models.installOllama")}
              </>
            )}
          </button>
          {ollamaInstalling && (
            <p className="mt-3 text-[0.7857rem] text-text-faint">
              {t("models.wingetNote")}
            </p>
          )}
        </div>
        {error && (
          <div className="rounded-xl bg-[rgba(248,113,113,0.06)] px-3.5 py-2.5 text-[0.9286rem] text-danger">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (ollamaStatus && ollamaStatus.installed && !ollamaOnline && ollamaStarting) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5">
          <Loader2 size={14} strokeWidth={1.4} className="animate-spin text-warn" />
          <span className="text-[0.9286rem] text-text-secondary">
            {t("models.ollamaStarting")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5">
        {ollamaOnline ? (
          <>
            <Wifi size={14} strokeWidth={1.4} className="text-success" />
            <span className="text-[0.9286rem] text-text-secondary">
              {t("models.ollamaRunning")}
            </span>
          </>
        ) : (
          <>
            <WifiOff size={14} strokeWidth={1.4} className="text-danger" />
            <span className="text-[0.9286rem] text-text-secondary">
              {t("models.ollamaNoConn")}
            </span>
            <button
              onClick={startOllama}
              className="ml-auto rounded-lg bg-surface-3 px-2.5 py-1 text-[0.7857rem] text-text-secondary transition-colors hover:bg-hover-strong hover:text-text"
            >
              {t("models.start")}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-[rgba(248,113,113,0.06)] px-3.5 py-2.5 text-[0.9286rem] text-danger">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2
            size={20}
            strokeWidth={1.4}
            className="animate-spin text-text-faint"
          />
        </div>
      )}

      {!loading && ollamaModels.length === 0 && (
        <div className="rounded-2xl bg-surface px-6 py-10 text-center text-sm text-text-faint">
          {ollamaOnline
            ? t("models.noModelsExplore")
            : t("models.ollamaFailed")}
        </div>
      )}

      {ollamaModels.length > 0 && (
        <div className="space-y-1">
          {ollamaModels.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Model Card ------------------------------------------------------------

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function ModelCard({ model }: { model: ModelInfo }) {
  const t = useT();
  const setActive = useModelStore((s) => s.setActive);
  const deleteModel = useModelStore((s) => s.deleteModel);
  const [confirming, setConfirming] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div
        className={`group flex items-center gap-3 rounded-xl px-3.5 py-3 transition-colors duration-150 ${model.isActive ? "bg-surface-2 ring-1 ring-border-hover" : "bg-surface-2 hover:bg-surface-3"
          }`}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-hover">
          {model.provider === "ollama" ? (
            <HardDrive size={14} strokeWidth={1.3} className="text-text-faint" />
          ) : (
            <Cloud size={14} strokeWidth={1.3} className="text-text-faint" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.9286rem] text-text">
              {model.displayName}
            </span>
            {model.isActive && (
              <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[0.7143rem] font-medium text-success">
                Aktif
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[0.7857rem] text-text-faint">
            {model.parameterCount && <span>{model.parameterCount}</span>}
            {model.quantization && (
              <button
                onClick={() => model.provider === "ollama" && setShowDetail(true)}
                className={`rounded px-1 py-0.5 transition-colors ${model.provider === "ollama"
                    ? "hover:bg-hover-strong hover:text-text-secondary cursor-pointer"
                    : ""
                  }`}
              >
                {model.quantization}
              </button>
            )}
            <span>{formatBytes(model.sizeBytes)}</span>
            {model.contextLength && <span>{(model.contextLength / 1024).toFixed(0)}K ctx</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {model.provider === "ollama" && (
            <button
              onClick={() => setShowDetail(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong hover:text-text-secondary"
              title={t("models.modelDetails")}
            >
              <Info size={14} strokeWidth={1.4} />
            </button>
          )}
          {!model.isActive && (
            <button
              onClick={() => setActive(model.provider, model.id)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong hover:text-success"
              title="Aktif yap"
            >
              <Check size={14} strokeWidth={1.4} />
            </button>
          )}
          {model.provider === "ollama" && (
            confirming ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    deleteModel(model.provider, model.id);
                    setConfirming(false);
                  }}
                  className="flex h-7 items-center gap-1 rounded-lg bg-danger/10 px-2 text-[0.7857rem] text-danger transition-colors hover:bg-danger/20"
                >
                  Sil
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong"
                >
                  <X size={12} strokeWidth={1.4} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong hover:text-danger"
                title="Modeli sil"
              >
                <Trash2 size={14} strokeWidth={1.4} />
              </button>
            )
          )}
        </div>
      </div>

      <AnimatePresence>
        {showDetail && (
          <ModelDetailDialog model={model} onClose={() => setShowDetail(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ---- Model Detail Dialog ---------------------------------------------------

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function ModelDetailDialog({ model, onClose }: { model: ModelInfo; onClose: () => void }) {
  const t = useT();
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc.modelShow(model.id).then(
      (d) => { if (!cancelled) { setDetail(d); setLoading(false); } },
      (e) => { if (!cancelled) { setError(String(e)); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [model.id]);

  return (
    <ModalOverlay onClose={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-md rounded-2xl bg-surface p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-text">{model.displayName}</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover-strong"
          >
            <X size={14} strokeWidth={1.4} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} strokeWidth={1.4} className="animate-spin text-text-faint" />
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-[rgba(248,113,113,0.06)] px-3.5 py-2.5 text-[0.9286rem] text-danger">
            {error}
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <DetailField icon={Layers} label="Aile" value={detail.family ?? "—"} />
              <DetailField icon={Cpu} label="Parametre" value={detail.parameterSize ?? "—"} />
              <DetailField icon={Info} label="Kuantizasyon" value={detail.quantizationLevel ?? "—"} />
              <DetailField icon={Info} label="Format" value={detail.format ?? "—"} />
              {detail.contextLength && (
                <DetailField icon={Info} label={t("models.contextLength")} value={`${(detail.contextLength / 1024).toFixed(0)}K token`} />
              )}
            </div>

            <div className="rounded-xl bg-surface-2 p-3.5">
              <div className="mb-2 text-[0.7857rem] font-medium uppercase tracking-widest text-text-faint">
                Bellek Tahmini
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[0.8571rem]">
                  <span className="text-text-secondary">Model Boyutu</span>
                  <span className="text-text">{formatMb(detail.memoryEstimate.modelSizeMb)}</span>
                </div>
                <div className="flex items-center justify-between text-[0.8571rem]">
                  <span className="text-text-secondary">KV Cache</span>
                  <span className="text-text">{formatMb(detail.memoryEstimate.kvCacheMb)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 text-[0.8571rem] font-medium">
                  <span className="text-text-secondary">Toplam</span>
                  <span className="text-text">{formatMb(detail.memoryEstimate.totalMb)}</span>
                </div>

                <div className="flex gap-2 pt-1">
                  <span
                    className={`rounded px-2 py-0.5 text-[0.7143rem] font-medium ${detail.memoryEstimate.fitsVram
                        ? "bg-success/15 text-success"
                        : "bg-warn/15 text-warn"
                      }`}
                  >
                    {detail.memoryEstimate.fitsVram ? t("models.fitsVram") : "VRAM yetersiz"}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[0.7143rem] font-medium ${detail.memoryEstimate.fitsRam
                        ? "bg-success/15 text-success"
                        : "bg-danger/15 text-danger"
                      }`}
                  >
                    {detail.memoryEstimate.fitsRam ? t("models.fitsRam") : "RAM yetersiz"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[0.7857rem]">
                  <span className="text-text-faint">{t("models.recommendedContext")}</span>
                  <span className="text-text-secondary">
                    {(detail.memoryEstimate.recommendedCtx / 1024).toFixed(0)}K token
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </ModalOverlay>
  );
}

function DetailField({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2">
      <Icon size={13} strokeWidth={1.3} className="mt-0.5 shrink-0 text-text-faint" />
      <div>
        <div className="text-[0.7143rem] text-text-faint">{label}</div>
        <div className="text-[0.8571rem] text-text">{value}</div>
      </div>
    </div>
  );
}

// ---- Cloud Section ---------------------------------------------------------

const CLOUD_PRESETS: Record<string, { label: string; defaultModels: CloudModelDef[] }> = {
  openai: {
    label: "OpenAI",
    defaultModels: [
      { id: "gpt-5.5", displayName: "GPT-5.5 (Frontier)", contextLength: 1048576 },
      { id: "gpt-5.5-pro", displayName: "GPT-5.5 Pro", contextLength: 1048576 },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", contextLength: 1048576 },
      { id: "gpt-5.4-nano", displayName: "GPT-5.4 Nano", contextLength: 1048576 },
      { id: "o1", displayName: "OpenAI o1 (Reasoning)", contextLength: 200000 },
      { id: "o3-mini", displayName: "OpenAI o3-mini", contextLength: 200000 },
      { id: "gpt-4o", displayName: "GPT-4o (Legacy Prod)", contextLength: 128000 },
      { id: "gpt-4o-mini", displayName: "GPT-4o Mini", contextLength: 128000 },
    ],
  },
  anthropic: {
    label: "Anthropic",
    defaultModels: [
      { id: "claude-fable-5", displayName: "Claude Fable 5", contextLength: 1048576 },
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", contextLength: 1048576 },
      { id: "claude-opus-4-8", displayName: "Claude Opus 4.8", contextLength: 1048576 },
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", contextLength: 1048576 },
      { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", contextLength: 1048576 },
      { id: "claude-haiku-4-5", displayName: "Claude 4.5 Haiku", contextLength: 200000 },
    ],
  },
  gemini: {
    label: "Gemini",
    defaultModels: [
      { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", contextLength: 1048576 },
      { id: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro (Preview)", contextLength: 1048576 },
      { id: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite", contextLength: 1048576 },
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", contextLength: 1048576 },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", contextLength: 1048576 },
    ],
  },
};

function CloudSection() {
  const t = useT();
  const cloudProviders = useModelStore((s) => s.cloudProviders);
  const models = useModelStore((s) => s.models);
  const saveCloud = useModelStore((s) => s.saveCloudProviders);
  const [showAdd, setShowAdd] = useState(false);

  const cloudModels = models.filter((m) => m.provider === "cloud");

  return (
    <div className="space-y-3">
      {cloudProviders.map((cfg, idx) => (
        <CloudProviderCard
          key={cfg.name}
          config={cfg}
          models={cloudModels.filter((m) => m.family === cfg.name)}
          onUpdate={(updated) => {
            const next = [...cloudProviders];
            next[idx] = updated;
            saveCloud(next);
          }}
          onRemove={() => {
            saveCloud(cloudProviders.filter((_, i) => i !== idx));
          }}
        />
      ))}

      {cloudProviders.length === 0 && !showAdd && (
        <div className="rounded-2xl bg-surface px-6 py-10 text-center text-sm text-text-faint">
          {t("models.noCloudProviders")}
        </div>
      )}

      <button
        onClick={() => setShowAdd(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-3 text-[0.9286rem] text-text-faint transition-colors hover:border-border-hover hover:text-text-secondary"
      >
        <Plus size={14} strokeWidth={1.4} />
        {t("models.addProvider")}
      </button>

      <AnimatePresence>
        {showAdd && (
          <AddCloudProviderDialog
            existing={cloudProviders.map((c) => c.name)}
            onAdd={(cfg) => {
              saveCloud([...cloudProviders, cfg]);
              setShowAdd(false);
            }}
            onClose={() => setShowAdd(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Cloud Provider Card ---------------------------------------------------

function CloudProviderCard({
  config,
  models,
  onUpdate,
  onRemove,
}: {
  config: CloudProviderConfig;
  models: ModelInfo[];
  onUpdate: (cfg: CloudProviderConfig) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(config.apiKey);
  const setActive = useModelStore((s) => s.setActive);

  const preset = CLOUD_PRESETS[config.name];
  const label = preset?.label ?? config.name;
  const maskedKey = config.apiKey
    ? `${config.apiKey.slice(0, 6)}…${config.apiKey.slice(-4)}`
    : t("models.notSet");

  return (
    <div className="rounded-xl bg-surface-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-hover">
          <Cloud size={14} strokeWidth={1.3} className="text-text-faint" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[0.9286rem] text-text">{label}</div>
          <div className="flex items-center gap-1.5 text-[0.7857rem] text-text-faint">
            <Key size={10} strokeWidth={1.3} />
            {maskedKey}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${config.enabled && config.apiKey ? "bg-success" : "bg-text-faint"
              }`}
          />
          {expanded ? (
            <ChevronUp size={14} strokeWidth={1.4} className="text-text-faint" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.4} className="text-text-faint" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border px-3.5 pb-3.5 pt-3">
              <div className="space-y-1">
                <label className="text-[0.7857rem] uppercase tracking-widest text-text-faint">
                  {t("models.apiKey")}
                </label>
                {editingKey ? (
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      autoFocus
                      className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[0.8571rem] text-text placeholder:text-text-faint focus:border-border-hover focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        onUpdate({ ...config, apiKey: keyDraft });
                        setEditingKey(false);
                      }}
                      className="rounded-lg bg-surface-3 px-2.5 py-1.5 text-[0.8571rem] text-text transition-colors hover:bg-hover-strong"
                    >
                      Kaydet
                    </button>
                    <button
                      onClick={() => {
                        setKeyDraft(config.apiKey);
                        setEditingKey(false);
                      }}
                      className="rounded-lg px-2 py-1.5 text-[0.8571rem] text-text-faint transition-colors hover:bg-hover"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingKey(true)}
                    className="w-full rounded-lg bg-surface px-2.5 py-1.5 text-left text-[0.8571rem] text-text-faint transition-colors hover:bg-hover"
                  >
                    {maskedKey} — {t("models.editKey")}
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[0.7857rem] uppercase tracking-widest text-text-faint">
                  Modeller
                </label>
                {models.length > 0 ? (
                  models.map((m) => (
                    <ModelCard key={m.id} model={m} />
                  ))
                ) : (
                  <div className="space-y-0.5">
                    {config.models.map((md) => (
                      <div
                        key={md.id}
                        className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[0.8571rem]"
                      >
                        <span className="text-text-secondary">
                          {md.displayName}
                        </span>
                        <button
                          onClick={() => setActive("cloud", md.id)}
                          className="text-[0.7857rem] text-text-faint transition-colors hover:text-text-secondary"
                        >
                          Aktif yap
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() =>
                    onUpdate({ ...config, enabled: !config.enabled })
                  }
                  className={`rounded-lg px-2.5 py-1 text-[0.8571rem] transition-colors ${config.enabled
                      ? "text-success hover:bg-success/10"
                      : "text-text-faint hover:bg-hover"
                    }`}
                >
                  {config.enabled ? "Etkin" : t("models.disabled")}
                </button>
                <button
                  onClick={onRemove}
                  className="rounded-lg px-2.5 py-1 text-[0.8571rem] text-danger transition-colors hover:bg-danger/10"
                >
                  {t("common.remove")}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Add Cloud Provider Dialog ---------------------------------------------

function AddCloudProviderDialog({
  existing,
  onAdd,
  onClose,
}: {
  existing: string[];
  onAdd: (cfg: CloudProviderConfig) => void;
  onClose: () => void;
}) {
  const t = useT();
  const available = Object.entries(CLOUD_PRESETS).filter(
    ([key]) => !existing.includes(key)
  );
  const [selected, setSelected] = useState(available[0]?.[0] ?? "");
  const [apiKey, setApiKey] = useState("");

  const handleAdd = () => {
    if (!selected || !apiKey.trim()) return;
    const preset = CLOUD_PRESETS[selected];
    onAdd({
      name: selected,
      apiKey: apiKey.trim(),
      baseUrl: null,
      enabled: true,
      models: preset?.defaultModels ?? [],
    });
  };

  if (available.length === 0) {
    return (
      <ModalOverlay onClose={onClose}>
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="w-full max-w-sm rounded-2xl bg-surface p-5 text-center max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-3 text-sm text-text-faint">
            {t("models.allProvidersAdded")}
          </p>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[0.9286rem] text-text-faint transition-colors hover:bg-hover"
          >
            Kapat
          </button>
        </motion.div>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-sm rounded-2xl bg-surface p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-sm font-medium text-text">
          {t("models.addCloudProvider")}
        </h3>
        <p className="mb-4 text-[0.8571rem] text-text-faint">
          {t("models.addCloudHint")}
        </p>

        <div className="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1">
          {available.map(([key, { label }]) => (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className={`relative flex-1 rounded-lg px-2 py-1.5 text-[0.8571rem] font-medium transition-colors ${selected === key
                  ? "text-text"
                  : "text-text-faint hover:text-text-secondary"
                }`}
            >
              {selected === key && (
                <motion.div
                  layoutId="cloud-add-tab"
                  className="absolute inset-0 rounded-lg bg-surface-3"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>

        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="sk-... / AIza..."
          autoFocus
          className="mb-4 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[0.9286rem] text-text placeholder:text-text-faint focus:border-border-hover focus:outline-none"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[0.9286rem] text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleAdd}
            disabled={!apiKey.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-surface-3 px-3 py-1.5 text-[0.9286rem] text-text transition-colors hover:bg-hover-strong disabled:opacity-40"
          >
            <Plus size={13} strokeWidth={1.4} />
            Ekle
          </button>
        </div>
      </motion.div>
    </ModalOverlay>
  );
}
