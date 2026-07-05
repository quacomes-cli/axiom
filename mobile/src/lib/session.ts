// Mobil oturum durumu (Solid signals) — eşleşme + sohbet protokolü.
// Masaüstü relay ile konuşur: list_chats/open_chat/send_message; token stream'i
// gelen agent mesajına yansıtır.

import { createSignal } from "solid-js";
import { joinSession, parseQr, type ClientConn, type ClientStatus } from "./rtcClient";

export type SessionStatus = "idle" | ClientStatus;

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  preview: string;
}

export interface Msg {
  id: string;
  role: string; // "user" | "agent"
  text: string;
}

const [status, setStatus] = createSignal<SessionStatus>("idle");
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
const [chats, setChats] = createSignal<ChatSummary[]>([]);
const [openChatId, setOpenChatId] = createSignal<string | null>(null);
const [messages, setMessages] = createSignal<Msg[]>([]);
const [busy, setBusy] = createSignal(false);

export { status, errorMsg, chats, openChatId, messages, busy };

let conn: ClientConn | null = null;

function send(msg: unknown) {
  conn?.send(msg);
}

// --- Gelen protokol mesajları ---
function onProtocol(raw: unknown) {
  const msg = raw as {
    type?: string;
    chats?: ChatSummary[];
    chatId?: string;
    messages?: Msg[];
    msgId?: string;
    delta?: string;
    done?: boolean;
    msg?: string;
  };
  switch (msg?.type) {
    case "chats":
      setChats(msg.chats ?? []);
      break;
    case "history":
      if (msg.chatId === openChatId()) setMessages(msg.messages ?? []);
      break;
    case "token": {
      if (msg.chatId !== openChatId()) break;
      const id = msg.msgId ?? "";
      if (msg.delta) {
        setMessages((cur) => {
          const idx = cur.findIndex((m) => m.id === id);
          if (idx === -1) {
            return [...cur, { id, role: "agent", text: msg.delta ?? "" }];
          }
          const copy = cur.slice();
          copy[idx] = { ...copy[idx], text: copy[idx].text + (msg.delta ?? "") };
          return copy;
        });
      }
      if (msg.done) setBusy(false);
      break;
    }
    case "error":
      setErrorMsg(msg.msg ?? "error");
      setBusy(false);
      break;
  }
}

/** QR metnini çözüp eşleştirmeyi başlatır. Geçerli QR değilse false döner. */
export async function pairFromQr(qrText: string): Promise<boolean> {
  const payload = parseQr(qrText);
  if (!payload) return false;

  setStatus("connecting");
  setErrorMsg(null);
  try {
    conn = await joinSession(payload, {
      onStatus: (s, err) => {
        setStatus(s);
        if (err) setErrorMsg(err);
        if (s === "paired") send({ type: "list_chats" }); // eşleşince listeyi iste
      },
      onMessage: onProtocol,
    });
  } catch (e) {
    setStatus("error");
    setErrorMsg(String(e));
  }
  return true;
}

export function openChat(id: string) {
  setOpenChatId(id);
  setMessages([]);
  send({ type: "open_chat", chatId: id });
}

export function backToList() {
  setOpenChatId(null);
  setMessages([]);
}

export function sendChat(text: string) {
  const id = openChatId();
  if (!id || !text.trim()) return;
  // İyimser: kendi mesajını hemen göster.
  setMessages((cur) => [
    ...cur,
    { id: `local-${Date.now()}`, role: "user", text },
  ]);
  setBusy(true);
  send({ type: "send_message", chatId: id, text });
}

export function stopGeneration() {
  send({ type: "stop" });
  setBusy(false);
}

export function reset() {
  conn?.close();
  conn = null;
  setStatus("idle");
  setErrorMsg(null);
  setChats([]);
  setOpenChatId(null);
  setMessages([]);
  setBusy(false);
}
