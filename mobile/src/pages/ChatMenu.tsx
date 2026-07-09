// Sohbet ayar menüsü — model seçimi, yanıt türü (mod), araç kullanımı.
// ChatView header'ındaki hamburger ile açılır; ekranı boğmadan dropdown.

import { For } from "solid-js";
import {
  models,
  activeModelId,
  mode,
  toolUse,
  chooseModel,
  chooseMode,
  toggleTool,
  type RMode,
} from "../lib/session";
import { useT } from "../i18n";

export default function ChatMenu(props: { onClose: () => void }) {
  const t = useT();
  const activeModel = () => models().find((m) => m.id === activeModelId());
  const thinkingOk = () => !!activeModel()?.thinking;

  const MODES: { v: RMode; label: () => string }[] = [
    { v: "fast", label: () => t("chatMenu.fast") },
    { v: "balanced", label: () => t("chatMenu.balanced") },
    { v: "thinking", label: () => t("chatMenu.thinking") },
  ];

  return (
    <>
      <div class="fixed inset-0 z-40" onClick={props.onClose} />
      <div class="absolute right-3 top-[92px] z-50 w-64 rounded-2xl border border-border bg-surface-2/95 p-2 shadow-2xl backdrop-blur-md">
        {/* Model */}
        <p class="px-1.5 pb-1 pt-0.5 text-[0.72rem] font-medium uppercase tracking-wider text-text-faint">
          {t("chatMenu.model")}
        </p>
        <div class="max-h-44 overflow-y-auto">
          <For
            each={models()}
            fallback={<p class="px-2 py-1 text-[0.8rem] text-text-faint">{t("chatMenu.noModels")}</p>}
          >
            {(m) => (
              <button
                onClick={() => chooseModel(m.id, m.provider)}
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left active:bg-hover"
              >
                <span
                  class={`h-1.5 w-1.5 shrink-0 rounded-full ${m.id === activeModelId() ? "bg-success" : "bg-transparent"}`}
                />
                <span class="flex-1 truncate text-[0.85rem] text-text">{m.name}</span>
              </button>
            )}
          </For>
        </div>

        <div class="my-1.5 h-px bg-border" />

        {/* Yanıt türü */}
        <p class="px-1.5 pb-1 text-[0.72rem] font-medium uppercase tracking-wider text-text-faint">
          {t("chatMenu.responseType")}
        </p>
        <div class="flex gap-1 px-1">
          <For each={MODES}>
            {(md) => {
              const disabled = () => md.v === "thinking" && !thinkingOk();
              return (
                <button
                  disabled={disabled()}
                  onClick={() => chooseMode(md.v)}
                  class={`flex-1 rounded-lg px-2 py-1.5 text-[0.8rem] transition-colors ${
                    mode() === md.v ? "bg-surface-3 text-text" : "text-text-secondary"
                  } ${disabled() ? "opacity-40" : "active:bg-hover"}`}
                >
                  {md.label()}
                </button>
              );
            }}
          </For>
        </div>

        <div class="my-1.5 h-px bg-border" />

        {/* Araçlar */}
        <button
          onClick={toggleTool}
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 active:bg-hover"
        >
          <span class="flex-1 text-left text-[0.85rem] text-text">{t("chatMenu.tools")}</span>
          <span
            class={`relative h-5 w-9 rounded-full transition-colors ${toolUse() ? "bg-success" : "bg-surface-3"}`}
          >
            <span
              class={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${toolUse() ? "left-[18px]" : "left-0.5"}`}
            />
          </span>
        </button>
      </div>
    </>
  );
}
