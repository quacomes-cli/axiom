// Tek bir sohbetin görünümü — geçmiş + canlı token stream + mesaj gönderme.

import { For, Show, createEffect, createSignal } from "solid-js";
import { FiArrowLeft, FiArrowUp } from "solid-icons/fi";
import {
  messages,
  busy,
  sendChat,
  backToList,
  openChatId,
  chats,
} from "../lib/session";

export default function ChatView() {
  const [draft, setDraft] = createSignal("");
  let scroller: HTMLDivElement | undefined;

  const title = () => chats().find((c) => c.id === openChatId())?.title ?? "";

  const submit = (e: Event) => {
    e.preventDefault();
    const t = draft().trim();
    if (!t) return;
    sendChat(t);
    setDraft("");
  };

  // Yeni mesaj/token gelince en alta kaydır.
  createEffect(() => {
    messages();
    busy();
    queueMicrotask(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  return (
    <div class="flex h-full w-full flex-col">
      <header class="flex items-center gap-2 border-b border-border px-2 py-3 pt-10">
        <button
          onClick={backToList}
          class="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary active:bg-hover"
        >
          <FiArrowLeft size={20} />
        </button>
        <span class="line-clamp-1 text-[1rem] text-text">{title()}</span>
      </header>

      <div ref={scroller} class="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        <For each={messages()}>
          {(m) => (
            <div
              class={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[0.92rem] ${
                m.role === "user"
                  ? "self-end bg-surface-3 text-text"
                  : "self-start bg-surface-2 text-text"
              }`}
            >
              {m.text}
            </div>
          )}
        </For>
        <Show when={busy()}>
          <div class="self-start rounded-2xl bg-surface-2 px-3.5 py-2.5">
            <span class="inline-flex gap-1">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint" />
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint" style={{ "animation-delay": "0.15s" }} />
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint" style={{ "animation-delay": "0.3s" }} />
            </span>
          </div>
        </Show>
      </div>

      <form onSubmit={submit} class="flex items-end gap-2 border-t border-border p-2.5 pb-6">
        <textarea
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onFocus={() => {
            // Klavye açılıp layout küçülünce son mesaja kaydır.
            setTimeout(() => {
              if (scroller) scroller.scrollTop = scroller.scrollHeight;
            }, 300);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={1}
          placeholder="Mesaj yaz…"
          class="max-h-32 flex-1 resize-none rounded-2xl border border-border bg-surface-2 px-3.5 py-2.5 text-[0.92rem] text-text outline-none placeholder:text-text-faint"
        />
        <button
          type="submit"
          disabled={!draft().trim()}
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-colorful text-white disabled:opacity-40 active:scale-95"
        >
          <FiArrowUp size={20} />
        </button>
      </form>
    </div>
  );
}
