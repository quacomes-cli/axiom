// Masaüstü uzak-eşleştirme durumu. PhoneConnectDialog buradan beslenir.
// rtcHost oturumunu sahiplenir; protokol/relay (Faz 2) setMessageHandler ile bağlanır.

import { create } from "zustand";
import { startHostSession, type HostSession, type RtcStatus } from "../lib/rtcHost";
import { useAuthStore } from "./authStore";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useModelStore } from "./modelStore";
import { encryptData } from "../lib/crypto";

type MessageHandler = (msg: unknown, send: (m: unknown) => void) => void;

interface RemoteState {
  status: RtcStatus;
  qrPayload: string | null;
  deviceName: string | null;
  error: string | null;
  session: HostSession | null;
  /** Faz 2: protokol mesajlarını işleyen relay burada bağlanır. */
  messageHandler: MessageHandler | null;
  syncSessionEnabled: boolean;
  cloudKeySyncEnabled: boolean;
  masterPassphrase: string;
  setCloudKeySyncEnabled: (val: boolean) => void;
  setMasterPassphrase: (val: string) => void;
  syncCloudKeys: () => Promise<void>;

  startPairing: () => Promise<void>;
  /** Aktif oturum yoksa (idle/error) eşleştirmeyi başlatır; paired/waiting ise dokunmaz. */
  ensurePairing: () => Promise<void>;
  stopPairing: () => void;
  setMessageHandler: (h: MessageHandler | null) => void;
  /** Doğrulanmış istemciye mesaj yolla (relay için). */
  send: (msg: unknown) => void;
  setSyncSessionEnabled: (val: boolean) => void;
}

const getDeviceId = () => {
  let id = localStorage.getItem("axiom_desktop_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("axiom_desktop_device_id", id);
  }
  return id;
};

const getPlatformName = () => {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows Masaüstü";
  if (/Macintosh/i.test(ua)) return "Mac Masaüstü";
  if (/Linux/i.test(ua)) return "Linux Masaüstü";
  return "Masaüstü Bilgisayar";
};

const updatePresence = async () => {
  const user = useAuthStore.getState().user;
  if (!user) return;

  const session = useRemoteStore.getState().session;
  const status = useRemoteStore.getState().status;
  const deviceId = getDeviceId();
  const docRef = doc(db, "users", user.uid, "devices", deviceId);

  try {
    if (session && (status === "waiting" || status === "connecting" || status === "verifying" || status === "paired")) {
      await setDoc(docRef, {
        name: getPlatformName(),
        sessionId: session.sessionId,
        secret: session.secret,
        updatedAt: serverTimestamp(),
        online: true
      });
      console.log("Published desktop presence to cloud: online = true");
    } else if (status === "idle" || status === "error") {
      await setDoc(docRef, {
        online: false,
        updatedAt: serverTimestamp()
      }, { merge: true });
      console.log("Published desktop presence to cloud: online = false");
    }
  } catch (err) {
    console.error("Failed to update desktop presence:", err);
  }
};

// Listen to authentication changes on desktop to update presence and start/stop host pairing
useAuthStore.subscribe((state) => {
  void updatePresence();
  if (state.user) {
    // Automatically start pairing host session if logged in so mobile can connect immediately
    void useRemoteStore.getState().ensurePairing();
    // Sync keys on login
    if (useRemoteStore.getState().cloudKeySyncEnabled) {
      void useRemoteStore.getState().syncCloudKeys();
    }
    // Sync session if already paired
    if (useRemoteStore.getState().status === "paired" && useRemoteStore.getState().syncSessionEnabled && state.googleIdToken) {
      useRemoteStore.getState().send({ type: "auth_sync", idToken: state.googleIdToken });
    }
  } else {
    // Stop host session on log out
    useRemoteStore.getState().stopPairing();
  }
});

// Listen to model store changes to auto-sync keys
useModelStore.subscribe(() => {
  if (useRemoteStore.getState().cloudKeySyncEnabled) {
    void useRemoteStore.getState().syncCloudKeys();
  }
});

