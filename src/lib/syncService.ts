import {
  doc, setDoc, getDoc, collection, getDocs, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import {
  ref, uploadString, getDownloadURL, deleteObject,
} from "firebase/storage";
import { db, storage } from "./firebase";
import type { Chat, ChatMessage } from "../stores/chatStore";
import type { UserProfile } from "../types";

const CHATS_COL = "chats";
const SETTINGS_DOC = "settings";
const PROFILE_DOC = "profile";

function userDoc(uid: string, path: string) {
  return doc(db, "users", uid, "data", path);
}

function chatsCol(uid: string) {
  return collection(db, "users", uid, CHATS_COL);
}

function chatDoc(uid: string, chatId: string) {
  return doc(db, "users", uid, CHATS_COL, chatId);
}

// ── Images ──

async function uploadMessageImages(
  uid: string,
  chatId: string,
  msgId: string,
  images: string[],
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const imgRef = ref(storage, `users/${uid}/images/${chatId}/${msgId}_${i}.png`);
    await uploadString(imgRef, images[i], "base64");
    const url = await getDownloadURL(imgRef);
    urls.push(url);
  }
  return urls;
}

async function deleteMessageImages(uid: string, chatId: string, msgId: string, count: number) {
  for (let i = 0; i < count; i++) {
    try {
      const imgRef = ref(storage, `users/${uid}/images/${chatId}/${msgId}_${i}.png`);
      await deleteObject(imgRef);
    } catch { /* already deleted */ }
  }
}

// ── Messages serialization ──

interface CloudMessage {
  id: string;
  role: string;
  text: string;
  toolActions?: unknown[];
  fromToggle?: boolean;
  cardType?: string;
  cardData?: unknown;
  thinkingContent?: string;
  imageUrls?: string[];
  imageCount?: number;
}

function msgToCloud(m: ChatMessage, imageUrls?: string[]): CloudMessage {
  const cm: CloudMessage = { id: m.id, role: m.role, text: m.text };
  if (m.toolActions?.length) cm.toolActions = m.toolActions;
  if (m.fromToggle) cm.fromToggle = true;
  if (m.cardType) cm.cardType = m.cardType;
  if (m.cardData) cm.cardData = m.cardData;
  if (m.thinkingContent) cm.thinkingContent = m.thinkingContent;
  if (imageUrls?.length) cm.imageUrls = imageUrls;
  if (m.imageCount) cm.imageCount = m.imageCount;
  return cm;
}

function cloudToMsg(cm: CloudMessage): ChatMessage {
  return {
    id: cm.id,
    role: cm.role as ChatMessage["role"],
    text: cm.text,
    toolActions: cm.toolActions as ChatMessage["toolActions"],
    fromToggle: cm.fromToggle,
    cardType: cm.cardType as ChatMessage["cardType"],
    cardData: cm.cardData,
    thinkingContent: cm.thinkingContent,
    imageCount: cm.imageUrls?.length ?? cm.imageCount,
  };
}

// ── Chat sync ──

export async function uploadChat(uid: string, chat: Chat): Promise<void> {
  const messages: CloudMessage[] = [];
  for (const m of chat.messages) {
    let imageUrls: string[] | undefined;
    if (m.images?.length) {
      imageUrls = await uploadMessageImages(uid, chat.id, m.id, m.images);
    }
    messages.push(msgToCloud(m, imageUrls));
  }

  await setDoc(chatDoc(uid, chat.id), {
    title: chat.title,
    createdAt: chat.createdAt,
    compactedSummary: chat.compactedSummary ?? null,
    messages,
    updatedAt: serverTimestamp(),
  });
}

export async function downloadChats(uid: string): Promise<Chat[]> {
  const snap = await getDocs(chatsCol(uid));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title ?? "Sohbet",
      createdAt: data.createdAt ?? Date.now(),
      compactedSummary: data.compactedSummary ?? undefined,
      messages: (data.messages ?? []).map(cloudToMsg),
    };
  });
}

export async function deleteCloudChat(uid: string, chatId: string): Promise<void> {
  const snap = await getDoc(chatDoc(uid, chatId));
  if (snap.exists()) {
    const msgs = snap.data().messages ?? [];
    for (const m of msgs) {
      if (m.imageUrls?.length) {
        await deleteMessageImages(uid, chatId, m.id, m.imageUrls.length);
      }
    }
    await deleteDoc(chatDoc(uid, chatId));
  }
}

// ── Bulk migration ──

export async function migrateAllChats(uid: string, chats: Chat[]): Promise<void> {
  for (const chat of chats) {
    if (chat.messages.length === 0) continue;
    await uploadChat(uid, chat);
  }
}

// ── Settings sync ──

export async function uploadSettings(uid: string, settings: Record<string, unknown>): Promise<void> {
  await setDoc(userDoc(uid, SETTINGS_DOC), { ...settings, updatedAt: serverTimestamp() });
}

export async function downloadSettings(uid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(userDoc(uid, SETTINGS_DOC));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

// ── Profile sync ──

export async function uploadProfile(uid: string, profile: UserProfile): Promise<void> {
  await setDoc(userDoc(uid, PROFILE_DOC), { ...profile, updatedAt: serverTimestamp() });
}

export async function downloadProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userDoc(uid, PROFILE_DOC));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

// ── Full migration (all data) ──

export interface MigrationData {
  chats: Chat[];
  settings: Record<string, unknown> | null;
  profile: UserProfile | null;
}

export async function migrateAllData(uid: string, data: MigrationData): Promise<void> {
  if (data.chats.length > 0) {
    await migrateAllChats(uid, data.chats);
  }
  if (data.settings) {
    await uploadSettings(uid, data.settings);
  }
  if (data.profile) {
    await uploadProfile(uid, data.profile);
  }
}

export async function downloadAllData(uid: string): Promise<MigrationData> {
  const [chats, settings, profile] = await Promise.all([
    downloadChats(uid),
    downloadSettings(uid),
    downloadProfile(uid),
  ]);
  return { chats, settings, profile };
}
