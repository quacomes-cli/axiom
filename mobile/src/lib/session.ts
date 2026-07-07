// Mobil oturum durumu (Solid signals) — eşleşme + sohbet protokolü.
// Masaüstü relay ile konuşur: list_chats/open_chat/send_message; token stream'i
// gelen agent mesajına yansıtır.

import { createSignal } from "solid-js";
import { joinSession, parseQr, type ClientConn, type ClientStatus } from "./rtcClient";
import {
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  GoogleAuthProvider,
  type User,
} from "firebase/auth";
import { auth, db } from "./firebase";
import { collection, doc, getDoc, query, orderBy, onSnapshot, updateDoc } from "firebase/firestore";
import { decryptData } from "./crypto";

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

export interface RModel {
  id: string;
  provider: string;
  name: string;
  tools: boolean;
  thinking: boolean;
}

export type RMode = "fast" | "balanced" | "thinking";

const [status, setStatus] = createSignal<SessionStatus>("idle");
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
const [chats, setChats] = createSignal<ChatSummary[]>([]);
const [openChatId, setOpenChatId] = createSignal<string | null>(null);
const [messages, setMessages] = createSignal<Msg[]>([]);
const [busy, setBusy] = createSignal(false);
const [currentUser, setCurrentUser] = createSignal<User | null>(null);

export interface UserProfile {
  name?: string;
  surname?: string;
  email?: string;
  location?: string;
  birthDate?: string;
  customFields: Array<{ key: string; value: string }>;
  profession?: string;
  interests: string[];
  languagePreference?: "tr" | "en" | "mixed";
  responseStyle?: string;
  jargon: string[];
  recurringTopics: string[];
  notes: string[];
  lastUpdated: number;
  factCount: number;
}

const [cloudProfile, setCloudProfile] = createSignal<UserProfile | null>(null);
const [cloudProfileEnabled, setCloudProfileEnabled] = createSignal<boolean>(true);
const [decryptedKeys, setDecryptedKeys] = createSignal<Record<string, string> | null>(null);
const [masterPassphrase, setPassphraseSig] = createSignal<string>(localStorage.getItem("axiom_mobile_master_passphrase") || "");
const [cloudKeysLoading, setCloudKeysLoading] = createSignal(false);
const [cloudKeysError, setCloudKeysError] = createSignal<string | null>(null);

let profileUnsub: (() => void) | null = null;

export function listenCloudProfile(uid: string) {
  profileUnsub?.();
  const docRef = doc(db, "users", uid, "data", "profile");
  profileUnsub = onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      if ("profile" in data) {
        setCloudProfile(data.profile as UserProfile);
        setCloudProfileEnabled(data.enabled !== false);
      } else {
        const { updatedAt, ...profile } = data;
        setCloudProfile(profile as UserProfile);
        setCloudProfileEnabled(true);
      }
    } else {
      setCloudProfile(null);
      setCloudProfileEnabled(true);
    }
  }, (err) => {
    console.error("Failed to listen to cloud profile:", err);
  });
}

async function tryDecryptCloudKeys(passphrase: string): Promise<boolean> {
  const user = currentUser();
  if (!user) return false;

  setCloudKeysLoading(true);
  setCloudKeysError(null);

  try {
    const docRef = doc(db, "users", user.uid, "secrets", "keys");
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      setCloudKeysError("Bulutta kayıtlı anahtar bulunamadı.");
      setCloudKeysLoading(false);
      return false;
    }

    const data = snap.data();
    const decryptedJson = await decryptData({
      ciphertext: data.ciphertext,
      iv: data.iv,
      salt: data.salt
    }, passphrase);

    const keys = JSON.parse(decryptedJson);
    setDecryptedKeys(keys);
    setPassphraseSig(passphrase);
    localStorage.setItem("axiom_mobile_master_passphrase", passphrase);
    setCloudKeysLoading(false);
    updateDirectModels();
    return true;
  } catch (err) {
    console.error("Failed to decrypt cloud keys:", err);
    setCloudKeysError("Hatalı parola veya deşifre hatası.");
    setCloudKeysLoading(false);
    return false;
  }
}

