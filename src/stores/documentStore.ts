import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { ipc } from "../lib/ipc";
import type { DocumentAttachment } from "../types";

interface DocumentState {
  chatDocuments: Record<string, DocumentAttachment[]>;
  addDocument: (chatId: string, filePath: string) => Promise<void>;
  addPastedFile: (chatId: string, file: File) => Promise<void>;
  removeDocument: (chatId: string, docId: string) => void;
  getDocumentsForChat: (chatId: string) => DocumentAttachment[];
  clearDocumentsForChat: (chatId: string) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const useDocumentStore = create<DocumentState>()(
  persist(
    (set, get) => ({
      chatDocuments: {},

      addDocument: async (chatId, filePath) => {
        const parsed = await ipc.documentParse(filePath);
        const doc: DocumentAttachment = {
          id: crypto.randomUUID(),
          filename: parsed.filename,
          filePath,
          mimeType: parsed.mimeType,
          extractedText: parsed.extractedText,
          sizeBytes: parsed.sizeBytes,
          ...(parsed.base64Data ? { base64Data: parsed.base64Data } : {}),
        };
        set((s) => ({
          chatDocuments: {
            ...s.chatDocuments,
            [chatId]: [...(s.chatDocuments[chatId] ?? []), doc],
          },
        }));
      },

      addPastedFile: async (chatId, file) => {
        const isImage = file.type.startsWith("image/");
        let doc: DocumentAttachment;
        if (isImage) {
          const base64 = await fileToBase64(file);
          const ext = (file.type.split("/")[1] || "png").split("+")[0];
          doc = {
            id: crypto.randomUUID(),
            filename: file.name || `yapıştırılan-${Date.now()}.${ext}`,
            filePath: "",
            mimeType: file.type || "image/png",
            extractedText: "",
            sizeBytes: file.size,
            base64Data: base64,
          };
        } else {
          const text = await file.text();
          doc = {
            id: crypto.randomUUID(),
            filename: file.name || `yapıştırılan-${Date.now()}.txt`,
            filePath: "",
            mimeType: file.type || "text/plain",
            extractedText: text,
            sizeBytes: file.size,
          };
        }
        set((s) => ({
          chatDocuments: {
            ...s.chatDocuments,
            [chatId]: [...(s.chatDocuments[chatId] ?? []), doc],
          },
        }));
      },

      removeDocument: (chatId, docId) => {
        set((s) => ({
          chatDocuments: {
            ...s.chatDocuments,
            [chatId]: (s.chatDocuments[chatId] ?? []).filter(
              (d) => d.id !== docId
            ),
          },
        }));
      },

      getDocumentsForChat: (chatId) => {
        return get().chatDocuments[chatId] ?? [];
      },

      clearDocumentsForChat: (chatId) => {
        set((s) => {
          const next = { ...s.chatDocuments };
          delete next[chatId];
          return { chatDocuments: next };
        });
      },
    }),
    {
      name: "axiom-documents",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const stripped: Record<string, typeof state.chatDocuments[string]> = {};
        for (const [chatId, docs] of Object.entries(state.chatDocuments)) {
          stripped[chatId] = docs.map(({ base64Data, ...rest }) => rest);
        }
        return { chatDocuments: stripped } as unknown as DocumentState;
      },
    }
  )
);
