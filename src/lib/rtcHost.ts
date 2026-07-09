// Masaüstü WebRTC "host" (caller) — telefon ile P2P data channel kurar.
// Signaling Firestore üzerinden (yalnızca SDP/ICE); sohbet verisi ASLA
// Firestore'a yazılmaz, tamamen data channel'dan P2P akar.
//
// Akış:
//   startHostSession() → RTCPeerConnection + dataChannel("axiom") + offer
//     → signaling/{sessionId} dokümanına offer yazılır
//     → answer + callee ICE adayları dinlenir
//   QR = { v:1, s:sessionId, k:secret }  (secret Firestore'a YAZILMAZ)
//   Telefon bağlanınca data channel açılır; telefon `hello{secret}` yollar,
//   host doğrular → `paired{ok}`. Doğrulanmadan hiçbir sohbet verisi gitmez.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "./firebase";

export type RtcStatus =
  | "idle"
  | "waiting" // QR gösterildi, telefon bekleniyor
  | "connecting" // ICE bağlanıyor
  | "verifying" // data channel açık, secret doğrulanıyor
  | "paired" // eşleşme tamam
  | "error";

export interface HostCallbacks {
  onStatus?: (status: RtcStatus, info?: { deviceName?: string; error?: string }) => void;
  /** Doğrulanmış (paired) bir istemciden gelen protokol mesajı. */
  onMessage?: (msg: unknown) => void;
}

function iceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    list.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USER as string | undefined,
      credential: import.meta.env.VITE_TURN_CRED as string | undefined,
    });
  }
  return list;
}

async function ensureAuth(): Promise<void> {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface HostSession {
  sessionId: string;
  secret: string;
  /** QR'a gömülecek payload (JSON string). */
  qrPayload: string;
  /** Doğrulanmış istemciye JSON mesaj gönderir. */
  send: (msg: unknown) => void;
  /** Oturumu kapatır, signaling dokümanını temizler. */
  close: () => void;
}

export async function startHostSession(cb: HostCallbacks): Promise<HostSession> {
  await ensureAuth();

  const callDoc = doc(collection(db, "signaling"));
  const sessionId = callDoc.id;
  const secret = randomSecret();
  const callerCandidates = collection(callDoc, "callerCandidates");
  const calleeCandidates = collection(callDoc, "calleeCandidates");

  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let verified = false;
  let unsubs: Unsubscribe[] = [];
  let closed = false;
  let verifyTimer: number | undefined;
  let reconnecting = false;

  const setStatus = (s: RtcStatus, info?: { deviceName?: string; error?: string }) =>
    cb.onStatus?.(s, info);

  const cleanupSignaling = async () => {
    // Bağlantı kurulduktan sonra signaling verisi gereksiz — gizlilik için sil.
    try {
      for (const col of [callerCandidates, calleeCandidates]) {
        const snap = await getDocs(col);
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(callDoc);
    } catch {
      /* best-effort */
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (verifyTimer) clearTimeout(verifyTimer);
    unsubs.forEach((u) => u());
    try {
      channel?.close();
    } catch {
      /* noop */
    }
    try {
      pc?.close();
    } catch {
      /* noop */
    }
    void cleanupSignaling();
    setStatus("idle");
  };

  const send = (msg: unknown) => {
    if (channel && channel.readyState === "open") channel.send(JSON.stringify(msg));
  };

  const initiateConnection = async () => {
    if (closed) return;
    if (reconnecting) return;
    reconnecting = true;

    // Reset previous connection
    try { channel?.close(); } catch {}
    try { pc?.close(); } catch {}
    unsubs.forEach((u) => u());
    unsubs = [];
    verified = false;

    try {
      pc = new RTCPeerConnection({ iceServers: iceServers() });
      channel = pc.createDataChannel("axiom", { ordered: true });

      channel.onopen = () => {
        setStatus("verifying");
        void cleanupSignaling();
        // Güvenlik: doğrulama 30 sn içinde gelmezse bağlantıyı kapat.
        verifyTimer = window.setTimeout(() => {
          if (!verified) close();
        }, 30000);
      };

      channel.onclose = () => {
        if (closed) return;
        if (verified) {
          setStatus("connecting");
          void initiateConnection();
        } else {
          setStatus("idle");
        }
      };

      channel.onmessage = (ev) => {
        let msg: { type?: string; secret?: string; deviceName?: string };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        // El sıkışma: telefon `hello{secret}` yollar; doğrulanana kadar veri yok.
        if (!verified) {
          if (msg.type === "hello" && msg.secret === secret) {
            verified = true;
            if (verifyTimer) clearTimeout(verifyTimer);
            send({ type: "paired", ok: true });
            setStatus("paired", { deviceName: msg.deviceName });
          } else if (msg.type === "hello") {
            // Yanlış secret — reddet ve kapat.
            send({ type: "error", msg: "bad_secret" });
            close();
          }
          return;
        }
        cb.onMessage?.(msg);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) void addDoc(callerCandidates, e.candidate.toJSON());
      };

      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === "connecting") setStatus("connecting");
        if (pc && ["failed", "disconnected"].includes(pc.connectionState)) {
          if (!closed && verified) {
            setStatus("connecting");
            void initiateConnection();
          } else if (!verified) {
            setStatus("error", { error: pc.connectionState });
          }
        }
      };

      // Offer üret + Firestore'a yaz.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await setDoc(callDoc, {
        offer: { sdp: offer.sdp, type: offer.type },
        createdAt: serverTimestamp(),
      });
      setStatus("waiting");

      // Answer'ı dinle.
      unsubs.push(
        onSnapshot(callDoc, (snap) => {
          const data = snap.data();
          if (pc && !pc.currentRemoteDescription && data?.answer) {
            void pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
        }),
      );

      // Callee ICE adaylarını dinle.
      unsubs.push(
        onSnapshot(calleeCandidates, (snap) => {
          snap.docChanges().forEach((chg) => {
            if (chg.type === "added" && pc) {
              void pc.addIceCandidate(new RTCIceCandidate(chg.doc.data()));
            }
          });
        }),
      );
    } catch (e) {
      console.error("Failed to initiate WebRTC host connection:", e);
      setStatus("error", { error: String(e) });
    } finally {
      reconnecting = false;
    }
  };

  // İlk bağlantıyı tetikle
  void initiateConnection();

  const qrPayload = JSON.stringify({ v: 1, s: sessionId, k: secret });

  return { sessionId, secret, qrPayload, send, close };
}
