// Telegram otomatik modu: bot polling + tool'lu otomatik cevap.
//
// AppsHub'da Telegram için "auto_mode" toggle açıkken çalışır. getUpdates ile
// long-poll yapar (timeout=25s); yeni text mesajı gelirse aktif modeli
// "kullanıcıya Telegram'dan bir mesaj geldi" diye çağırır, tool döngüsü
// boyunca cevabı üretir ve sendMessage ile geri yollar. Bildirim merkezine de
// köprü gibi düşer ki kullanıcı uygulamada gördüğünde haberdar olsun.

// Modelin prompt'una verilecek geçmiş penceresinin maks mesaj sayısı.
// (Inbox'ta gösterilen mesaj sayısı bundan farklı; o store'da MAX_PER_CHAT.)
const MAX_PROMPT_HISTORY = 20;

import { useEffect } from "react";
import { useAppStore, type TelegramUpdate } from "../stores/appStore";
import { useModelStore } from "../stores/modelStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useTelegramStore } from "../stores/telegramStore";
import {
  TOOL_SYSTEM_PROMPT,
  parseToolBlocks,
  executeToolBlock,
  buildToolResultText,
  modelSupportsTools,
  buildEnabledAppsPrompt,
} from "../stores/chatStore";
import { ipc } from "../lib/ipc";
import { buildNativeTools } from "../lib/toolRegistry";
import {
  formatPendingPairs,
  parseAllowedChatIds,
  parsePendingPairs,
} from "../lib/telegramAccess";
import type { ChatMessage as IpcChatMessage } from "../types";

const POLL_TIMEOUT_SECS = 25;
const POLL_INTERVAL_MS = 1500;
const MAX_TOOL_STEPS = 6;

async function handleTelegramMessage(token: string, m: NonNullable<TelegramUpdate["message"]>) {
  const text = m.text || m.caption;
  if (!text) return;

  const active = useModelStore.getState().models.find((mm) => mm.isActive);
  if (!active) {
    // ... model yoksa hata mesajı gönderen mevcut kodun aynen kalıyor ...
    return;
  }

  const hasTools = modelSupportsTools(active);
  const sender = m.from?.first_name || m.from?.username || "kullanıcı";
  const persona = `Sen Axiom üzerinde çalışan bir yapay zekasın. ${sender} adlı kullanıcı Telegram üzerinden seninle yazışıyor.
Kuralları:
- Cevabını net, kısa ve doğrudan tut. Gerekirse araçları (web arama, hava, döviz, vs.) kullan.
- Cevap kullanıcının konuştuğu dilde olsun (kullanıcı başka dilde yazmadıkça).
- Cevap, doğrudan kullanıcıya hitap eden tek bir mesaj olmalı — meta yorum yok.`;
  // System prompt: persona + tool format kılavuzu + etkin uygulama araçlarının
  // tam listesi (gmail_unread_count, calendar_today, vs.). Üçüncüsü olmadan
  // model araçların varlığını bilemez ve "Gmail hesabın bağlı değil" gibi
  // halüsinasyonlarla cevap verir.
  let systemPrompt = persona;
  if (hasTools) {
    systemPrompt += `\n\n${TOOL_SYSTEM_PROMPT}`;
    const appsPrompt = buildEnabledAppsPrompt();
    if (appsPrompt) systemPrompt += `\n\n${appsPrompt}`;
  }

  // 1. Bu chat_id'ye ait eski geçmişi store'dan getir (son MAX_PROMPT_HISTORY).
  //    Store inbox UI'sıyla paylaşılıyor — yeni gelen mesajı önce store'a yaz,
  //    sonra prompt'u oraya bakarak kur.
  const tgStore = useTelegramStore.getState();
  const username = m.from?.username;
  tgStore.appendMessage(m.chat.id, sender, username, {
    role: "user",
    content: text,
    ts: m.date * 1000,
  });

  const existing = useTelegramStore.getState().chats[m.chat.id];
  const recent = (existing?.messages ?? []).slice(-MAX_PROMPT_HISTORY);
  const promptHistory: IpcChatMessage[] = recent.map((msg) => ({
    role: msg.role, // "user" | "assistant" — IpcChatMessage de string role bekliyor
    content: msg.content,
  }));

  // 2. Modeme göndereceğimiz history dizisini oluştur (System prompt her zaman en tepede)
  const history: IpcChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...promptHistory,
  ];

  let final = "";
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    let resp;
    try {
      resp = await ipc.modelsChat({
        modelId: active.id,
        provider: active.provider,
        messages: history,
        temperature: 0.5,
        maxTokens: 1536,
        tools: hasTools ? buildNativeTools(active) : undefined,
      });
    } catch (e) {
      console.error("[telegram] model chat hatası:", e);
      return;
    }
    const out = resp.content.trim();
    history.push({ role: "assistant", content: out });

    if (!hasTools) { final = out; break; }
    const blocks = parseToolBlocks(out);
    if (blocks.length === 0) { final = out; break; }

    // Uzaktan gelen istek: onay gerektiren izinler SORULMAZ, otomatik reddedilir.
    const actions = [];
    for (const b of blocks) actions.push(await executeToolBlock(b, { interactive: false }));
    history.push({ role: "user", content: `[Araç çıktıları]\n${buildToolResultText(actions)}` });

    if (step === MAX_TOOL_STEPS - 1) final = out;
  }

  // Asistan cevabı içinde tool sözdizimi ya da sistem etiketi kalmasın
  const cleaned = final
    .replace(/```tool:[a-z_]+\n[\s\S]*?```/g, "")
    .replace(/\[Araç çıktıları\][\s\S]*$/m, "")
    .trim();

  if (!cleaned) return;

  // Bot cevabını store'a yaz — Inbox UI'da görünür, sonraki promptlarda da
  // konuşma bağlamı korunur.
  useTelegramStore.getState().appendMessage(m.chat.id, sender, username, {
    role: "assistant",
    content: cleaned,
    ts: Date.now(),
  });

  // Telegram'a gönder
  try {
    await ipc.httpFetch({
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: m.chat.id,
        text: cleaned,
        parse_mode: "Markdown",
      }),
    });
    // Bildirim merkezine de düşür
    useNotificationStore.getState().add({
      taskId: `telegram-${m.message_id}`,
      title: `Telegram: ${sender}`,
      content: `> ${text}\n\n${cleaned}`,
    });
  } catch (e) {
    console.error("[telegram] gönderim hatası:", e);
    console.log("[telegram] gönderim hatası:", e);
  }
}

