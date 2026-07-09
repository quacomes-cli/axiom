import { useEffect, useState } from "react";
import { Zap, Scale, Gem, Settings2, Loader2, AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { ModalOverlay } from "../shared/ModalOverlay";
import { useOptimizationStore } from "../../stores/optimizationStore";
import { useModelStore } from "../../stores/modelStore";
import { ipc } from "../../lib/ipc";
import { useT } from "../../i18n";
import type { ProfilePreset } from "../../types";

const PRESETS: { id: ProfilePreset; labelKey: string; icon: React.ReactNode }[] = [
  { id: "hiz", labelKey: "optimization.presetSpeed", icon: <Zap size={14} /> },
  { id: "denge", labelKey: "optimization.presetBalance", icon: <Scale size={14} /> },
  { id: "kalite", labelKey: "optimization.presetQuality", icon: <Gem size={14} /> },
  { id: "ozel", labelKey: "optimization.presetCustom", icon: <Settings2 size={14} /> },
];

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-text-secondary">{label}</div>
        {hint && <div className="text-[0.8571rem] text-text-faint">{hint}</div>}
      </div>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          onChange(v);
        }}
        min={min}
        max={max}
        className="w-20 rounded-md border border-border bg-surface-1 px-2 py-1 text-right text-sm text-text-primary outline-none focus:border-accent"
      />
    </div>
  );
}

function ToggleField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const checked = value === true;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-text-secondary">{label}</div>
        {hint && <div className="text-[0.8571rem] text-text-faint">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-blue-400" : "bg-hover"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"
            }`}
        />
      </button>
    </div>
  );
}

export function OptimizationPanel() {
  const t = useT();
  const config = useOptimizationStore((s) => s.config);
  const loading = useOptimizationStore((s) => s.loading);
  const loadConfig = useOptimizationStore((s) => s.loadConfig);
  const setPreset = useOptimizationStore((s) => s.setPreset);
  const updateField = useOptimizationStore((s) => s.updateField);
  const autoDetect = useOptimizationStore((s) => s.autoDetect);
  const checkOllama = useModelStore((s) => s.checkOllama);

  const [flashConfirm, setFlashConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const activePreset = config?.preset ?? "denge";

  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("optimization.header")}
        </h2>
        {loading && <Loader2 size={14} className="animate-spin text-text-faint" />}
      </div>

      {/* Preset selector */}
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => void setPreset(p.id)}
            disabled={loading}
            className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-xs transition-all duration-200 ${activePreset === p.id
                ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                : "bg-surface-2 text-text-faint hover:bg-surface-3 hover:text-text-secondary"
              }`}
          >
            {p.icon}
            <span className="font-medium">{t(p.labelKey)}</span>
          </button>
        ))}
      </div>

      {!config && !loading && (
        <button
          onClick={() => void autoDetect()}
          className="w-full rounded-xl bg-accent/10 py-3 text-sm text-accent transition-colors hover:bg-accent/20"
        >
          {t("optimization.detectAndOptimize")}
        </button>
      )}

      {config && (
        <div className="space-y-1.5">
          <NumberField
            label={t("optimization.gpuLayers")}
            value={config.numGpu}
            onChange={(v) => updateField("numGpu", v)}
            min={-1}
            hint={t("optimization.gpuLayersHint")}
          />
          <NumberField
            label={t("optimization.cpuThread")}
            value={config.numThread}
            onChange={(v) => updateField("numThread", v)}
            min={1}
            max={64}
            hint={t("optimization.cpuThreadHint")}
          />
          <NumberField
            label={t("optimization.contextWindow")}
            value={config.numCtx}
            onChange={(v) => updateField("numCtx", v)}
            min={512}
            max={131072}
            hint={t("optimization.contextWindowHint")}
          />
          <NumberField
            label={t("optimization.batchSize")}
            value={config.numBatch}
            onChange={(v) => updateField("numBatch", v)}
            min={1}
            max={2048}
            hint={t("optimization.batchSizeHint")}
          />
          <ToggleField
            label={t("optimization.memoryLock")}
            value={config.useMlock}
            onChange={(v) => updateField("useMlock", v)}
            hint={t("optimization.memoryLockHint")}
          />
          <ToggleField
            label="Flash Attention"
            value={config.flashAttention}
            onChange={() => setFlashConfirm(true)}
            hint={t("optimization.flashAttentionHint")}
          />
        </div>
      )}

      {/* Flash Attention onay dialogu */}
      <AnimatePresence>
        {flashConfirm && (
          <ModalOverlay onClose={() => setFlashConfirm(false)}>
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
                <h3 className="text-sm font-semibold text-text">
                  {config?.flashAttention ? t("optimization.flashConfirmDisable") : t("optimization.flashConfirmEnable")}
                </h3>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-text-faint">
                {t("optimization.restartNeeded")}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setFlashConfirm(false)}
                  className="flex-1 rounded-xl bg-surface-3 py-2 text-sm text-text-secondary transition-colors hover:bg-hover"
                >
                  {t("optimization.no")}
                </button>
                <button
                  disabled={restarting}
                  onClick={async () => {
                    setRestarting(true);
                    updateField("flashAttention", !config?.flashAttention);
                    try {
                      await ipc.ollamaRestart();
                      for (let i = 0; i < 15; i++) {
                        await new Promise((r) => setTimeout(r, 1000));
                        const online = await ipc.ollamaStatus();
                        if (online) break;
                      }
                      await checkOllama();
                    } catch {
                      // restart başarısız olsa bile config değişti
                    }
                    setRestarting(false);
                    setFlashConfirm(false);
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent/15 py-2 text-sm text-accent transition-colors hover:bg-accent/25"
                >
                  {restarting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t("optimization.restarting")}
                    </>
                  ) : (
                    t("optimization.yesRestart")
                  )}
                </button>
              </div>
            </motion.div>
          </ModalOverlay>
        )}
    </AnimatePresence>
    </section >
  );
}