export function updateDirectModels() {
  const keys = decryptedKeys();
  if (!keys) {
    setModels([]);
    return;
  }
  const list: RModel[] = [];
  const providers = Object.keys(keys);

  if (providers.includes("gemini")) {
    list.push({ id: "gemini-2.5-flash", provider: "gemini", name: "Gemini 2.5 Flash", tools: false, thinking: false });
    list.push({ id: "gemini-2.5-pro", provider: "gemini", name: "Gemini 2.5 Pro", tools: false, thinking: false });
  }
  if (providers.includes("openai")) {
    list.push({ id: "gpt-4o-mini", provider: "openai", name: "GPT-4o Mini", tools: false, thinking: false });
    list.push({ id: "gpt-4o", provider: "openai", name: "GPT-4o", tools: false, thinking: false });
  }
  if (providers.includes("anthropic")) {
    list.push({ id: "claude-3-5-sonnet-latest", provider: "anthropic", name: "Claude 3.5 Sonnet", tools: false, thinking: false });
  }

  setModels(list);
  if (list.length > 0 && (!activeModelId() || !list.find(m => m.id === activeModelId()))) {
    setActiveModelId(list[0].id);
  }
}

export function getPromptInjection(profile: UserProfile | null): string | null {
  if (!profile) return null;
  const lines: string[] = ["# Kullanıcı Bağlamı (dahili — doğrudan referans verme)", ""];
  lines.push(
    "Bu bilgiler arka planda yanıtlarını kişiselleştirmek için var. " +
    "Bunları konuşmada açıkça belirtme, listeye dökme veya \"profilinden görüyorum ki\" tarzı ifadeler kullanma. " +
    "Sadece doğal bir şekilde yanıtlarını şekillendir."
  );
  lines.push("");
  if (profile.name || profile.surname) lines.push(`- İsim: ${[profile.name, profile.surname].filter(Boolean).join(" ")}`);
  if (profile.email) lines.push(`- E-posta: ${profile.email}`);
  if (profile.location) lines.push(`- Konum: ${profile.location}`);
  if (profile.birthDate) lines.push(`- Doğum tarihi: ${profile.birthDate}`);
  if (profile.profession) lines.push(`- Meslek: ${profile.profession}`);
  if (profile.languagePreference) lines.push(`- Dil tercihi: ${profile.languagePreference}`);
  if (profile.interests?.length) lines.push(`- İlgi alanları: ${profile.interests.join(", ")}`);
  if (profile.responseStyle) lines.push(`- Yanıt tarzı: ${profile.responseStyle}`);
  if (profile.jargon?.length) lines.push(`- Sık kullandığı terimler: ${profile.jargon.join(", ")}`);
  if (profile.recurringTopics?.length) lines.push(`- Sık konuştuğu konular: ${profile.recurringTopics.join(", ")}`);
  if (profile.notes?.length) lines.push(`- Notlar: ${profile.notes.join(" | ")}`);
  for (const cf of profile.customFields ?? []) {
    if (cf.key && cf.value) lines.push(`- ${cf.key}: ${cf.value}`);
  }
  return lines.join("\n");
}

