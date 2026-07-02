import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { ipc } from "../lib/ipc";
import type { UserProfile } from "../types";

const UTILITY_MODEL = "llama3.2:1b";
const MIN_USER_MSG_LENGTH = 20;
const MAX_ARRAY_ENTRIES = 50;
const MAX_NOTES_ENTRIES = 20;

function emptyProfile(): UserProfile {
  return {
    customFields: [],
    interests: [],
    jargon: [],
    recurringTopics: [],
    notes: [],
    lastUpdated: 0,
    factCount: 0,
  };
}

function uniqueUnion(existing: string[], incoming: string[], cap: number): string[] {
  const seen = new Set(existing.map((s) => s.toLowerCase().trim()));
  const result = [...existing];
  for (const item of incoming) {
    const normalized = item.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
      if (result.length >= cap) break;
    }
  }
  return result;
}

function countFacts(p: UserProfile): number {
  let n = 0;
  if (p.name) n++;
  if (p.surname) n++;
  if (p.email) n++;
  if (p.location) n++;
  if (p.birthDate) n++;
  n += (p.customFields ?? []).length;
  if (p.profession) n++;
  if (p.languagePreference) n++;
  if (p.responseStyle) n++;
  n += p.interests.length;
  n += p.jargon.length;
  n += p.recurringTopics.length;
  n += p.notes.length;
  return n;
}

function buildExtractPrompt(current: UserProfile, userMsg: string, assistantMsg: string): string {
  const summary: string[] = [];
  if (current.profession) summary.push(`Meslek: ${current.profession}`);
  if (current.languagePreference) summary.push(`Dil: ${current.languagePreference}`);
  if (current.responseStyle) summary.push(`Yanıt tarzı: ${current.responseStyle}`);
  if (current.interests.length) summary.push(`İlgi alanları: ${current.interests.join(", ")}`);
  if (current.jargon.length) summary.push(`Jargon: ${current.jargon.join(", ")}`);
  if (current.recurringTopics.length) summary.push(`Konular: ${current.recurringTopics.join(", ")}`);
  const profileText = summary.length ? summary.join("\n") : "(henüz bilgi yok)";

  return `Aşağıdaki konuşma turundan kullanıcı hakkında çıkarılabilecek YENİ bilgileri JSON olarak döndür. Spekülasyon yapma — sadece açıkça söylenen veya çok güçlü ima edilen şeyleri yaz. Hiçbir şey çıkarılamıyorsa {} döndür.

Mevcut profil (tekrar etme):
${profileText}

Bu turdaki konuşma:
USER: ${userMsg.slice(0, 1500)}
ASSISTANT: ${assistantMsg.slice(0, 1500)}

Yanıt formatı (sadece JSON, açıklama yok):
{
  "profession": "...",
  "interests": ["..."],
  "languagePreference": "tr",
  "responseStyle": "...",
  "jargon": ["..."],
  "recurringTopics": ["..."],
  "notes": ["..."]
}`;
}

function extractJson(text: string): Partial<UserProfile> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const slice = text.slice(start, end + 1);
    const parsed = JSON.parse(slice);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Partial<UserProfile>;
  } catch {
    return null;
  }
}

interface UserProfileState {
  profile: UserProfile;
  enabled: boolean;

  extractFromTurn: (userMsg: string, assistantMsg: string) => Promise<void>;
  mergeFacts: (newFacts: Partial<UserProfile>) => void;
  updateManualField: (field: "name" | "surname" | "email" | "location" | "birthDate" | "profession", value: string) => void;
  addCustomField: (key: string, value: string) => void;
  removeCustomField: (index: number) => void;
  updateCustomField: (index: number, key: string, value: string) => void;
  exportProfile: () => string;
  resetProfile: () => void;
  setEnabled: (v: boolean) => void;
  getPromptInjection: () => string | null;
}

