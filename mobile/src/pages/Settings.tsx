import { For, Show } from "solid-js";
import { FiArrowLeft, FiUser, FiCpu, FiCheck, FiMonitor } from "solid-icons/fi";
import {
  cloudProfile,
  cloudProfileEnabled,
  decryptedKeys,
  models,
  activeModelId,
  chooseModel,
  status,
} from "../lib/session";
import { useT } from "../i18n";

export default function Settings(props: { onBack: () => void }) {
  const t = useT();
  const profile = () => cloudProfile();
  const keys = () => decryptedKeys();
  const paired = () => status() === "paired";

  return (
    <div class="flex h-full w-full flex-col bg-base text-text">
      {/* Header */}
      <header class="flex items-center gap-3 border-b border-border bg-surface/40 backdrop-blur-md px-4 py-3 pt-12 sticky top-0 z-10">
        <button
          onClick={props.onBack}
          class="flex h-10 w-10 items-center justify-center rounded-xl text-text-secondary border border-border/40 bg-surface-2/20 backdrop-blur-sm active:bg-hover active:scale-95 transition-all duration-200"
        >
          <FiArrowLeft size={20} />
        </button>
        <span class="text-lg font-semibold tracking-tight">{t("settings.title")}</span>
      </header>

      {/* Scrollable Container */}
      <div class="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Section 1: User Profile Context */}
        <div class="space-y-3">
          <div class="flex items-center gap-2 px-1 text-text-secondary">
            <FiUser size={16} />
            <span class="text-[0.8rem] font-bold uppercase tracking-wider">{t("settings.profileSection")}</span>
          </div>

          <div class="rounded-2xl border border-border bg-surface-2/20 p-4 space-y-4">
            <div class="flex items-center justify-between border-b border-border/60 pb-3">
              <div class="flex flex-col">
                <span class="text-[0.88rem] font-semibold">{t("settings.contextual")}</span>
                <span class="text-[0.72rem] text-text-faint">{t("settings.contextualHint")}</span>
              </div>
              <div class="flex items-center">
                <span class={`px-2.5 py-1 rounded-full text-[0.72rem] font-semibold ${
                  cloudProfileEnabled()
                    ? "bg-success/15 text-success border border-success/20"
                    : "bg-danger/15 text-danger border border-danger/20"
                }`}>
                  {cloudProfileEnabled() ? t("settings.active") : t("settings.off")}
                </span>
              </div>
            </div>

            <Show
              when={profile()}
              fallback={
                <p class="text-[0.78rem] text-text-faint text-center py-2">
                  {t("settings.noProfile")}
                </p>
              }
            >
              <div class="grid grid-cols-2 gap-3 text-[0.82rem] leading-relaxed">
                <div>
                  <span class="text-text-faint block text-[0.72rem] uppercase font-bold tracking-wider">{t("settings.name")}</span>
                  <span class="text-text-secondary">{[profile()?.name, profile()?.surname].filter(Boolean).join(" ") || t("settings.notSpecified")}</span>
                </div>
                <div>
                  <span class="text-text-faint block text-[0.72rem] uppercase font-bold tracking-wider">{t("settings.email")}</span>
                  <span class="text-text-secondary truncate block">{profile()?.email || t("settings.notSpecified")}</span>
                </div>
                <div>
                  <span class="text-text-faint block text-[0.72rem] uppercase font-bold tracking-wider">{t("settings.location")}</span>
                  <span class="text-text-secondary">{profile()?.location || t("settings.notSpecified")}</span>
                </div>
                <div>
                  <span class="text-text-faint block text-[0.72rem] uppercase font-bold tracking-wider">{t("settings.profession")}</span>
                  <span class="text-text-secondary">{profile()?.profession || t("settings.notSpecified")}</span>
                </div>
                <div class="col-span-2">
                  <span class="text-text-faint block text-[0.72rem] uppercase font-bold tracking-wider">{t("settings.interests")}</span>
                  <span class="text-text-secondary">{profile()?.interests?.join(", ") || t("settings.notSpecified")}</span>
                </div>
                <div class="col-span-2">
                  <span class="text-text-faint block text-[0.72rem] uppercase font-bold tracking-wider">{t("settings.responseStyle")}</span>
                  <span class="text-text-secondary">{profile()?.responseStyle || t("settings.default")}</span>
                </div>
                <div class="col-span-2">
                  <span class="text-text-faint block text-[0.72rem] uppercase font-bold tracking-wider">{t("settings.notes")}</span>
                  <span class="text-text-secondary text-[0.78rem] leading-snug block mt-1 max-h-24 overflow-y-auto border border-border/40 p-2 rounded-lg bg-surface/30">
                    {profile()?.notes?.join(" | ") || t("settings.noNotes")}
                  </span>
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* Section 2: Models */}
        <div class="space-y-3">
          <div class="flex items-center gap-2 px-1 text-text-secondary">
            <FiCpu size={16} />
            <span class="text-[0.8rem] font-bold uppercase tracking-wider">{t("settings.modelSection")}</span>
          </div>

          {/* Paired modda modeller sohbet menüsünden yönetilir — burada bilgi ver */}
          <Show
            when={!paired()}
            fallback={
              <div class="flex items-center gap-3 rounded-2xl border border-success/20 bg-success/5 p-4 text-[0.82rem] text-text-secondary leading-relaxed">
                <FiMonitor size={20} class="shrink-0 text-success" />
                {t("settings.pairedInfo")}
              </div>
            }
          >
            <div class="space-y-3">
              <Show
                when={keys()}
                fallback={
                  <div class="rounded-2xl border border-border/80 bg-surface-2/20 p-4 text-center text-text-faint text-[0.82rem] leading-relaxed">
                    {t("settings.noKeys")}
                  </div>
                }
              >
                <For each={Object.keys(keys() || {})}>
                  {(provider) => {
                    const providerModels = () => models().filter((m) => m.provider === provider);
                    return (
                      <div class="rounded-2xl border border-border bg-surface-2/20 p-3 space-y-2">
                        <div class="flex items-center justify-between border-b border-border/45 pb-2 px-1">
                          <span class="text-[0.85rem] font-bold uppercase tracking-wider text-accent-colorful">
                            {provider.toUpperCase()}
                          </span>
                          <span class="text-[0.72rem] text-success font-medium flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-success" />
                            {t("settings.keyReady")}
                          </span>
                        </div>
                        <div class="flex flex-col gap-1.5">
                          <For
                            each={providerModels()}
                            fallback={
                              <p class="text-[0.78rem] text-text-faint px-1">
                                {t("settings.noProviderModels")}
                              </p>
                            }
                          >
                            {(model) => (
                              <button
                                onClick={() => chooseModel(model.id, model.provider)}
                                class={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[0.82rem] border transition-all ${
                                  activeModelId() === model.id
                                    ? "bg-accent-colorful/10 border-accent-colorful/30 text-accent-colorful font-semibold"
                                    : "bg-surface/30 border-border/40 hover:bg-surface/50 text-text-secondary"
                                }`}
                              >
                                <span>{model.name}</span>
                                <Show when={activeModelId() === model.id}>
                                  <FiCheck size={16} class="text-accent-colorful" />
                                </Show>
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </Show>
        </div>

      </div>
    </div>
  );
}
