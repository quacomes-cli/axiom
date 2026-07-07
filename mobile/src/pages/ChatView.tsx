// Tek bir sohbetin görünümü — geçmiş + canlı token stream + mesaj gönderme.

import { For, Show, createEffect, createSignal } from "solid-js";
import { FiArrowLeft, FiArrowUp, FiSliders } from "solid-icons/fi";
import {
  messages,
  busy,
  sendChat,
  backToList,
  openChatId,
  chats,
  status,
  decryptedKeys,
} from "../lib/session";
import ChatMenu from "./ChatMenu";
import { SolidMarkdown } from "solid-markdown";
import { useT } from "../i18n";

export default function ChatView() {
  const t = useT();
  const [draft, setDraft] = createSignal("");
  const [menuOpen, setMenuOpen] = createSignal(false);
  let scroller: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  const title = () => chats().find((c) => c.id === openChatId())?.title ?? "";
  // Ayar menüsü yalnızca canlı (paired) bağlantıda anlamlı — cloud salt-okunur.
  const canControl = () => status() === "paired";

  const submit = (e: Event) => {
    e.preventDefault();
    const t = draft().trim();
    if (!t) return;
    sendChat(t);
    setDraft("");
    if (textareaRef) {
      textareaRef.style.height = "auto";
    }
  };

  // Yeni mesaj/token gelince en alta kaydır.
  createEffect(() => {
    messages();
    busy();
    queueMicrotask(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  // Textarea autogrow effect
  createEffect(() => {
    draft(); // reaktivite: taslak değişince yeniden ölç
    if (textareaRef) {
      textareaRef.style.height = "auto";
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 140)}px`;
    }
  });

  return (
    <div class="flex h-full w-full flex-col bg-base">
      <header class="flex items-center gap-3 border-b border-border bg-surface/40 backdrop-blur-md px-4 py-3 pt-12 sticky top-0 z-10">
        <button
          onClick={backToList}
          class="flex h-10 w-6 items-center justify-center rounded-xl text-text-secondary active:bg-hover active:scale-95 transition-all duration-200"
        >
          <FiArrowLeft size={20} />
        </button>
        <span class="line-clamp-1 flex-1 text-[1.05rem] font-semibold text-text tracking-tight">{title()}</span>
        <Show when={canControl()}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            class={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 active:scale-95 ${
              menuOpen() ? "bg-hover text-text" : "text-text-secondary active:bg-hover"
            }`}
          >
            <FiSliders size={19} />
          </button>
        </Show>
      </header>

      <Show when={menuOpen() && canControl()}>
        <ChatMenu onClose={() => setMenuOpen(false)} />
      </Show>

      <div ref={scroller} class="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4 scroll-smooth">
        <For each={messages()}>
          {(m) => (
            <Show
              when={m.role !== "user"}
              fallback={
                <div class="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm px-4 py-2.5 text-[0.92rem] leading-relaxed shadow-sm self-end bg-accent-colorful/15 border border-accent-colorful/20 text-text">
                  {m.text}
                </div>
              }
            >
              {/* Agent cevabı markdown olarak render edilir (kod blokları, listeler…) */}
              <div class="max-w-full self-start text-[0.92rem] leading-relaxed text-text prose-mobile">
                <SolidMarkdown children={m.text} />
              </div>
            </Show>
          )}
        </For>
        <Show when={busy()}>
          <div class="self-start">
            <span class="inline-flex gap-1.5 items-center">
              <span class="h-2 w-2 animate-bounce rounded-full bg-accent-colorful/70" />
              <span class="h-2 w-2 animate-bounce rounded-full bg-accent-colorful/70" style={{ "animation-delay": "0.15s" }} />
              <span class="h-2 w-2 animate-bounce rounded-full bg-accent-colorful/70" style={{ "animation-delay": "0.3s" }} />
            </span>
          </div>
        </Show>
      </div>

      <Show
        when={status() === "paired" || decryptedKeys() !== null}
        fallback={
          <div class="border-t border-border/80 bg-surface/95 backdrop-blur-lg px-6 py-4 text-center text-[0.88rem] text-text-secondary leading-relaxed shadow-md w-full max-w-[600px] mx-auto pb-[calc(env(safe-area-inset-bottom)+16px)]">
            {t("chatView.readOnlyBanner")}
          </div>
        }
      >
        <form onSubmit={submit} class="border border-border/80 bg-surface/95 backdrop-blur-lg px-2 py-2 flex items-start gap-3 m-2.5 mb-[calc(env(safe-area-inset-bottom)+12px)] rounded-2xl">
          <div class="flex-1 flex items-end rounded-2xl px-2 py-0">
            <textarea
              ref={textareaRef}
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onFocus={() => {
                // Klavye açılıp layout küçülünce son mesaja kaydır.
                setTimeout(() => {
                  if (scroller) scroller.scrollTop = scroller.scrollHeight;
                }, 300);
              }}
              rows={1}
              placeholder={t("chatView.placeholder")}
              class="h-32 max-h-64 flex-1 resize-none py-1.5 text-[0.95rem] text-text bg-transparent outline-none placeholder:text-text-faint scrollbar-none"
            />
          </div>
          <button
            type="submit"
            disabled={!draft().trim()}
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-colorful text-white shadow-md shadow-accent-colorful/25 active:scale-90 disabled:opacity-40 disabled:shadow-none transition-all duration-150"
          >
            <FiArrowUp size={20} />
          </button>
        </form>
      </Show>
    </div>
  );
}