/**
 * Whitelist dışı bir chat'ten mesaj geldi: modele ASLA iletme. Chat'i pending
 * listesine ekle, sahibine uygulama içi bildirim düşür ve karşı tarafa tek
 * seferlik "özel bot" cevabı gönder. Aynı chat tekrar yazarsa sessiz kal.
 */
async function handlePairingRequest(
  token: string,
  m: NonNullable<TelegramUpdate["message"]>,
) {
  const t = useAppStore.getState().apps.find((a) => a.id === "telegram");
  if (!t) return;

  const cid = String(m.chat.id);
  const pending = parsePendingPairs(t.config);
  if (pending.some((p) => p.chatId === cid)) return; // zaten sorulmuş — spam yok

  const name = m.from?.username || m.from?.first_name || "bilinmeyen";
  useAppStore.getState().updateConfig("telegram", {
    ...t.config,
    pending_pairs: formatPendingPairs([...pending, { chatId: cid, name }]),
  });

  useNotificationStore.getState().add({
    taskId: `tg-pair-${cid}`,
    title: "Telegram eşleştirme isteği",
    content:
      `"${name}" (chat ${cid}) botunla konuşmak istiyor. ` +
      `Uygulamalar → Telegram ayarlarından onaylayana kadar mesajları yanıtlanmayacak.`,
  });

  try {
    await ipc.httpFetch({
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: m.chat.id,
        text: "Bu bot özel kullanımdadır. Eşleştirme isteğin sahibine iletildi — onaylanırsa yazışabiliriz.",
      }),
    });
  } catch (e) {
    console.warn("[telegram] eşleştirme cevabı gönderilemedi:", e);
  }
}

export function useTelegramAutoMode() {
  const telegram = useAppStore((s) => s.apps.find((a) => a.id === "telegram"));
  const enabled = !!telegram?.enabled;
  const autoOn = telegram?.config?.auto_mode === "true";
  const token = telegram?.config?.bot_token;

  // Geçiş tohumu: whitelist hiç kurulmamışsa (anahtar yok) ve kullanıcı daha
  // önce bir "Chat ID" girmişse onu onaylı say — mevcut kullanıcının botu
  // güncelleme sonrası aniden susmasın. Anahtar bir kez yazıldıktan sonra
  // (boş bile olsa) tekrar tohumlanmaz.
  useEffect(() => {
    if (!enabled || !token) return;
    const t = useAppStore.getState().apps.find((a) => a.id === "telegram");
    if (!t || t.config.allowed_chat_ids !== undefined) return;
    useAppStore.getState().updateConfig("telegram", {
      ...t.config,
      allowed_chat_ids: (t.config.chat_id ?? "").trim(),
    });
  }, [enabled, token]);

  useEffect(() => {
    if (!enabled || !autoOn || !token) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled) return;

      // Aktif config'i her seferinde yeniden oku — kullanıcı arada bot_token'ı
      // değiştirebilir veya otomatik modu kapatabilir.
      const t = useAppStore.getState().apps.find((a) => a.id === "telegram");
      if (!t?.enabled || t.config.auto_mode !== "true" || !t.config.bot_token) return;
      const tk = t.config.bot_token;
      const lastId = parseInt(t.config.last_update_id || "0", 10);
      const offsetParam = lastId > 0 ? `&offset=${lastId + 1}` : "";

      try {
        // Webhook setli ise bir kere kaldır (idempotent, hızlı dön)
        if (!t.config.webhook_cleared) {
          await ipc.httpFetch({
            url: `https://api.telegram.org/bot${tk}/deleteWebhook?drop_pending_updates=false`,
          }).catch(() => { });
          useAppStore.getState().updateConfig("telegram", {
            ...t.config,
            webhook_cleared: "true",
          });
        }

        const resp = await ipc.httpFetch({
          url:
            `https://api.telegram.org/bot${tk}/getUpdates` +
            `?limit=10&timeout=${POLL_TIMEOUT_SECS}` +
            `&allowed_updates=${encodeURIComponent('["message"]')}` +
            offsetParam,
        });
        if (cancelled) return;

        const data = JSON.parse(resp.body);
        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
          const allowed = parseAllowedChatIds(t.config);
          let maxId = lastId;
          for (const u of data.result as TelegramUpdate[]) {
            if (u.update_id > maxId) maxId = u.update_id;
            if (!u.message) continue;
            if (allowed.has(String(u.message.chat.id))) {
              await handleTelegramMessage(tk, u.message);
            } else {
              await handlePairingRequest(tk, u.message);
            }
          }
          // Offset'i ilerletmek "okundu" işareti
          const cur = useAppStore.getState().apps.find((a) => a.id === "telegram");
          if (cur) {
            useAppStore.getState().updateConfig("telegram", {
              ...cur.config,
              last_update_id: String(maxId),
              webhook_cleared: "true",
            });
          }
        }
      } catch (e) {
        console.warn("[telegram] poll hata:", e);
      }

      if (!cancelled) timeout = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [enabled, autoOn, token]);
}
