// İzinli sohbetlerin listesi. Bir satıra dokununca sohbet açılır.

import { For, Show } from "solid-js";
import { FiSmartphone } from "solid-icons/fi";
import { chats, openChat } from "../lib/session";

export default function ChatList(props: { onDisconnect: () => void }) {
  return (
    <div class="flex h-full w-full flex-col">
      <header class="flex items-center gap-2 border-b border-border px-4 py-3 pt-10">
        <span class="text-[1.1rem] font-medium text-text">Sohbetler</span>
        <button
          onClick={props.onDisconnect}
          class="ml-auto rounded-lg px-2.5 py-1 text-[0.8rem] text-text-faint active:scale-95"
        >
          Bağlantıyı kes
        </button>
      </header>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={chats().length > 0}
          fallback={
            <div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <FiSmartphone size={30} class="text-text-faint" />
              <p class="text-[0.9rem] text-text-faint">
                Henüz paylaşılan sohbet yok. Bilgisayarında bir sohbeti /remote ile
                veya kenar çubuğundaki üç-nokta menüsünden paylaş.
              </p>
            </div>
          }
        >
          <For each={chats()}>
            {(c) => (
              <button
                onClick={() => openChat(c.id)}
                class="flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-4 py-3 text-left active:bg-hover"
              >
                <span class="text-[0.95rem] text-text">{c.title}</span>
                <Show when={c.preview}>
                  <span class="line-clamp-1 text-[0.8rem] text-text-faint">{c.preview}</span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