export async function sendDirectChat(chatId: string, text: string) {
  const user = currentUser();
  const keys = decryptedKeys();
  const modelId = activeModelId();
  if (!user || !keys || !modelId) {
    setBusy(false);
    return;
  }

  let provider = "gemini";
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-")) provider = "openai";
  else if (modelId.startsWith("claude-")) provider = "anthropic";

  const apiKey = keys[provider];
  if (!apiKey) {
    setBusy(false);
    setErrorMsg(`${provider.toUpperCase()} API anahtarı deşifre edilemedi.`);
    return;
  }

  try {
    let reply = "";
    const systemText = cloudProfileEnabled() ? getPromptInjection(cloudProfile()) : null;

    if (provider === "gemini") {
      const history = messages().map(m => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }]
      }));
      history.push({ role: "user", parts: [{ text }] });

      const body: any = { contents: history };
      if (systemText) {
        body.systemInstruction = { parts: [{ text: systemText }] };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!resp.ok) throw new Error(await resp.text());
      const json = await resp.json();
      reply = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (provider === "openai") {
      const openAiMsgs: any[] = [];
      if (systemText) {
        openAiMsgs.push({ role: "system", content: systemText });
      }
      messages().forEach(m => {
        openAiMsgs.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
      });
      openAiMsgs.push({ role: "user", content: text });

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelId,
          messages: openAiMsgs
        })
      });
      if (!resp.ok) throw new Error(await resp.text());
      const json = await resp.json();
      reply = json.choices?.[0]?.message?.content || "";
    } else if (provider === "anthropic") {
      const anthropicMsgs = messages().map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text
      }));
      anthropicMsgs.push({ role: "user", content: text });

      const body: any = {
        model: modelId,
        messages: anthropicMsgs,
        max_tokens: 1024
      };
      if (systemText) {
        body.system = systemText;
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "dangerously-allow-html-user-delegation": "true"
        },
        body: JSON.stringify(body)
      });
      if (!resp.ok) throw new Error(await resp.text());
      const json = await resp.json();
      reply = json.content?.[0]?.text || "";
    }

    const docRef = doc(db, "users", user.uid, "chats", chatId);
    const updatedMsgs = [
      ...messages().map(m => ({ id: m.id, role: m.role === "user" ? "user" : "model", text: m.text })),
      { id: `m-${Date.now()}-u`, role: "user", text },
      { id: `m-${Date.now()}-a`, role: "model", text: reply }
    ];

    await updateDoc(docRef, {
      messages: updatedMsgs,
      updatedAt: Date.now()
    });

  } catch (err) {
    console.error("Direct execution failed:", err);
    setErrorMsg(`Direct model hatası: ${String(err)}`);
  } finally {
    setBusy(false);
  }
}

export interface CloudDevice {
  id: string;
  name: string;
  sessionId: string;
  secret: string;
  online: boolean;
  updatedAt: number;
}
const [cloudDevices, setCloudDevices] = createSignal<CloudDevice[]>([]);
let devicesUnsub: (() => void) | null = null;

export function listenCloudDevices(uid: string) {
  devicesUnsub?.();
  const colRef = collection(db, "users", uid, "devices");
  devicesUnsub = onSnapshot(colRef, (snap) => {
    const list: CloudDevice[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      const updated = data.updatedAt && typeof data.updatedAt.toMillis === "function"
        ? data.updatedAt.toMillis()
        : (typeof data.updatedAt === "number" ? data.updatedAt : Date.now());
      
      // If the device is online and was updated within the last 2 hours (generous window to prevent clock desync issues)
      const isRecent = (Date.now() - updated) < 2 * 60 * 60 * 1000;
      if (data.online && isRecent) {
        list.push({
          id: doc.id,
          name: data.name ?? "Masaüstü Bilgisayar",
          sessionId: data.sessionId,
          secret: data.secret,
          online: !!data.online,
          updatedAt: updated,
        });
      }
    });
    setCloudDevices(list);
  });
}

export async function connectToCloudDevice(device: CloudDevice) {
  const qrText = JSON.stringify({ s: device.sessionId, k: device.secret });
  return await pairFromQr(qrText);
}

// Model/mod/araç ayarları (masaüstünden yansır).
const [models, setModels] = createSignal<RModel[]>([]);
const [activeModelId, setActiveModelId] = createSignal<string | null>(null);
const [mode, setModeSig] = createSignal<RMode>("balanced");
const [toolUse, setToolUseSig] = createSignal(false);

let cloudChatsUnsub: (() => void) | null = null;

// Subscribe to auth state updates
onAuthStateChanged(auth, (user) => {
  setCurrentUser(user);
  if (user && !user.isAnonymous) {
    listenCloudDevices(user.uid);
    listenCloudProfile(user.uid);
    if (status() !== "paired") {
      listenCloudChats(user.uid);
      const savedPass = localStorage.getItem("axiom_mobile_master_passphrase");
      if (savedPass) {
        void tryDecryptCloudKeys(savedPass);
      }
    }
  } else {
    devicesUnsub?.();
    devicesUnsub = null;
    setCloudDevices([]);
    cloudChatsUnsub?.();
    cloudChatsUnsub = null;
    profileUnsub?.();
    profileUnsub = null;
    setCloudProfile(null);
    setDecryptedKeys(null);
  }
});

