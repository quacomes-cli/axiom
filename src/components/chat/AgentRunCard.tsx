// Derin agent koşusu kartı (Faz 5) — plan adımlarını canlı çizer:
// ○ bekliyor · ⟳ çalışıyor · ✓ bitti · ✗ hata. Adımlar genişleyince not +
// araç özet satırları görünür. Koşu sürerken "Durdur" butonu.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Check,
  X,
  Loader2,
  ChevronDown,
  Square,
  Circle,
  Wrench,
} from "lucide-react";
import type { AgentRun, AgentStep } from "../../stores/chatStore";
import type { ToolAction } from "../../types";
import { useChatStore } from "../../stores/chatStore";
import { useT } from "../../i18n";

function StepIcon({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 size={14} className="animate-spin text-text-secondary" />;
    case "done":
      return <Check size={14} strokeWidth={2} className="text-success" />;
    case "failed":
      return <X size={14} strokeWidth={2} className="text-danger" />;
    default:
      return <Circle size={9} strokeWidth={1.6} className="text-text-faint" />;
  }
}

function actionSummary(a: ToolAction): string {
  const target = a.path ?? a.command ?? "";
  return target ? `${a.kind}: ${target}` : a.kind;
}

function StepRow({ step, index }: { step: AgentStep; index: number }) {
  const [open, setOpen] = useState(false);
  const expandable = !!step.note || (step.actions?.length ?? 0) > 0;

  return (
    <div className="rounded-lg">
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${
          expandable ? "hover:bg-hover" : "cursor-default"
        }`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <StepIcon status={step.status} />
        </span>
        <span
          className={`flex-1 text-[0.8571rem] leading-snug ${
            step.status === "pending"
              ? "text-text-faint"
              : step.status === "failed"
                ? "text-danger"
                : "text-text-secondary"
          }`}
        >
          <span className="mr-1.5 text-text-faint">{index + 1}.</span>
          {step.title}
        </span>
        {expandable && (
          <ChevronDown
            size={13}
            className={`shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="ml-7 space-y-1.5 border-l border-border pb-2 pl-3 pr-2">
              {step.actions?.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[0.7857rem] text-text-faint">
                  <Wrench size={11} className="shrink-0" />
                  <span className="truncate font-mono">{actionSummary(a)}</span>
                </div>
              ))}
              {step.note && (
                <p className="whitespace-pre-wrap text-[0.8214rem] leading-relaxed text-text-secondary">
                  {step.note}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AgentRunCard({ run }: { run: AgentRun }) {
  const t = useT();
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const live = run.status === "planning" || run.status === "running" || run.status === "synthesizing";

  const statusLabel =
    run.status === "planning"
      ? t("agent.planning")
      : run.status === "running"
        ? t("agent.running")
        : run.status === "synthesizing"
          ? t("agent.synthesizing")
          : run.status === "done"
            ? t("agent.done")
            : run.status === "stopped"
              ? t("agent.stopped")
              : t("agent.failed");

  return (
    <div className="mb-2 rounded-xl border border-border bg-surface p-3">
      {/* Başlık: hedef + durum + durdur */}
      <div className="mb-2 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-secondary">
          <Bot size={14} strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8571rem] font-medium leading-snug text-text">{run.goal}</p>
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-[0.7857rem] ${
              run.status === "failed"
                ? "text-danger"
                : run.status === "done"
                  ? "text-success"
                  : "text-text-faint"
            }`}
          >
            {live && <Loader2 size={11} className="animate-spin" />}
            {statusLabel}
            {run.error && <span className="truncate">— {run.error}</span>}
          </p>
        </div>
        {live && (
          <button
            onClick={stopGeneration}
            title={t("agent.stop")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-text-faint hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          >
            <Square size={11} strokeWidth={2} fill="currentColor" />
          </button>
        )}
      </div>

      {/* Adımlar */}
      {run.steps.length > 0 && (
        <div className="space-y-0.5">
          {run.steps.map((step, i) => (
            <StepRow key={i} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
