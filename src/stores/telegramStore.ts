// Telegram gelen-kutusu store'u.
//
// Auto mode (useTelegramAutoMode) bu store'a yazar; Telegram Inbox UI (ve
// `telegram_get_updates` aracı) buradan okur. Zustand kullanmamızın sebebi
// React'ın güncellemeleri görebilmesi — saf Map ile UI re-render almaz.
//
// Hafızanın iki kullanım amacı var:
//  1) Auto mode'un model'e geçmiş bağlamı vermesi (son N mesaj).
//  2) Kullanıcının görsel olarak konuşmaları takip edebilmesi.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface TelegramChatMessage {
  /** "user" = telegramdaki kullanıcı, "assistant" = botun cevabı */
  role: "user" | "assistant";
  content: string;
  /** Epoch ms */
  ts: number;
}

export interface TelegramChat {
  chatId: number;
  sender: string;
  /** Username yoksa ad gösterilebilsin diye ayrı tutuyoruz */
  username?: string;
  messages: TelegramChatMessage[];
  /** En son aktivite (sıralama için) */
  lastActivity: number;
  /** Okunmamış mesaj sayısı — kullanıcı sohbeti inbox'ta açınca sıfırlanır */
  unread: number;
}

interface TelegramState {
  /** chatId → chat */
  chats: Record<number, TelegramChat>;
  /** Inbox UI'da seçili olan sohbet (yok = liste boş veya seçilmemiş) */
  selectedChatId: number | null;
  appendMessage: (
    chatId: number,
    sender: string,
    username: string | undefined,
    msg: TelegramChatMessage,
  ) => void;
  selectChat: (chatId: number | null) => void;
  markRead: (chatId: number) => void;
  clearChat: (chatId: number) => void;
  totalUnread: () => number;
}

const MAX_PER_CHAT = 100;

export const useTelegramStore = create<TelegramState>()(
  persist(
    (set, get) => ({
      chats: {},
      selectedChatId: null,

      appendMessage: (chatId, sender, username, msg) => {
        set((s) => {
          const existing = s.chats[chatId];
          const messages = [...(existing?.messages ?? []), msg].slice(-MAX_PER_CHAT);
          // Sadece kullanıcıdan gelen mesajlar "okunmamış" sayılır; bot cevabı
          // kendi atılan mesaj.
          const incomingUnread = msg.role === "user" ? 1 : 0;
          const unread =
            s.selectedChatId === chatId
              ? 0
              : (existing?.unread ?? 0) + incomingUnread;
          return {
            chats: {
              ...s.chats,
              [chatId]: {
                chatId,
                sender,
                username: username ?? existing?.username,
                messages,
                lastActivity: msg.ts,
                unread,
              },
            },
          };
        });
      },

      selectChat: (chatId) => {
        set((s) => {
          if (chatId === null) return { selectedChatId: null };
          const chat = s.chats[chatId];
          if (!chat) return { selectedChatId: chatId };
          // Açar açmaz okunmuş say
          return {
            selectedChatId: chatId,
            chats: { ...s.chats, [chatId]: { ...chat, unread: 0 } },
          };
        });
      },

      markRead: (chatId) => {
        set((s) => {
          const chat = s.chats[chatId];
          if (!chat || chat.unread === 0) return s;
          return { chats: { ...s.chats, [chatId]: { ...chat, unread: 0 } } };
        });
      },

      clearChat: (chatId) => {
        set((s) => {
          const next = { ...s.chats };
          delete next[chatId];
          return {
            chats: next,
            selectedChatId: s.selectedChatId === chatId ? null : s.selectedChatId,
          };
        });
      },

      totalUnread: () => {
        return Object.values(get().chats).reduce((sum, c) => sum + c.unread, 0);
      },
    }),
    {
      name: "axiom-telegram",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ chats: s.chats }) as unknown as TelegramState,
    },
  ),
);
