import { For, Show } from "solid-js";
import { FiSmartphone, FiChevronRight, FiCloud } from "solid-icons/fi";
import { chats, openChat, currentUser, status } from "../lib/session";
import { sidebarOpen, setSidebarOpen } from "../components/Sidebar";
import { useT } from "../i18n";

export default function ChatList() {
  const t = useT();

  const user = () => currentUser();
  const isCloud = () => user() && !user()?.isAnonymous && status() !== "paired";

  return (
    <div class="flex h-full w-full flex-col bg-base">
      <header class="flex items-center justify-between border-b border-border bg-surface/40 backdrop-blur-md px-4 py-3 pt-12 sticky top-0 z-10">
        <div class="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen())}
            class="flex h-10 w-10 items-center justify-center rounded-xl text-text-secondarybackdrop-blur-sm active:bg-hover active:scale-95"
          >
            <svg
              width="25"
              height="25"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="12" y2="18" />
            </svg>
          </button>
          <span class="text-xl font-semibold text-text tracking-tight">Axiom</span>
        </div>

        {/* Status Indicator */}
        <div class="flex items-center gap-2 pr-1">
          <Show
            when={status() === "paired"}
            fallback={
              <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/80 bg-surface-2/45 text-[0.72rem] text-text-secondary font-medium backdrop-blur-sm">
                <FiCloud size={14} class="text-accent-colorful" />
                <span>Bulut</span>
              </div>
            }
          >
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-success/20 bg-success/10 text-[0.72rem] text-success font-medium">
              <div class="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              <span>Uzaktan</span>
            </div>
          </Show>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto px-4 py-3">
        <div class="flex flex-col gap-3 max-w-[500px] mx-auto">
          <span class="text-[0.8rem] font-semibold text-text-faint uppercase tracking-wider px-1">
            {isCloud() ? "Bulut Sohbetleri" : "Sohbetler"}
          </span>

          <Show
            when={chats().length > 0}
            fallback={
              <div class="flex h-[250px] flex-col items-center justify-center gap-4 p-8 text-center">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2/30 border border-border text-text-faint shadow-inner">
                  <FiSmartphone size={24} />
                </div>
                <p class="text-[0.9rem] text-text-secondary max-w-[260px] leading-relaxed">
                  {isCloud() ? t("chatList.fallbackTextCloud") : t("chatList.fallbackText")}
                </p>
              </div>
            }
          >
            <For each={chats()}>
              {(c) => (
                <button
                  onClick={() => handleSelectChat(c.id)}
                  class="group flex w-full flex-col items-start gap-1.5 border border-border/50 px-5 py-4 text-left bg-surface-2/20 hover:bg-surface-2/65 hover:border-accent-colorful/30 hover:shadow-md hover:shadow-accent-colorful/2 active:scale-[0.99] rounded-2xl transition-all duration-200"
                >
                  <div class="flex w-full items-center justify-between">
                    <span class="text-[1rem] font-semibold text-text group-hover:text-accent-colorful transition-colors duration-150">{c.title}</span>
                    <FiChevronRight size={16} class="text-text-faint group-hover:text-accent-colorful/60 group-hover:translate-x-0.5 transition-all duration-150" />
                  </div>
                  <Show when={c.preview}>
                    <span class="line-clamp-1 text-[0.8214rem] text-text-secondary leading-snug">{c.preview}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );

  function handleSelectChat(id: string) {
    openChat(id);
  }
}