export {
  status,
  errorMsg,
  chats,
  openChatId,
  messages,
  busy,
  models,
  activeModelId,
  mode,
  toolUse,
  currentUser,
  cloudDevices,
  cloudProfile,
  cloudProfileEnabled,
  decryptedKeys,
  masterPassphrase,
  cloudKeysLoading,
  cloudKeysError,
  tryDecryptCloudKeys,
  createDirectChat,
};

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
    models?: RModel[];
    activeModel?: string;
    mode?: RMode;
    toolUse?: boolean;
    idToken?: string;
  };
  switch (msg?.type) {
    case "chats":
      setChats(msg.chats ?? []);
      break;
    case "settings":
      if (msg.models) setModels(msg.models);
      if (msg.activeModel !== undefined) setActiveModelId(msg.activeModel ?? null);
      if (msg.mode) setModeSig(msg.mode);
      if (typeof msg.toolUse === "boolean") setToolUseSig(msg.toolUse);
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
    case "auth_sync": {
      if (msg.idToken) {
        const credential = GoogleAuthProvider.credential(msg.idToken);
        signInWithCredential(auth, credential)
          .then((res) => {
            console.log("Successfully synced Firebase Auth from desktop:", res.user.email);
          })
          .catch((err) => {
            console.error("Failed to sync Firebase Auth from desktop:", err);
          });
      }
      break;
    }
    case "error":
      setErrorMsg(msg.msg ?? "error");
      setBusy(false);
      break;
  }
}

// Otomatik yeniden bağlanma sayacı — paired olunca sıfırlanır, her kopuşta
// artan gecikmeyle (2s * deneme) tekrar denenir.
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/** QR metnini çözüp eşleştirmeyi başlatır. Geçerli QR değilse false döner. */
export async function pairFromQr(qrText: string): Promise<boolean> {
  const payload = parseQr(qrText);
  if (!payload) return false;

  setStatus("connecting");
  setErrorMsg(null);

  // Connection timeout after 8 seconds
  const timeoutId = setTimeout(() => {
    if (status() === "connecting" || status() === "verifying") {
      console.warn("Connection attempt timed out.");
      conn?.close();
      conn = null;
      setStatus("error");
      setErrorMsg("Bağlantı zaman aşımına uğradı");
    }
  }, 8000);

  try {
    conn = await joinSession(payload, {
      onStatus: (s, err) => {
        setStatus(s);
        if (err) setErrorMsg(err);
        if (s === "paired") {
          clearTimeout(timeoutId);
          reconnectAttempts = 0; // reset
          send({ type: "list_chats" }); // eşleşince listeyi iste
          localStorage.setItem("axiom_paired_session", qrText);
        } else if (s === "error") {
          clearTimeout(timeoutId);
          if (localStorage.getItem("axiom_paired_session")) {
            // Auto reconnect loop
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts++;
              console.log(`Connection lost. Reconnecting attempt ${reconnectAttempts}...`);
              setTimeout(() => {
                const saved = localStorage.getItem("axiom_paired_session");
                if (saved) void pairFromQr(saved);
              }, 2000 * reconnectAttempts);
            }
          }
        }
      },
      onMessage: onProtocol,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    setStatus("error");
    setErrorMsg(String(e));
  }
  return true;
}

export function openChat(id: string) {
  setOpenChatId(id);
  setMessages([]);
  const user = currentUser();
  const isCloud = user && !user.isAnonymous && status() !== "paired";
  if (isCloud) {
    void openCloudChat(id);
  } else {
    send({ type: "open_chat", chatId: id });
  }
}

let activeChatUnsub: (() => void) | null = null;

export function openCloudChat(chatId: string) {
  activeChatUnsub?.();
  const user = currentUser();
  if (!user) return;
  const docRef = doc(db, "users", user.uid, "chats", chatId);
  activeChatUnsub = onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      const cloudMsgs = data.messages ?? [];
      const msgs = cloudMsgs.map((cm: any) => ({
        id: cm.id,
        role: cm.role,
        text: cm.text,
      }));
      setMessages(msgs);
    }
  }, (err) => {
    console.error("Failed to listen to cloud messages:", err);
  });
}