export const useRemoteStore = create<RemoteState>()((set, get) => ({
  status: "idle",
  qrPayload: null,
  deviceName: null,
  error: null,
  session: null,
  messageHandler: null,
  syncSessionEnabled: localStorage.getItem("axiom_remote_sync_session") === "true",
  cloudKeySyncEnabled: localStorage.getItem("axiom_remote_cloud_key_sync") === "true",
  masterPassphrase: localStorage.getItem("axiom_remote_master_passphrase") || "",

  setSyncSessionEnabled: (val) => {
    localStorage.setItem("axiom_remote_sync_session", String(val));
    set({ syncSessionEnabled: val });
  },

  setCloudKeySyncEnabled: (val) => {
    localStorage.setItem("axiom_remote_cloud_key_sync", String(val));
    set({ cloudKeySyncEnabled: val });
    void get().syncCloudKeys();
  },

  setMasterPassphrase: (val) => {
    localStorage.setItem("axiom_remote_master_passphrase", val);
    set({ masterPassphrase: val });
    void get().syncCloudKeys();
  },

  syncCloudKeys: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    // Prevent race condition: do not sync or delete keys if store has not loaded yet
    const providersLoaded = useModelStore.getState().cloudProvidersLoaded;
    if (!providersLoaded) {
      console.log("Skipping syncCloudKeys because cloudProviders are not loaded yet.");
      return;
    }

    const enabled = get().cloudKeySyncEnabled;
    const passphrase = get().masterPassphrase;
    const docRef = doc(db, "users", user.uid, "secrets", "keys");

    if (!enabled || !passphrase) {
      try {
        await deleteDoc(docRef);
        console.log("Deleted cloud keys because sync is disabled or passphrase is empty.");
      } catch (err) {
        console.error("Failed to delete cloud keys:", err);
      }
      return;
    }

    try {
      const providers = useModelStore.getState().cloudProviders;
      const keysMap: Record<string, string> = {};
      for (const p of providers) {
        if (p.apiKey && p.apiKey !== "__keyring__") {
          keysMap[p.name.toLowerCase()] = p.apiKey;
        }
      }

      if (Object.keys(keysMap).length === 0) {
        await deleteDoc(docRef);
        return;
      }

      const encrypted = await encryptData(JSON.stringify(keysMap), passphrase);
      await setDoc(docRef, {
        ...encrypted,
        updatedAt: serverTimestamp()
      });
      console.log("Uploaded E2EE encrypted API keys to cloud.");
    } catch (err) {
      console.error("Failed to sync cloud keys:", err);
    }
  },

  startPairing: async () => {
    // Zaten aktif oturum varsa önce kapat.
    get().session?.close();
    set({ status: "waiting", error: null, deviceName: null, qrPayload: null });
    void updatePresence();
    try {
      const session = await startHostSession({
        onStatus: (status, info) => {
          set({
            status,
            deviceName: info?.deviceName ?? get().deviceName,
            error: info?.error ?? null,
          });
          void updatePresence();
          if (status === "paired" && get().syncSessionEnabled) {
            const googleIdToken = useAuthStore.getState().googleIdToken;
            if (googleIdToken) {
              get().send({ type: "auth_sync", idToken: googleIdToken });
            }
          }
        },
        onMessage: (msg) => {
          const h = get().messageHandler;
          if (h) h(msg, get().send);
        },
      });
      set({ session, qrPayload: session.qrPayload });
      void updatePresence();
    } catch (e) {
      set({ status: "error", error: String(e) });
      void updatePresence();
    }
  },

  ensurePairing: async () => {
    const s = get().status;
    if (s === "idle" || s === "error") await get().startPairing();
  },

  stopPairing: () => {
    get().session?.close();
    set({ status: "idle", session: null, qrPayload: null, deviceName: null, error: null });
    void updatePresence();
  },

  setMessageHandler: (h) => set({ messageHandler: h }),

  send: (msg) => get().session?.send(msg),
}));

