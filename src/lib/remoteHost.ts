// Uzak sohbet relay'i — eşleşmiş telefonla data channel protokolünü işler.
// Telefon yalnızca `remoteAllowed=true` sohbetleri görebilir/kullanabilir.
//
// Protokol (telefon → masaüstü):
//   list_chats                          → chats
//   open_chat  { chatId }               → history
//   send_message { chatId, text }       → token* (stream)
//   stop                                → üretimi durdur
// (masaüstü → telefon): chats, history, token{delta,done}, error

import { useChatStore, type Chat } from "../stores/chatStore";
import { useModelStore, modelSupportsTools } from "../stores/modelStore";
import { useRemoteStore } from "../stores/remoteStore";

type Send = (msg: unknown) => void;

interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  preview: string;
}

function allowed(): Chat[] {
  return useChatStore.getState().chats.filter((c) => c.remoteAllowed);
}

function summarize(c: Chat): ChatSummary {
  const last = [...c.messages].reverse().find((m) => m.text?.trim());
  return {
    id: c.id,
    title: c.title || "…",
    updatedAt: c.createdAt,
    preview: (last?.text ?? "").slice(0, 80),
  };
}

function chatList(): ChatSummary[] {
  return allowed().map(summarize);
}

function settingsPayload() {
  const cs = useChatStore.getState();
  const ms = useModelStore.getState();
  const active = ms.models.find((m) => m.isActive);
  return {
    type: "settings",
    toolUse: cs.toolUseEnabled,
    mode: cs.chatMode,
    activeModel: active?.id ?? null,
    models: ms.models.map((m) => ({
      id: m.id,
      provider: m.provider,
      name: m.displayName,
      tools: modelSupportsTools(m),
      thinking: !!m.capabilities?.includes("thinking"),
    })),
  };
}

function historyOf(chatId: string) {
  const c = useChatStore.getState().chats.find((x) => x.id === chatId);
  if (!c || !c.remoteAllowed) return null;
  return c.messages
    .filter((m) => m.role === "user" || m.role === "agent")
    .map((m) => ({ id: m.id, role: m.role, text: m.text }));
}

async function handleRemoteSend(chatId: string, text: string, send: Send) {
  const store = useChatStore.getState();
  const chat = store.chats.find((c) => c.id === chatId);
  if (!chat || !chat.remoteAllowed) {
    send({ type: "error", msg: "not_allowed" });
    return;
  }
  if (!text.trim()) return;
  if (store.activeChatId !== chatId) store.switchChat(chatId);

  // Asistan cevabını token token yansıt: store aboneliğiyle son agent mesajının
  // metin büyümesini izle, deltayı gönder.
  let lastText = "";
  let agentMsgId: string | null = null;
  const unsub = useChatStore.subscribe((s) => {
    const c = s.chats.find((cc) => cc.id === chatId);
    if (!c) return;
    const lastMsg = c.messages[c.messages.length - 1];
    if (lastMsg && lastMsg.role === "agent") {
      agentMsgId = lastMsg.id;
      if (lastMsg.text !== lastText) {
        const delta = lastMsg.text.slice(lastText.length);
        lastText = lastMsg.text;
        if (delta) send({ type: "token", chatId, msgId: lastMsg.id, delta, done: false });
      }
    }
  });

  try {
    await useChatStore.getState().send(text);
  } catch (e) {
    send({ type: "error", msg: String(e) });
  } finally {
    unsub();
    send({ type: "token", chatId, msgId: agentMsgId, delta: "", done: true });
  }
}

function handleMessage(raw: unknown, send: Send) {
  const msg = raw as {
    type?: string;
    chatId?: string;
    text?: string;
    on?: boolean;
    mode?: "fast" | "balanced" | "thinking";
    id?: string;
    provider?: string;
  };
  switch (msg?.type) {
    case "list_chats":
      send({ type: "chats", chats: chatList() });
      send(settingsPayload()); // ilk açılışta ayarları da yolla
      break;
    case "get_settings":
      send(settingsPayload());
      break;
    case "open_chat": {
      const h = msg.chatId ? historyOf(msg.chatId) : null;
      if (h) send({ type: "history", chatId: msg.chatId, messages: h });
      else send({ type: "error", msg: "not_allowed" });
      break;
    }
    case "send_message":
      if (msg.chatId) void handleRemoteSend(msg.chatId, String(msg.text ?? ""), send);
      break;
    case "set_tool":
      useChatStore.getState().setToolUseEnabled(!!msg.on);
      send(settingsPayload());
      break;
    case "set_mode":
      if (msg.mode) useChatStore.getState().setChatMode(msg.mode);
      send(settingsPayload());
      break;
    case "set_model":
      if (msg.id && msg.provider) {
        void useModelStore
          .getState()
          .setActive(msg.provider as "ollama" | "cloud" | "llamacpp", msg.id)
          .then(() => send(settingsPayload()));
      }
      break;
    case "stop":
      useChatStore.getState().stopGeneration();
      break;
  }
}

let inited = false;

/** Uygulama açılışında bir kez çağrılır: relay handler'ı bağlar + izinli sohbet
    listesindeki değişiklikleri eşleşmiş telefona canlı yansıtır. */
export function initRemoteHost() {
  if (inited) return;
  inited = true;

  useRemoteStore.getState().setMessageHandler(handleMessage);

  // İzinli sohbet kümesi/başlık/mesaj-sayısı değişince listeyi telefona it.
  let lastSig = "";
  useChatStore.subscribe((s) => {
    if (useRemoteStore.getState().status !== "paired") return;
    const sig = s.chats
      .filter((c) => c.remoteAllowed)
      .map((c) => `${c.id}:${c.messages.length}:${c.title}`)
      .join("|");
    if (sig !== lastSig) {
      lastSig = sig;
      useRemoteStore.getState().send({ type: "chats", chats: chatList() });
    }
  });

  // Araç/mod/aktif-model değişince ayarları telefona it.
  let lastSettingsSig = "";
  const pushSettings = () => {
    if (useRemoteStore.getState().status !== "paired") return;
    const cs = useChatStore.getState();
    const active = useModelStore.getState().models.find((m) => m.isActive);
    const sig = `${cs.toolUseEnabled}:${cs.chatMode}:${active?.id ?? ""}`;
    if (sig !== lastSettingsSig) {
      lastSettingsSig = sig;
      useRemoteStore.getState().send(settingsPayload());
    }
  };
  useChatStore.subscribe(pushSettings);
  useModelStore.subscribe(pushSettings);
}
