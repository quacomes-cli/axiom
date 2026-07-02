// Sohbet kalıcılık köprüsü — chatStore (bellek) ↔ SQLite (memory.db).
//
// localStorage persist'in yerini alır: 5-10MB tavanı yok, resimler restart
// sonrası kaybolmuyor, yazım "her state değişiminde tüm store" değil
// "mesaj finalize olduğunda tek sohbet".
//
// Resim disiplini: base64 resimler her kaydetmede IPC'den GEÇMEZ. Bir mesajın
// resimleri `chatImagesPut` ile bir kez gider (persistedImageMsgIds bunu izler),
// sohbete geçişte `chatImagesLoad` ile lazy geri gelir.

import { ipc } from "./ipc";
import type { Chat, ChatMessage } from "../stores/chatStore";

interface StoredMessage {
  id: string;
  role: string;
  text: string;
  extraJson?: string | null;
}

interface StoredChat {
  id: string;
  title: string;
  compactedSummary?: string | null;
  createdAt: number;
  messages: StoredMessage[];
}

/** Bu oturumda resimleri zaten DB'ye yazılmış (veya DB'den gelmiş) mesajlar. */
const persistedImageMsgIds = new Set<string>();

/** Text dışındaki mesaj alanları — extra_json'da taşınır. */
type MessageExtras = Omit<ChatMessage, "id" | "role" | "text" | "images">;

function toStored(chat: Chat): StoredChat {
  return {
    id: chat.id,
    title: chat.title,
    compactedSummary: chat.compactedSummary ?? null,
    createdAt: chat.createdAt,
    messages: chat.messages.map((m) => {
      const { id, role, text, images, ...extras } = m;
      const withCount: MessageExtras = {
        ...extras,
        imageCount: images?.length ?? m.imageCount,
      };
      const hasExtras = Object.values(withCount).some((v) => v !== undefined);
      return {
        id,
        role,
        text,
        extraJson: hasExtras ? JSON.stringify(withCount) : null,
      };
    }),
  };
}

function fromStored(stored: StoredChat): Chat {
  return {
    id: stored.id,
    title: stored.title,
    createdAt: stored.createdAt,
    compactedSummary: stored.compactedSummary ?? undefined,
    messages: stored.messages.map((m) => {
      let extras: MessageExtras = {};
      if (m.extraJson) {
        try {
          extras = JSON.parse(m.extraJson) as MessageExtras;
        } catch { /* bozuk extra alanı mesajı düşürmesin */ }
      }
      return {
        id: m.id,
        role: m.role as ChatMessage["role"],
        text: m.text,
        ...extras,
      };
    }),
  };
}

/** Sohbeti kaydet: meta + mesajlar; yeni resimli mesajların resimleri bir kez gider. */
export async function saveChat(chat: Chat): Promise<void> {
  try {
    await ipc.chatSave(toStored(chat));
    for (const m of chat.messages) {
      if (m.images?.length && !persistedImageMsgIds.has(m.id)) {
        await ipc.chatImagesPut(chat.id, m.id, m.images);
        persistedImageMsgIds.add(m.id);
      }
    }
  } catch (e) {
    console.error("[chatDb] sohbet kaydedilemedi:", e);
  }
}

export async function deleteChat(chatId: string): Promise<void> {
  try {
    await ipc.chatDelete(chatId);
  } catch (e) {
    console.error("[chatDb] sohbet silinemedi:", e);
  }
}

/** Bir sohbetin resimlerini DB'den getirir: {messageId: [base64…]}. */
export async function loadChatImages(chatId: string): Promise<Record<string, string[]>> {
  try {
    const map = await ipc.chatImagesLoad(chatId);
    for (const mid of Object.keys(map)) persistedImageMsgIds.add(mid);
    return map;
  } catch (e) {
    console.error("[chatDb] resimler yüklenemedi:", e);
    return {};
  }
}

const LEGACY_KEY = "axiom-chats";

/**
 * Eski localStorage persist verisini SQLite'a taşır (tek seferlik).
 * Kural: kullanıcı verisi SİLİNMEZ — başarılı göç sonrası anahtar yeniden
 * adlandırılır ki geri dönüş mümkün olsun.
 */
async function migrateFromLocalStorage(): Promise<Chat[]> {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return [];
  let chats: Chat[] = [];
  try {
    const parsed = JSON.parse(raw) as { state?: { chats?: Chat[] } };
    chats = parsed.state?.chats ?? [];
  } catch (e) {
    console.error("[chatDb] eski veri parse edilemedi, göç atlandı:", e);
    return [];
  }
  for (const chat of chats) {
    await ipc.chatSave(toStored(chat));
  }
  localStorage.setItem(
    `${LEGACY_KEY}.migrated-${new Date().toISOString().slice(0, 10)}`,
    raw,
  );
  localStorage.removeItem(LEGACY_KEY);
  console.log(`[chatDb] ${chats.length} sohbet localStorage'dan SQLite'a taşındı`);
  return chats;
}

/** Açılışta çağrılır: gerekirse göç eder, sonra tüm sohbetleri yükler. */
export async function loadAllChats(): Promise<Chat[]> {
  try {
    let stored = await ipc.chatsLoad();
    if (stored.length === 0) {
      const migrated = await migrateFromLocalStorage();
      if (migrated.length > 0) stored = await ipc.chatsLoad();
    }
    const chats = stored.map(fromStored);
    // DB'de resmi olan mesajları işaretle — saveChat onları tekrar göndermesin
    for (const c of chats) {
      for (const m of c.messages) {
        if (m.imageCount) persistedImageMsgIds.add(m.id);
      }
    }
    return chats;
  } catch (e) {
    // DB açılamadıysa (MemoryState yok) localStorage'a DOKUNMA — veri dursun.
    console.error("[chatDb] sohbetler yüklenemedi:", e);
    return [];
  }
}
