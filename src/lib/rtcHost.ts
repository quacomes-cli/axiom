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

  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  const channel = pc.createDataChannel("axiom", { ordered: true });

  const callDoc = doc(collection(db, "signaling"));
  const sessionId = callDoc.id;
  const secret = randomSecret();
  const callerCandidates = collection(callDoc, "callerCandidates");
  const calleeCandidates = collection(callDoc, "calleeCandidates");

  let verified = false;
  const unsubs: Unsubscribe[] = [];
  let closed = false;

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
    unsubs.forEach((u) => u());
    try {
      channel.close();
    } catch {
      /* noop */
    }
    try {
      pc.close();
    } catch {
      /* noop */
    }
    void cleanupSignaling();
    setStatus("idle");
  };

  const send = (msg: unknown) => {
    if (channel.readyState === "open") channel.send(JSON.stringify(msg));
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) void addDoc(callerCandidates, e.candidate.toJSON());
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connecting") setStatus("connecting");
    if (["failed", "disconnected", "closed"].includes(pc.connectionState) && !verified) {
      setStatus("error", { error: pc.connectionState });
    }
  };

  channel.onopen = () => {
    setStatus("verifying");
    void cleanupSignaling();
  };

  channel.onclose = () => {
    if (!closed) setStatus("idle");
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
        setStatus("paired", { deviceName: msg.deviceName });
        send({ type: "paired", ok: true });
      } else if (msg.type === "hello") {
        send({ type: "error", msg: "bad_secret" });
      }
      return;
    }
    cb.onMessage?.(msg);
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
      if (!pc.currentRemoteDescription && data?.answer) {
        void pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    }),
  );

  // Callee ICE adaylarını dinle.
  unsubs.push(
    onSnapshot(calleeCandidates, (snap) => {
      snap.docChanges().forEach((chg) => {
        if (chg.type === "added") {
          void pc.addIceCandidate(new RTCIceCandidate(chg.doc.data()));
        }
      });
    }),
  );

  const qrPayload = JSON.stringify({ v: 1, s: sessionId, k: secret });

  return { sessionId, secret, qrPayload, send, close };
}