export const useUserProfileStore = create<UserProfileState>()(
  persist(
    (set, get) => ({
      profile: emptyProfile(),
      enabled: true,

      mergeFacts: (newFacts) => {
        set((s) => {
          const p = s.profile;
          const merged: UserProfile = {
            name: p.name,
            surname: p.surname,
            email: p.email,
            location: p.location,
            birthDate: p.birthDate,
            customFields: p.customFields ?? [],
            profession:
              typeof newFacts.profession === "string" && newFacts.profession.trim()
                ? newFacts.profession.trim()
                : p.profession,
            languagePreference:
              newFacts.languagePreference === "tr" ||
                newFacts.languagePreference === "en" ||
                newFacts.languagePreference === "mixed"
                ? newFacts.languagePreference
                : p.languagePreference,
            responseStyle:
              typeof newFacts.responseStyle === "string" && newFacts.responseStyle.trim()
                ? newFacts.responseStyle.trim()
                : p.responseStyle,
            interests: Array.isArray(newFacts.interests)
              ? uniqueUnion(p.interests, newFacts.interests, MAX_ARRAY_ENTRIES)
              : p.interests,
            jargon: Array.isArray(newFacts.jargon)
              ? uniqueUnion(p.jargon, newFacts.jargon, MAX_ARRAY_ENTRIES)
              : p.jargon,
            recurringTopics: Array.isArray(newFacts.recurringTopics)
              ? uniqueUnion(p.recurringTopics, newFacts.recurringTopics, MAX_ARRAY_ENTRIES)
              : p.recurringTopics,
            notes: Array.isArray(newFacts.notes)
              ? uniqueUnion(p.notes, newFacts.notes, MAX_NOTES_ENTRIES)
              : p.notes,
            lastUpdated: Date.now(),
            factCount: 0,
          };
          merged.factCount = countFacts(merged);
          return { profile: merged };
        });
      },

      updateManualField: (field, value) => {
        set((s) => {
          let sanitizedValue = value;

          if (field === "birthDate" || field === "email") {
            sanitizedValue = value.replace(/\s+/g, "");
          }

          const p = {
            ...s.profile,
            [field]: sanitizedValue || undefined,
            lastUpdated: Date.now()
          };

          p.factCount = countFacts(p);
          return { profile: p };
        });
      },

      addCustomField: (key, value) => {
        set((s) => {
          const fields = [...(s.profile.customFields ?? []), { key: key.trim(), value: value.trim() }];
          const p = { ...s.profile, customFields: fields, lastUpdated: Date.now() };
          p.factCount = countFacts(p);
          return { profile: p };
        });
      },

      removeCustomField: (index) => {
        set((s) => {
          const fields = (s.profile.customFields ?? []).filter((_, i) => i !== index);
          const p = { ...s.profile, customFields: fields, lastUpdated: Date.now() };
          p.factCount = countFacts(p);
          return { profile: p };
        });
      },

      updateCustomField: (index, key, value) => {
        set((s) => {
          const fields = [...(s.profile.customFields ?? [])];
          fields[index] = { key: key.trim(), value: value.trim() };
          const p = { ...s.profile, customFields: fields, lastUpdated: Date.now() };
          p.factCount = countFacts(p);
          return { profile: p };
        });
      },

      exportProfile: () => {
        const { profile } = get();
        return JSON.stringify(profile, null, 2);
      },

      extractFromTurn: async (userMsg, assistantMsg) => {
        const { enabled, profile, mergeFacts } = get();
        if (!enabled) return;
        if (!userMsg || userMsg.trim().length < MIN_USER_MSG_LENGTH) return;
        if (!assistantMsg || assistantMsg.trim().length < 10) return;

        const prompt = buildExtractPrompt(profile, userMsg, assistantMsg);

        try {
          const resp = await ipc.modelsChat({
            modelId: UTILITY_MODEL,
            provider: "ollama",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            maxTokens: 400,
          });
          const facts = extractJson(resp.content);
          if (facts) mergeFacts(facts);
        } catch {
          // sessizce yut — ollama yoksa veya model yüklü değilse kullanıcıya hata gösterme
        }
      },

      resetProfile: () => set({ profile: emptyProfile() }),
      setEnabled: (v) => set({ enabled: v }),

      getPromptInjection: () => {
        const { profile, enabled } = get();
        if (!enabled) return null;
        if (profile.factCount === 0) return null;

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
        if (profile.interests.length) lines.push(`- İlgi alanları: ${profile.interests.join(", ")}`);
        if (profile.responseStyle) lines.push(`- Yanıt tarzı: ${profile.responseStyle}`);
        if (profile.jargon.length) lines.push(`- Sık kullandığı terimler: ${profile.jargon.join(", ")}`);
        if (profile.recurringTopics.length) lines.push(`- Sık konuştuğu konular: ${profile.recurringTopics.join(", ")}`);
        if (profile.notes.length) lines.push(`- Notlar: ${profile.notes.join(" | ")}`);
        for (const cf of profile.customFields ?? []) {
          if (cf.key && cf.value) lines.push(`- ${cf.key}: ${cf.value}`);
        }

        return lines.join("\n");
      },
    }),
    {
      name: "axiom-user-profile",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        ({
          profile: state.profile,
          enabled: state.enabled,
        }) as unknown as UserProfileState,
    }
  )
);
