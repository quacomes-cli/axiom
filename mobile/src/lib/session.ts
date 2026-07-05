// Mobil oturum durumu (Solid signals). Scanner eşleşince buraya bağlanır;
// Faz 3'te sohbet protokolü mesajları buradan dinlenir.

import { createSignal } from "solid-js";
import { joinSession, parseQr, type ClientConn, type ClientStatus } from "./rtcClient";

export type SessionStatus = "idle" | ClientStatus;

const [status, setStatus] = createSignal<SessionStatus>("idle");
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

export { status, errorMsg };

let conn: ClientConn | null = null;
type MessageHandler = (msg: unknown) => void;
let messageHandler: MessageHandler | null = null;

export function setMessageHandler(h: MessageHandler | null) {
  messageHandler = h;
}

export function sendMessage(msg: unknown) {
  conn?.send(msg);
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
      },
      onMessage: (msg) => messageHandler?.(msg),
    });
  } catch (e) {
    setStatus("error");
    setErrorMsg(String(e));
  }
  return true;
}

export function reset() {
  conn?.close();
  conn = null;
  setStatus("idle");
  setErrorMsg(null);
}
