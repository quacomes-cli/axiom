// Mobil WebRTC "client" (callee) — masaüstü host'a QR ile eşleşir.
// Signaling Firestore (yalnızca SDP/ICE); sohbet verisi P2P data channel'dan akar.
//
// QR = { v:1, s:sessionId, k:secret }. Bağlanınca `hello{secret,deviceName}`
// yollanır; host doğrulayıp `paired{ok}` döner.

import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "./firebase";

export type ClientStatus = "connecting" | "verifying" | "paired" | "error";

export interface ClientCallbacks {
  onStatus?: (status: ClientStatus, err?: string) => void;
  /** Host'tan gelen protokol mesajı (paired sonrası). */
  onMessage?: (msg: unknown) => void;
}

export interface QrPayload {
  v: number;
  s: string; // sessionId
  k: string; // secret
}

export function parseQr(text: string): QrPayload | null {
  try {
    const p = JSON.parse(text);
    if (p && typeof p.s === "string" && typeof p.k === "string") return p as QrPayload;
  } catch {
    /* not our QR */
  }
  return null;
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
  if (!auth.currentUser) await signInAnonymously(auth);
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const m = ua.match(/Android[^;]*;\s*([^)]+?)\s+Build/i);
  if (m) return m[1];
  if (/Android/i.test(ua)) return "Android";
  return "Telefon";
}

export interface ClientConn {
  send: (msg: unknown) => void;
  close: () => void;
}

export async function joinSession(
  payload: QrPayload,
  cb: ClientCallbacks,
): Promise<ClientConn> {
  await ensureAuth();

  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  let channel: RTCDataChannel | null = null;
  let verified = false;
  const unsubs: Unsubscribe[] = [];
  let closed = false;

  const callDoc = doc(db, "signaling", payload.s);
  const snap = await getDoc(callDoc);
  if (!snap.exists()) {
    cb.onStatus?.("error", "session_not_found");
    throw new Error("session_not_found");
  }

  const callerCandidates = collection(callDoc, "callerCandidates");
  const calleeCandidates = collection(callDoc, "calleeCandidates");

  const close = () => {
    if (closed) return;
    closed = true;
    unsubs.forEach((u) => u());
    try {
      channel?.close();
    } catch {
      /* noop */
    }
    try {
      pc.close();
    } catch {
      /* noop */
    }
  };

  const send = (msg: unknown) => {
    if (channel?.readyState === "open") channel.send(JSON.stringify(msg));
  };

  const wireChannel = (ch: RTCDataChannel) => {
    channel = ch;
    ch.onopen = () => {
      cb.onStatus?.("verifying");
      send({ type: "hello", secret: payload.k, deviceName: deviceName() });
    };
    ch.onmessage = (ev) => {
      let msg: { type?: string; ok?: boolean; msg?: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!verified) {
        if (msg.type === "paired" && msg.ok) {
          verified = true;
          cb.onStatus?.("paired");
        } else if (msg.type === "error") {
          cb.onStatus?.("error", msg.msg ?? "handshake_failed");
        }
        return;
      }
      cb.onMessage?.(msg);
    };
    ch.onclose = () => {
      if (!closed) cb.onStatus?.("error", "closed");
    };
  };

  pc.ondatachannel = (e) => wireChannel(e.channel);
  pc.onicecandidate = (e) => {
    if (e.candidate) void addDoc(calleeCandidates, e.candidate.toJSON());
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connecting") cb.onStatus?.("connecting");
    if (["failed", "disconnected"].includes(pc.connectionState) && !verified) {
      cb.onStatus?.("error", pc.connectionState);
    }
  };

  // Offer'ı al, answer üret.
  await pc.setRemoteDescription(new RTCSessionDescription(snap.data().offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateDoc(callDoc, { answer: { sdp: answer.sdp, type: answer.type } });
  cb.onStatus?.("connecting");

  // Caller ICE adaylarını dinle.
  unsubs.push(
    onSnapshot(callerCandidates, (s) => {
      s.docChanges().forEach((chg) => {
        if (chg.type === "added") {
          void pc.addIceCandidate(new RTCIceCandidate(chg.doc.data()));
        }
      });
    }),
  );

  return { send, close };
}