export function listenCloudChats(uid: string) {
  cloudChatsUnsub?.();
  const q = query(collection(db, "users", uid, "chats"), orderBy("updatedAt", "desc"));
  cloudChatsUnsub = onSnapshot(q, (snap) => {
    const list: ChatSummary[] = snap.docs.map((d) => {
      const data = d.data();
      const msgs = data.messages ?? [];
      const lastMsg = msgs[msgs.length - 1];
      return {
        id: d.id,
        title: data.title ?? "Sohbet",
        updatedAt: data.updatedAt?.toMillis?.() ?? data.createdAt ?? Date.now(),
        preview: lastMsg ? lastMsg.text : "",
      };
    });
    setChats(list);
  }, (err) => {
    console.error("Failed to listen to cloud chats:", err);
  });
}

export function backToList() {
  activeChatUnsub?.();
  activeChatUnsub = null;
  setOpenChatId(null);
  setMessages([]);
}

async function createDirectChat(): Promise<string | null> {
  const user = currentUser();
  if (!user) return null;
  const { addDoc, collection } = await import("firebase/firestore");
  try {
    const docRef = await addDoc(collection(db, "users", user.uid, "chats"), {
      title: "Yeni Sohbet",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    });
    openChat(docRef.id);
    return docRef.id;
  } catch (err) {
    console.error("Failed to create direct chat:", err);
    return null;
  }
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
  if (status() === "paired") {
    send({ type: "send_message", chatId: id, text });
  } else {
    void sendDirectChat(id, text);
  }
}

export function stopGeneration() {
  if (status() === "paired") {
    send({ type: "stop" });
  }
  setBusy(false);
}

// --- Ayar değişiklikleri (iyimser güncelle + masaüstüne yolla) ---
export function chooseModel(id: string, provider: string) {
  setActiveModelId(id);
  if (status() === "paired") {
    send({ type: "set_model", id, provider });
  }
}

export function chooseMode(m: RMode) {
  setModeSig(m);
  send({ type: "set_mode", mode: m });
}

export function toggleTool() {
  const next = !toolUse();
  setToolUseSig(next);
  send({ type: "set_tool", on: next });
}

export async function signInGoogleDirectly(): Promise<User> {
  const androidAuth = (window as any).AndroidGoogleAuth;
  if (androidAuth) {
    setStatus("connecting");
    return new Promise<User>((resolve, reject) => {
      (window as any).onGoogleSignInSuccess = (idToken: string) => {
        const credential = GoogleAuthProvider.credential(idToken);
        signInWithCredential(auth, credential)
          .then((result) => {
            delete (window as any).onGoogleSignInSuccess;
            delete (window as any).onGoogleSignInFailure;
            setStatus("idle"); // reset status to idle on success!
            resolve(result.user);
          })
          .catch((err) => {
            delete (window as any).onGoogleSignInSuccess;
            delete (window as any).onGoogleSignInFailure;
            setStatus("error");
            setErrorMsg(err.message || String(err));
            reject(err);
          });
      };

      (window as any).onGoogleSignInFailure = (errorMsg: string) => {
        delete (window as any).onGoogleSignInSuccess;
        delete (window as any).onGoogleSignInFailure;
        setStatus("error");
        setErrorMsg(errorMsg);
        reject(new Error(errorMsg));
      };

      try {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        androidAuth.signIn(clientId);
      } catch (err) {
        delete (window as any).onGoogleSignInSuccess;
        delete (window as any).onGoogleSignInFailure;
        setStatus("error");
        setErrorMsg(String(err));
        reject(err);
      }
    });
  }

  const provider = new GoogleAuthProvider();
  try {
    setStatus("connecting");
    const result = await signInWithPopup(auth, provider);
    setStatus("idle"); // reset status to idle on success!
    return result.user;
  } catch (e) {
    setStatus("error");
    console.error("Google sign in failed:", e);
    throw e;
  }
}

export async function signOutGoogle() {
  await fbSignOut(auth);
  reset();
}

export function reset() {
  localStorage.removeItem("axiom_paired_session");
  reconnectAttempts = 0;
  conn?.close();
  conn = null;
  setStatus("idle");
  setErrorMsg(null);
  setChats([]);
  setOpenChatId(null);
  setMessages([]);
  setBusy(false);
  activeChatUnsub?.();
  activeChatUnsub = null;
  cloudChatsUnsub?.();
  cloudChatsUnsub = null;
}
