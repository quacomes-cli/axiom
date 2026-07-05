// Masaüstü uzak-eşleştirme durumu. PhoneConnectDialog buradan beslenir.
// rtcHost oturumunu sahiplenir; protokol/relay (Faz 2) setMessageHandler ile bağlanır.

import { create } from "zustand";
import { startHostSession, type HostSession, type RtcStatus } from "../lib/rtcHost";

type MessageHandler = (msg: unknown, send: (m: unknown) => void) => void;

interface RemoteState {
  status: RtcStatus;
  qrPayload: string | null;
  deviceName: string | null;
  error: string | null;
  session: HostSession | null;
  /** Faz 2: protokol mesajlarını işleyen relay burada bağlanır. */
  messageHandler: MessageHandler | null;

  startPairing: () => Promise<void>;
  /** Aktif oturum yoksa (idle/error) eşleştirmeyi başlatır; paired/waiting ise dokunmaz. */
  ensurePairing: () => Promise<void>;
  stopPairing: () => void;
  setMessageHandler: (h: MessageHandler | null) => void;
  /** Doğrulanmış istemciye mesaj yolla (relay için). */
  send: (msg: unknown) => void;
}

export const useRemoteStore = create<RemoteState>()((set, get) => ({
  status: "idle",
  qrPayload: null,
  deviceName: null,
  error: null,
  session: null,
  messageHandler: null,

  startPairing: async () => {
    // Zaten aktif oturum varsa önce kapat.
    get().session?.close();
    set({ status: "waiting", error: null, deviceName: null, qrPayload: null });
    try {
      const session = await startHostSession({
        onStatus: (status, info) =>
          set({
            status,
            deviceName: info?.deviceName ?? get().deviceName,
            error: info?.error ?? null,
          }),
        onMessage: (msg) => {
          const h = get().messageHandler;
          if (h) h(msg, get().send);
        },
      });
      set({ session, qrPayload: session.qrPayload });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  ensurePairing: async () => {
    const s = get().status;
    if (s === "idle" || s === "error") await get().startPairing();
  },

  stopPairing: () => {
    get().session?.close();
    set({ status: "idle", session: null, qrPayload: null, deviceName: null, error: null });
  },

  setMessageHandler: (h) => set({ messageHandler: h }),

  send: (msg) => get().session?.send(msg),
}));
