// Telegram gelen kutusu — auto mode'da bot ile yapılan konuşmaları toplu
// gösterir. Sol: chat listesi (en son aktiviteye göre sıralı). Sağ: seçili
// sohbetin tüm mesajları, kullanıcı/bot baloncukları halinde.

import { useEffect, useMemo, useRef } from "react";
import { Trash2, Send } from "lucide-react";
import { PageHeader } from "../shared/PageHeader";
import { useTelegramStore, type TelegramChat } from "../../stores/telegramStore";
import { useAppStore } from "../../stores/appStore";
import { useT, t as translate } from "../../i18n";

function formatRelative(ts: number): string {
  const diffSec = (Date.now() - ts) / 1000;
  if (diffSec < 60) return translate("tasks.justNow");
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} ${translate("tasks.unitMin")}`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ${translate("tasks.unitHour")}`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function ChatListItem({ chat, active, onClick }: {
  chat: TelegramChat;
  active: boolean;
  onClick: () => void;
}) {
  const lastMsg = chat.messages[chat.messages.length - 1];
  const preview = lastMsg ? lastMsg.content.replace(/\n+/g, " ").slice(0, 60) : translate("telegram.chatPreviewEmpty");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition-colors ${
        active ? "bg-hover" : "hover:bg-hover-strong/00"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[0.9286rem] font-medium text-text">{chat.sender}</span>
        <span className="shrink-0 text-[0.7143rem] text-text-faint">{formatRelative(chat.lastActivity)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[0.7857rem] text-text-faint">
          {lastMsg?.role === "assistant" ? translate("telegram.youPrefix") : ""}{preview}
        </span>
        {chat.unread > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[0.7143rem] font-medium text-white">
            {chat.unread}
          </span>
        )}
      </div>
    </button>
  );
}

function MessageBubble({ msg, sender }: {
  msg: { role: "user" | "assistant"; content: string; ts: number };
  sender: string;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex flex-col ${isUser ? "items-start" : "items-end"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[0.9286rem] leading-relaxed ${
          isUser
            ? "bg-surface-2 text-text"
            : "bg-transparent text-white"
        }`}
      >
        <div className="whitespace-pre-wrap">{msg.content}</div>
      </div>
      <span className="mt-1 px-1 text-[0.7143rem] text-text-faint">
        {isUser ? sender : "Bot"} · {formatTime(msg.ts)}
      </span>
    </div>
  );
}

function ConversationView({ chat }: { chat: TelegramChat }) {
  const t = useT();
  const clearChat = useTelegramStore((s) => s.clearChat);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgKey = chat.messages.length > 0
    ? `${chat.messages.length}-${chat.messages[chat.messages.length - 1].ts}`
    : "0";

  // Yeni mesaj geldikçe en aşağıya kaydır
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMsgKey]);

  async function sendReply(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const telegram = useAppStore.getState().apps.find((a) => a.id === "telegram");
    const token = telegram?.config["bot_token"];
    if (!token) return;
    try {
      const { ipc } = await import("../../lib/ipc");
      await ipc.httpFetch({
        url: `https://api.telegram.org/bot${token}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chat.chatId,
          text: cleaned,
          parse_mode: "Markdown",
        }),
      });
      useTelegramStore.getState().appendMessage(
        chat.chatId,
        chat.sender,
        chat.username,
        { role: "assistant", content: cleaned, ts: Date.now() },
      );
    } catch (e) {
      console.error("[telegram inbox] gönderim hatası:", e);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-text">{chat.sender}</span>
          {chat.username && (
            <span className="text-[0.7857rem] text-text-faint">@{chat.username}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm(t("telegram.deleteConfirm", { name: chat.sender }))) {
              clearChat(chat.chatId);
            }
          }}
          className="rounded-md p-1.5 text-text-faint hover:bg-hover hover:text-text"
          title={t("telegram.deleteConversation")}
        >
          <Trash2 size={14} strokeWidth={1.6} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {chat.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-faint">
            {t("telegram.noMessages")}
          </div>
        ) : (
          chat.messages.map((msg, i) => (
            <MessageBubble key={`${msg.ts}-${i}`} msg={msg} sender={chat.sender} />
          ))
        )}
      </div>

      <ReplyComposer onSend={sendReply} />
    </div>
  );
}

function ReplyComposer({ onSend }: { onSend: (text: string) => void | Promise<void> }) {
  const t = useT();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const v = inputRef.current?.value ?? "";
    if (!v.trim()) return;
    void onSend(v);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="border-t border-border bg-surface-1 px-5 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder={t("telegram.inputPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="flex-1 resize-none rounded-lg bg-surface-2 px-3 py-2 text-[0.9286rem] text-text outline-none placeholder:text-text-faint focus:bg-surface-3"
        />
        <button
          type="button"
          onClick={submit}
          className="rounded-full bg-accent/40 p-2 text-white hover:bg-accent/60 px-2.5 py-2.5"
          title={t("telegram.send")}
        >
          <Send size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

export function TelegramInbox() {
  const t = useT();
  const chatsObj = useTelegramStore((s) => s.chats);
  const selectedChatId = useTelegramStore((s) => s.selectedChatId);
  const selectChat = useTelegramStore((s) => s.selectChat);
  const telegramEnabled = useAppStore((s) => s.apps.find((a) => a.id === "telegram")?.enabled);
  const autoMode = useAppStore((s) => s.apps.find((a) => a.id === "telegram")?.config?.auto_mode === "true");

  const chats = useMemo(
    () => Object.values(chatsObj).sort((a, b) => b.lastActivity - a.lastActivity),
    [chatsObj],
  );

  const selectedChat = selectedChatId !== null ? chatsObj[selectedChatId] : null;

  // İlk açılışta varsa otomatik olarak en üstteki sohbeti seç
  useEffect(() => {
    if (selectedChatId === null && chats.length > 0) {
      selectChat(chats[0].chatId);
    }
  }, [selectedChatId, chats, selectChat]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-base">
      <div className="px-8 pt-8">
        <PageHeader
          title={t("nav.telegram")}
          subtitle={
            telegramEnabled
              ? autoMode
                ? t("telegram.subtitleAuto")
                : t("telegram.subtitleManualOff")
              : t("telegram.subtitleDisabled")
          }
        />
      </div>

      <div className="mx-8 mb-8 mt-2 flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border px-3 py-2">
            <span className="text-[0.7857rem] uppercase tracking-wider text-text-faint">
              Sohbetler ({chats.length})
            </span>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {chats.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-text-faint">
                {t("telegram.noConversations")}
              </div>
            ) : (
              chats.map((c) => (
                <ChatListItem
                  key={c.chatId}
                  chat={c}
                  active={c.chatId === selectedChatId}
                  onClick={() => selectChat(c.chatId)}
                />
              ))
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          {selectedChat ? (
            <ConversationView chat={selectedChat} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-faint">
              {t("telegram.selectChat")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
