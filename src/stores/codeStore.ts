import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import { useModelStore, modelSupportsVision } from "./modelStore";
import { useSkillStore } from "./skillStore";
import { useOptimizationStore } from "./optimizationStore";
import { useDocumentStore } from "./documentStore";
import { fitContext } from "../lib/contextManager";
import { lookupContextWindow } from "../components/models/modelCatalog";
import type { ChatMode } from "./chatStore";
import type {
  CodeMessage,
  ToolAction,
  ToolActionKind,
  ChatMessage as IpcChatMessage,
  FileEntry,
  DocumentAttachment,
  OptimizationConfig,
  HardwareProfile,
} from "../types";

const MAX_TOOL_STEPS = 16;

/** Parametre sayısını milyar (B) cinsine çevirir: "12B", "350M", gemma "e4b" → 4. */
function parseParamsB(s?: string | null): number | null {
  if (!s) return null;
  const up = s.toUpperCase().replace(/^E/, "");
  const m = up.match(/([\d.]+)\s*([BM])?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  return m[2] === "M" ? n / 1000 : n;
}

const CODE_CTX_FLOOR = 8192;   // kod için asgari makul bağlam
const CODE_CTX_CEIL = 32768;   // KV RAM'e taşabildiği için makul tavan

/** Donanıma göre kod aracı için makul num_ctx hesaplar.
 *  Ollama, modeli/KV'yi VRAM'e sığmazsa RAM'e taşır (offload) — bu yüzden KV bütçesine
 *  hem artık VRAM hem RAM'in bir kısmı dahil edilir. Asla 8192'nin altına inmez. */
export function computeVramCtxLimit(
  model: { id: string; contextLength?: number | null; parameterCount?: string | null; sizeBytes?: number | null; provider?: string } | null | undefined,
  hw: HardwareProfile | null,
  kvCacheType?: string | null,
): number {
  if (!model) return CODE_CTX_FLOOR;
  const modelMax = model.contextLength ?? lookupContextWindow(model.id) ?? 8192;
  // Cloud modeller yerel bellek kullanmaz → kendi max bağlamı
  if (model.provider === "cloud") return modelMax;
  if (!hw) return Math.min(modelMax, CODE_CTX_FLOOR);

  const paramsB = parseParamsB(model.parameterCount) ?? 7;
  const weightMb = model.sizeBytes
    ? model.sizeBytes / 1048576
    : (paramsB * 1e9 * 0.5625) / 1048576; // ~Q4 (4.5 bit/parametre)

  const vramMb = hw.gpuVramMb ?? 0;
  const ramMb = hw.totalRamMb ?? 8192;

  // KV-cache hem artık VRAM'e hem RAM'e sığabilir (Ollama offload eder).
  const vramLeft = Math.max(0, vramMb - weightMb);
  const weightOverflowToRam = Math.max(0, weightMb - vramMb);
  const ramForKv = Math.max(0, ramMb * 0.5 - weightOverflowToRam);
  const availableMb = vramLeft + ramForKv;

  // f16 KV ~ 0.07 MB/token/B (kabaca); KV-quant bunu düşürür
  let kvPerTok = 0.07 * paramsB;
  const kv = (kvCacheType || "f16").toLowerCase();
  if (kv === "q8_0") kvPerTok *= 0.5;
  else if (kv === "q4_0") kvPerTok *= 0.25;

  let ctx = Math.floor(availableMb / Math.max(kvPerTok, 0.001));
  ctx = Math.min(ctx, modelMax, CODE_CTX_CEIL);
  ctx = Math.max(CODE_CTX_FLOOR, ctx);
  return Math.floor(ctx / 1024) * 1024;
}

const DESTRUCTIVE: ToolActionKind[] = [
  "write_file",
  "edit_file",
  "delete_file",
  "rename_file",
  "run_command",
];

export interface CodeSession {
  id: string;
  title: string;
  projectPath: string;
  messages: CodeMessage[];
  createdAt: number;
}

export interface PendingApproval {
  kind: ToolActionKind;
  title: string;
  detail?: string;
  isDiff?: boolean;
}

interface CodeState {
  sessions: CodeSession[];
  activeSessionId: string | null;
  isProcessing: boolean;
  directoryTree: FileEntry[];
  pendingApproval: PendingApproval | null;
  alwaysAllow: Record<string, boolean>;
  webSearchEnabled: boolean;
  codeMode: ChatMode;
  contextUsed: number;
  ctxLimit: number;

  setWebSearchEnabled: (v: boolean) => void;
  setCodeMode: (m: ChatMode) => void;
  recomputeCtxLimit: () => Promise<void>;
  activeSession: () => CodeSession | undefined;
  newSession: (projectPath: string) => Promise<void>;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setProject: (path: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopProcessing: () => void;
  resolveApproval: (decision: "approve" | "reject", alwaysAllowKind?: boolean) => void;
  clearMessages: () => void;
  toggleToolCollapse: (msgId: string, actionIdx: number) => void;
}

interface StreamTokenPayload {
  token: string;
  done: boolean;
  chatId: string;
  doneReason?: string;
}

interface ShellOutputPayload {
  execId: string;
  chunk: string;
  stream: string;
  done: boolean;
  exitCode?: number;
}

let streamUnlisten: UnlistenFn | null = null;
let stopRequested = false;
let currentStreamResolve: (() => void) | null = null;
let approvalResolve: ((decision: "approve" | "reject") => void) | null = null;

function buildTreeText(entries: FileEntry[]): string {
  return entries.map((e) => `${e.isDir ? "📁" : "📄"} ${e.name}`).join("\n");
}

function buildCodeSystemPrompt(
  projectPath: string,
  treeText: string,
  webSearchEnabled: boolean,
  textDocs: DocumentAttachment[],
  hasImages: boolean,
): string {
  const activePrompts = useSkillStore.getState().getActivePrompts();
  const skillSection =
    activePrompts.length > 0
      ? `# Aktif Yetenekler\n\n${activePrompts.join("\n\n---\n\n")}\n\n---\n\n`
      : "";

  const webSection = webSearchEnabled
    ? `\n\n## Web araması (açık)
Güncel bilgi, dokümantasyon veya hata mesajı araştırmak için web'de arama yapabilirsin.
\`\`\`tool:web_search
arama sorgusu
\`\`\``
    : "";

  const docSection = textDocs.length
    ? `\n\n# Ekli belgeler\nKullanıcı şu belgeleri bağlam olarak ekledi:\n\n` +
      textDocs.map((d) => `[Belge: ${d.filename}]\n${d.extractedText}`).join("\n\n---\n\n").slice(0, 30000)
    : "";

  const imgSection = hasImages
    ? `\n\nKullanıcı mesajına resim(ler) ekledi; görebiliyorsun. Placeholder/şablon metin kullanma, resimde gerçekten ne gördüğünü anlat.`
    : "";

  return `${skillSection}Sen Axiom'un kod ajanısın — gerçek bir yazılım mühendisi gibi çalışırsın. Kullanıcının projesinde dosya okur, arar, hassas düzenleme yapar ve komut çalıştırırsın.

Proje dizini: ${projectPath}

Proje yapısı (ilk seviye):
${treeText || "(boş proje)"}

# Çalışma Prensipleri (ÖNEMLİ)
- Bir dosyayı DEĞİŞTİRMEDEN ÖNCE mutlaka \`read_file\` ile oku. Var olan dosyalarda \`write_file\` (tam üzerine yazma) yerine HER ZAMAN \`edit_file\` (hassas değişiklik) kullan.
- Kodda bir şey ararken tahminle dosya okuma; önce \`search\` (içerik) veya \`glob\` (dosya adı) ile yerini bul.
- Dosya yollarını göreceli yaz: \`src/index.ts\`. Mutlak yol kullanma.
- Değişiklikten sonra mümkünse \`run_command\` ile derleme/test/lint çalıştırıp doğrula (örn. \`npx tsc --noEmit\`, \`npm test\`).
- Bir şeyi bilmiyorsan uydurma — araçlarla doğrula. Hata alırsan sebebini analiz edip düzelt.
- Gereksiz adım atma; görevi en az araç çağrısıyla, doğru şekilde bitir. Bitince kısa bir özet yaz.
- Bir yanıtta birden fazla araç bloğu kullanabilirsin; sırayla çalıştırılır.

# Araçlar

## Dosya okuma
\`\`\`tool:read_file
path: src/main.ts
\`\`\`

## İçerik arama (regex, .gitignore-duyarlı)
\`\`\`tool:search
query: function\\s+foo
path: src
\`\`\`

## Dosya adı arama (glob)
\`\`\`tool:glob
pattern: **/*.ts
\`\`\`

## Hassas düzenleme (TERCİH EDİLEN)
OLD bloğu dosyada birebir geçmeli ve tek olmalı (değilse daha fazla bağlam ekle veya \`all: true\` yaz).
\`\`\`tool:edit_file
path: src/app.ts
<<<<<<< OLD
const x = 1;
=======
const x = 2;
>>>>>>> NEW
\`\`\`

## Yeni dosya oluşturma / tam yazma (yalnızca yeni dosyalar için)
\`\`\`tool:write_file
path: src/utils/helper.ts
---
export const greet = (n: string) => \`Hi \${n}\`;
\`\`\`

## Dizin oluşturma
\`\`\`tool:create_dir
path: src/components
\`\`\`

## Dizin listeleme
\`\`\`tool:list_dir
path: src
\`\`\`

## Dosya/dizin silme
\`\`\`tool:delete_file
path: src/eski.ts
\`\`\`

## Taşıma / yeniden adlandırma
\`\`\`tool:rename_file
from: src/a.ts
to: src/b.ts
\`\`\`

## Terminal komutu (proje dizininde çalışır, çıktı canlı akar)
\`\`\`tool:run_command
npm run build
\`\`\`

# Terminal / CLI Kuralları (ÇOK ÖNEMLİ)
Terminal İNTERAKTİF DEĞİL — stdin yok. Bir komut seçim/onay sorarsa cevaplayamazsın ve komut zaman aşımına kadar TAKILIR. Bu yüzden HER komutu interaktif olmayan (non-interactive) biçimde, gerekli tüm bayraklarla çalıştır. Asla soru soracak bir komut bırakma.

Genel kurallar:
- npx/npm create'in "Ok to proceed?" sorusunu atlamak için \`--yes\` kullan ya da tüm seçenekleri bayrakla ver.
- Birçok araç \`CI=1\` ile interaktifliği kapatır. Windows cmd'de: \`set CI=1&& <komut>\`.
- Mevcut klasöre kurulum için proje adı yerine \`.\` kullan (kullanıcı zaten proje dizinindeyiz).
- Evet/hayır soran basit komutlarda son çare: \`echo y| <komut>\`.
- Komutları zincirlemek için cmd'de \`&&\` kullanabilirsin.
- Önce iskeleyi kur → sonra \`npm install\` → sonra dosyaları edit_file ile düzenle → \`npm run build\`/test ile doğrula.

İnteraktif OLMAYAN iskele (scaffold) komutları:
- Vite + React (TS): \`npm create vite@latest . -- --template react-ts\`  (JS: \`--template react\`)
- Vite + Vue (TS): \`npm create vite@latest . -- --template vue-ts\`
- Vite + Svelte (TS): \`npm create vite@latest . -- --template svelte-ts\`
- Next.js: \`npx --yes create-next-app@latest . --ts --eslint --app --src-dir --tailwind --use-npm --no-import-alias\`
- Vue: \`npm create vue@latest . -- --default\` (gerekiyorsa \`--ts --router --pinia\` ekle)
- Astro: \`npm create astro@latest . -- --template minimal --install --no-git --yes\`
- Node/TS başlangıç: \`npm init -y && npm install -D typescript @types/node && npx --yes tsc --init\`
- Tailwind: \`npm install -D tailwindcss postcss autoprefixer && npx --yes tailwindcss init -p\`

Not: pnpm/bun/yarn de kullanılabilir (ör. \`bun create vite@latest . --template react-ts\`), ama hangi paket yöneticisinin kurulu olduğundan emin değilsen \`npm\` tercih et. Bilmediğin bir CLI'da önce \`<araç> --help\` ile bayrakları öğren; interaktif moda asla girme.${webSection}${docSection}${imgSection}`;
}

type ToolBlock = {
  kind: ToolActionKind;
  path?: string;
  content?: string;
  command?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  query?: string;
  pattern?: string;
  from?: string;
  to?: string;
};

const TOOL_KINDS_RE =
  "read_file|write_file|run_command|list_dir|create_dir|edit_file|search|glob|delete_file|rename_file|web_search";

/** Geçmişe gönderilirken asistan mesajındaki büyük araç bloklarını kısa etikete indirger
 *  (dosya içerikleri tekrar tekrar context'i şişirmesin; sonuçlar zaten ayrı mesajda). */
function compactToolBlocksForHistory(text: string): string {
  return text
    .replace(/```tool:([a-z_]+)\n([\s\S]*?)```/g, (_m, kind: string, body: string) => {
      const path = body.match(/^path:\s*(.+)$/m)?.[1]?.trim();
      return path ? `[araç: ${kind} ${path}]` : `[araç: ${kind}]`;
    })
    .replace(/```tool:[a-z_]+\n[\s\S]*$/g, "[araç çağrısı]")
    .trim();
}

/** Açılmış ama kapatma ``` gelmemiş bir tool bloğu var mı? (yarıda kesilmiş yanıt) */
function hasUnclosedToolBlock(text: string): boolean {
  const lastOpen = text.lastIndexOf("```tool:");
  if (lastOpen === -1) return false;
  const afterHeader = text.indexOf("\n", lastOpen);
  const searchFrom = afterHeader === -1 ? lastOpen + 8 : afterHeader + 1;
  return text.indexOf("```", searchFrom) === -1;
}

function parseToolBlocks(text: string): ToolBlock[] {
  const blocks: ToolBlock[] = [];
  const regex = new RegExp("```tool:(" + TOOL_KINDS_RE + ")\\n([\\s\\S]*?)```", "g");
  let match;
  while ((match = regex.exec(text)) !== null) {
    const kind = match[1] as ToolActionKind;
    const body = match[2];
    const trimmed = body.trim();
    const pathOf = () => body.match(/^path:\s*(.+)$/m)?.[1]?.trim();

    if (kind === "read_file") {
      const p = pathOf();
      if (p) blocks.push({ kind, path: p });
    } else if (kind === "write_file") {
      const p = pathOf();
      const sepIdx = body.indexOf("---");
      if (p && sepIdx !== -1) {
        blocks.push({ kind, path: p, content: body.slice(sepIdx + 3).trim() });
      }
    } else if (kind === "edit_file") {
      const p = pathOf();
      const all = /^all:\s*true\s*$/m.test(body);
      const m = body.match(/<<<<<<< OLD\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> NEW/);
      if (p && m) {
        blocks.push({
          kind,
          path: p,
          oldString: m[1],
          newString: m[2],
          replaceAll: all,
        });
      }
    } else if (kind === "run_command") {
      if (trimmed) blocks.push({ kind, command: trimmed });
    } else if (kind === "list_dir") {
      blocks.push({ kind, path: pathOf() });
    } else if (kind === "create_dir") {
      const p = pathOf();
      if (p) blocks.push({ kind, path: p });
    } else if (kind === "search") {
      const q = body.match(/^query:\s*(.+)$/m)?.[1]?.trim();
      if (q) blocks.push({ kind, query: q, path: pathOf() });
    } else if (kind === "glob") {
      const pat = body.match(/^pattern:\s*(.+)$/m)?.[1]?.trim();
      if (pat) blocks.push({ kind, pattern: pat });
    } else if (kind === "delete_file") {
      const p = pathOf();
      if (p) blocks.push({ kind, path: p });
    } else if (kind === "rename_file") {
      const from = body.match(/^from:\s*(.+)$/m)?.[1]?.trim();
      const to = body.match(/^to:\s*(.+)$/m)?.[1]?.trim();
      if (from && to) blocks.push({ kind, from, to });
    } else if (kind === "web_search") {
      if (trimmed) blocks.push({ kind, query: trimmed });
    }
  }
  return blocks;
}

async function executeToolBlock(block: ToolBlock, projectPath: string): Promise<ToolAction> {
  try {
    switch (block.kind) {
      case "read_file": {
        const result = await ipc.fsReadFile(block.path!, projectPath);
        return { kind: "read_file", path: block.path, content: result.content, collapsed: true };
      }
      case "write_file": {
        await ipc.fsWriteFile(block.path!, block.content!, projectPath);
        return { kind: "write_file", path: block.path, content: block.content, collapsed: true };
      }
      case "edit_file": {
        const res = await ipc.fsApplyEdit(
          block.path!,
          block.oldString ?? "",
          block.newString ?? "",
          !!block.replaceAll,
          projectPath,
        );
        return {
          kind: "edit_file",
          path: block.path,
          content: res.diff,
          diff: res.diff,
          added: res.added,
          removed: res.removed,
          collapsed: false,
        };
      }
      case "list_dir": {
        const entries = await ipc.fsReadDir(block.path || projectPath, projectPath);
        return { kind: "list_dir", path: block.path || projectPath, content: buildTreeText(entries), collapsed: true };
      }
      case "create_dir": {
        await ipc.fsCreateDir(block.path!, projectPath);
        return { kind: "create_dir", path: block.path, content: `Dizin oluşturuldu: ${block.path}`, collapsed: true };
      }
      case "search": {
        const matches = await ipc.fsSearch(block.query!, projectPath, block.path);
        const content = matches.length
          ? matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n")
          : "(eşleşme yok)";
        return { kind: "search", command: block.query, content, collapsed: false };
      }
      case "glob": {
        const files = await ipc.fsGlob(block.pattern!, projectPath);
        const content = files.length ? files.join("\n") : "(eşleşme yok)";
        return { kind: "glob", command: block.pattern, content, collapsed: false };
      }
      case "delete_file": {
        await ipc.fsDeletePath(block.path!, projectPath);
        return { kind: "delete_file", path: block.path, content: `Silindi: ${block.path}`, collapsed: true };
      }
      case "rename_file": {
        await ipc.fsRenamePath(block.from!, block.to!, projectPath);
        return { kind: "rename_file", path: block.from, toPath: block.to, content: `${block.from} → ${block.to}`, collapsed: true };
      }
      case "web_search": {
        const results = await ipc.webSearch(block.query!, 5);
        const content = results.length
          ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n")
          : "Sonuç bulunamadı.";
        return { kind: "web_search", command: block.query, content, collapsed: true };
      }
      default:
        return { kind: block.kind, content: "Bilinmeyen araç", collapsed: false };
    }
  } catch (e) {
    return { kind: block.kind, path: block.path, command: block.command ?? block.query, content: `Hata: ${String(e)}`, collapsed: false };
  }
}

function actionResultText(a: ToolAction): string {
  switch (a.kind) {
    case "read_file":
      return `Dosya okundu (${a.path}):\n\`\`\`\n${a.content}\n\`\`\``;
    case "write_file":
      return `Dosya yazıldı: ${a.path}`;
    case "edit_file":
      return `Düzenlendi: ${a.path} (+${a.added ?? 0}/-${a.removed ?? 0})\n\`\`\`diff\n${a.diff ?? a.content}\n\`\`\``;
    case "run_command":
      return `Komut: ${a.command}\nÇıkış kodu: ${a.exitCode}\nÇıktı:\n\`\`\`\n${a.content}\n\`\`\``;
    case "list_dir":
      return `Dizin listelendi (${a.path}):\n${a.content}`;
    case "create_dir":
      return `Dizin oluşturuldu: ${a.path}`;
    case "search":
      return `Arama "${a.command}":\n${a.content}`;
    case "glob":
      return `Glob "${a.command}":\n${a.content}`;
    case "delete_file":
      return `Silindi: ${a.path}`;
    case "rename_file":
      return `Taşındı: ${a.path} → ${a.toPath}`;
    case "web_search":
      return `Web araması "${a.command}":\n${a.content}`;
    default:
      return a.content ?? "";
  }
}

function buildToolResultText(actions: ToolAction[]): string {
  return actions.map(actionResultText).join("\n\n");
}

function approvalPreview(block: ToolBlock): PendingApproval {
  switch (block.kind) {
    case "edit_file":
      return {
        kind: block.kind,
        title: `Düzenle: ${block.path}`,
        detail:
          (block.oldString ?? "").split("\n").map((l) => `- ${l}`).join("\n") +
          "\n" +
          (block.newString ?? "").split("\n").map((l) => `+ ${l}`).join("\n"),
        isDiff: true,
      };
    case "write_file":
      return { kind: block.kind, title: `Yaz: ${block.path}`, detail: block.content };
    case "delete_file":
      return { kind: block.kind, title: `Sil: ${block.path}` };
    case "rename_file":
      return { kind: block.kind, title: `Taşı: ${block.from} → ${block.to}` };
    case "run_command":
      return { kind: block.kind, title: "Komut çalıştır", detail: block.command };
    default:
      return { kind: block.kind, title: "İşlem onayı" };
  }
}

function folderName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

const throttledLocalStorage = (() => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingName: string | null = null;
  let latest: string;

  function flush() {
    if (pendingName) {
      localStorage.setItem(pendingName, latest);
      pendingName = null;
      if (timer) { clearTimeout(timer); timer = null; }
    }
  }

  window.addEventListener("beforeunload", flush);

  return {
    getItem: (name: string) => localStorage.getItem(name),
    setItem: (name: string, value: string) => {
      latest = value;
      pendingName = name;
      if (!timer) timer = setTimeout(() => { flush(); timer = null; }, 2000);
    },
    removeItem: (name: string) => localStorage.removeItem(name),
  };
})();

export const useCodeStore = create<CodeState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      isProcessing: false,
      directoryTree: [],
      pendingApproval: null,
      alwaysAllow: {},
      webSearchEnabled: false,
      codeMode: "balanced",
      contextUsed: 0,
      ctxLimit: 4096,

      setWebSearchEnabled: (v) => set({ webSearchEnabled: v }),
      setCodeMode: (m) => set({ codeMode: m }),

      recomputeCtxLimit: async () => {
        const active = useModelStore.getState().models.find((m) => m.isActive);
        if (!active) { set({ ctxLimit: 4096 }); return; }
        const kvType = useOptimizationStore.getState().config?.kvCacheType;
        if (active.provider === "cloud") {
          set({ ctxLimit: computeVramCtxLimit(active, null, kvType) });
          return;
        }
        try {
          const hw = await ipc.hardwareProfile();
          set({ ctxLimit: computeVramCtxLimit(active, hw, kvType) });
        } catch {
          set({ ctxLimit: computeVramCtxLimit(active, null, kvType) });
        }
      },

      activeSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId);
      },

      newSession: async (projectPath: string) => {
        if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
        let tree: FileEntry[] = [];
        try { tree = await ipc.fsReadDir(projectPath, projectPath, 2); } catch {}
        const id = crypto.randomUUID();
        const session: CodeSession = {
          id, title: folderName(projectPath), projectPath, messages: [], createdAt: Date.now(),
        };
        set((s) => ({
          sessions: [session, ...s.sessions],
          activeSessionId: id,
          isProcessing: false,
          directoryTree: tree,
          pendingApproval: null,
        }));
      },

      switchSession: (id) => {
        if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
        const session = get().sessions.find((s) => s.id === id);
        if (session) {
          ipc.fsReadDir(session.projectPath, session.projectPath, 2)
            .then((tree) => set({ directoryTree: tree }))
            .catch(() => set({ directoryTree: [] }));
        }
        set({ activeSessionId: id, isProcessing: false, pendingApproval: null });
      },

      deleteSession: (id) => {
        set((s) => {
          const remaining = s.sessions.filter((ss) => ss.id !== id);
          const needSwitch = s.activeSessionId === id;
          return {
            sessions: remaining,
            activeSessionId: needSwitch ? remaining[0]?.id ?? null : s.activeSessionId,
          };
        });
      },

      renameSession: (id, title) => {
        set((s) => ({
          sessions: s.sessions.map((ss) => (ss.id === id ? { ...ss, title } : ss)),
        }));
      },

      setProject: async (path: string) => {
        const existing = get().activeSession();
        if (existing) {
          let tree: FileEntry[] = [];
          try { tree = await ipc.fsReadDir(path, path, 2); } catch {}
          set((s) => ({
            sessions: s.sessions.map((ss) =>
              ss.id === s.activeSessionId ? { ...ss, projectPath: path, title: folderName(path) } : ss
            ),
            directoryTree: tree,
          }));
        } else {
          await get().newSession(path);
        }
      },

      clearMessages: () => {
        const { activeSessionId } = get();
        if (!activeSessionId) return;
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === activeSessionId ? { ...ss, messages: [] } : ss
          ),
        }));
      },

      toggleToolCollapse: (msgId, actionIdx) => {
        const { activeSessionId } = get();
        if (!activeSessionId) return;
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === activeSessionId
              ? {
                  ...ss,
                  messages: ss.messages.map((m) =>
                    m.id === msgId
                      ? { ...m, toolActions: m.toolActions.map((a, i) => (i === actionIdx ? { ...a, collapsed: !a.collapsed } : a)) }
                      : m
                  ),
                }
              : ss
          ),
        }));
      },

      stopProcessing: () => {
        stopRequested = true;
        if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
        if (currentStreamResolve) { currentStreamResolve(); currentStreamResolve = null; }
        if (approvalResolve) { approvalResolve("reject"); approvalResolve = null; }
        set({ isProcessing: false, pendingApproval: null });
      },

      resolveApproval: (decision, alwaysAllowKind) => {
        const p = get().pendingApproval;
        if (alwaysAllowKind && p) {
          set((s) => ({ alwaysAllow: { ...s.alwaysAllow, [p.kind]: true } }));
        }
        set({ pendingApproval: null });
        if (approvalResolve) { approvalResolve(decision); approvalResolve = null; }
      },

      sendMessage: async (text: string) => {
        stopRequested = false;
        const { activeSessionId } = get();
        if (!activeSessionId) return;
        const session = get().sessions.find((s) => s.id === activeSessionId);
        if (!session) return;
        const projectPath = session.projectPath;
        const { directoryTree } = get();

        const active = useModelStore.getState().models.find((m) => m.isActive);
        if (!active) {
          const errMsg: CodeMessage = {
            id: crypto.randomUUID(), role: "assistant",
            text: "Aktif model seçilmedi. Modeller sekmesinden bir model seç.",
            toolActions: [], timestamp: Date.now(),
          };
          set((s) => ({
            sessions: s.sessions.map((ss) => (ss.id === activeSessionId ? { ...ss, messages: [...ss.messages, errMsg] } : ss)),
          }));
          return;
        }

        // Ekli belge/görselleri yakala
        const snapshotDocs = useDocumentStore.getState().getDocumentsForChat(session.id);
        const textDocs = snapshotDocs.filter((d) => !d.base64Data);
        const snapshotImages = snapshotDocs.filter((d) => !!d.base64Data).map((d) => d.base64Data!);

        const userMsg: CodeMessage = {
          id: crypto.randomUUID(), role: "user", text, toolActions: [], timestamp: Date.now(),
        };
        set((s) => ({
          sessions: s.sessions.map((ss) => (ss.id === activeSessionId ? { ...ss, messages: [...ss.messages, userMsg] } : ss)),
          isProcessing: true,
        }));

        // Görsel var ama model vision desteklemiyorsa uyar ve dur
        if (snapshotImages.length > 0 && !modelSupportsVision(active)) {
          const warn: CodeMessage = {
            id: crypto.randomUUID(), role: "assistant",
            text: `**${active.displayName || active.id}** modeli görselleri okuyamıyor (vision desteği yok). Resim analizi için görsel destekli bir modele geç.`,
            toolActions: [], timestamp: Date.now(),
          };
          set((s) => ({
            sessions: s.sessions.map((ss) => (ss.id === activeSessionId ? { ...ss, messages: [...ss.messages, warn] } : ss)),
            isProcessing: false,
          }));
          return;
        }

        const { webSearchEnabled, codeMode } = get();
        const systemPrompt = buildCodeSystemPrompt(
          projectPath, buildTreeText(directoryTree), webSearchEnabled, textDocs, snapshotImages.length > 0,
        );
        const conversationHistory: IpcChatMessage[] = [{ role: "system", content: systemPrompt }];

        const currentSession = get().sessions.find((s) => s.id === activeSessionId)!;
        for (const msg of currentSession.messages) {
          conversationHistory.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.text });
          if (msg.toolActions.length > 0) {
            conversationHistory.push({ role: "user", content: "Araç sonuçları:\n" + buildToolResultText(msg.toolActions) });
          }
        }

        // Görselleri son kullanıcı mesajına ekle
        if (snapshotImages.length > 0) {
          const lastUser = [...conversationHistory].reverse().find((m) => m.role === "user");
          if (lastUser) lastUser.images = snapshotImages;
        }

        // Belge/görselleri temizle (gönderildi)
        useDocumentStore.getState().clearDocumentsForChat(session.id);

        const think = codeMode === "thinking" ? true : undefined;
        const optConfig = useOptimizationStore.getState().config;
        // VRAM'e göre güvenli bağlam tavanını güncelle (aktif modele göre)
        await get().recomputeCtxLimit();

        for (let step = 0; step < MAX_TOOL_STEPS; step++) {
          if (stopRequested) break;

          // Kod aracı, donanıma (VRAM) göre hesaplanan güvenli bağlam tavanını kullanır.
          const modelCtx = get().ctxLimit;
          // fitContext bütçesi de model max'a göre olsun ki geçmiş gereksiz kırpılmasın.
          const codeOptConfig = { ...(optConfig ?? ({} as OptimizationConfig)), numCtx: modelCtx };
          const ctx = fitContext(conversationHistory, codeOptConfig);
          conversationHistory.splice(0, conversationHistory.length, ...ctx.messages);
          set({ contextUsed: ctx.usedTokens });

          // Dinamik çıktı limiti: kalan bağlamdan türetilir (cloud güvenliği için 32768'le sınırlı; gerisini devam döngüsü tamamlar).
          const dynMaxTokens = Math.max(512, Math.min(32768, modelCtx - ctx.usedTokens - 128));

          const assistantMsgId = crypto.randomUUID();
          let fullText = "";

          set((s) => ({
            sessions: s.sessions.map((ss) =>
              ss.id === activeSessionId
                ? { ...ss, messages: [...ss.messages, { id: assistantMsgId, role: "assistant" as const, text: "", toolActions: [], timestamp: Date.now() }] }
                : ss
            ),
          }));

          const updateAssistant = (txt: string) =>
            set((s) => ({
              sessions: s.sessions.map((ss) =>
                ss.id === activeSessionId
                  ? { ...ss, messages: ss.messages.map((m) => (m.id === assistantMsgId ? { ...m, text: txt } : m)) }
                  : ss
              ),
            }));

          const streamOnce = async (msgs: IpcChatMessage[]): Promise<string | undefined> => {
            if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
            const sid = crypto.randomUUID();
            let resolve: (() => void) | null = null;
            const done = new Promise<void>((r) => { resolve = r; });
            currentStreamResolve = resolve;
            let reason: string | undefined;
            streamUnlisten = await listen<StreamTokenPayload>("chat-token", (event) => {
              if (event.payload.chatId !== sid) return;
              if (event.payload.done) { reason = event.payload.doneReason; resolve?.(); return; }
              fullText += event.payload.token;
              updateAssistant(fullText);
            });
            try {
              await ipc.modelsChatStream({ modelId: active.id, provider: active.provider, messages: msgs, maxTokens: dynMaxTokens, numCtx: modelCtx, think }, sid);
              await done;
            } finally {
              if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
              currentStreamResolve = null;
            }
            return reason;
          };

          let reason: string | undefined;
          try {
            reason = await streamOnce(conversationHistory);
          } catch (e) {
            set((s) => ({
              sessions: s.sessions.map((ss) =>
                ss.id === activeSessionId
                  ? { ...ss, messages: ss.messages.map((m) => (m.id === assistantMsgId ? { ...m, text: fullText || `Hata: ${String(e)}` } : m)) }
                  : ss
              ),
              isProcessing: false,
            }));
            return;
          }
          if (stopRequested) { set({ isProcessing: false }); return; }

          // Yanıt yarıda kesildiyse (token limiti VEYA kapanmamış tool bloğu) tamamlanana kadar devam et
          let cont = 0;
          while (!stopRequested && cont < 8 && (reason === "length" || hasUnclosedToolBlock(fullText))) {
            cont++;
            const contMsgs: IpcChatMessage[] = [
              ...conversationHistory,
              { role: "assistant", content: fullText },
              { role: "user", content: "[SİSTEM: Çıktın token limitine takıldı. Açıklama, özür veya giriş cümlesi YAZMA — kullanıcı bunu görmüyor. Doğrudan bıraktığın son karakterden itibaren kalan içeriği üret; açık kalan kod/araç bloğunu tamamla ve ``` ile kapat.]" },
            ];
            try {
              reason = await streamOnce(contMsgs);
            } catch { break; }
            if (stopRequested) break;
          }

          const toolBlocks = parseToolBlocks(fullText);
          if (toolBlocks.length === 0) { set({ isProcessing: false }); return; }

          const actions: ToolAction[] = [];
          const writeActions = () =>
            set((s) => ({
              sessions: s.sessions.map((ss) =>
                ss.id === activeSessionId
                  ? { ...ss, messages: ss.messages.map((m) => (m.id === assistantMsgId ? { ...m, toolActions: [...actions] } : m)) }
                  : ss
              ),
            }));

          for (const block of toolBlocks) {
            if (stopRequested) break;

            // Web araması kapalıyken çağrılırsa atla
            if (block.kind === "web_search" && !get().webSearchEnabled) {
              actions.push({ kind: "web_search", command: block.query, content: "Web araması kapalı. Açmak için input'taki 'Web' düğmesini kullan.", collapsed: false });
              writeActions();
              continue;
            }

            // Yıkıcı işlemlerde onay
            if (DESTRUCTIVE.includes(block.kind) && !get().alwaysAllow[block.kind]) {
              set({ pendingApproval: approvalPreview(block) });
              const decision = await new Promise<"approve" | "reject">((resolve) => { approvalResolve = resolve; });
              if (decision === "reject") {
                actions.push({ kind: block.kind, path: block.path, command: block.command, content: "Kullanıcı bu işlemi reddetti.", collapsed: false });
                writeActions();
                continue;
              }
            }
            if (stopRequested) break;

            if (block.kind === "run_command") {
              const idx = actions.length;
              actions.push({ kind: "run_command", command: block.command, content: "", collapsed: false });
              writeActions();
              const { content, exitCode } = await runCommandStreaming(block.command!, projectPath, (live) => {
                actions[idx] = { ...actions[idx], content: live };
                writeActions();
              });
              actions[idx] = { ...actions[idx], content, exitCode };
              writeActions();
            } else {
              const action = await executeToolBlock(block, projectPath);
              actions.push(action);
              writeActions();
            }
          }

          // refresh directory tree (dosya yapısı değişmiş olabilir)
          ipc.fsReadDir(projectPath, projectPath, 2).then((tree) => set({ directoryTree: tree })).catch(() => {});

          conversationHistory.push({ role: "assistant", content: compactToolBlocksForHistory(fullText) });
          conversationHistory.push({ role: "user", content: "Araç sonuçları:\n" + buildToolResultText(actions) });

          if (stopRequested) break;
        }

        set({ isProcessing: false });
      },
    }),
    {
      name: "axiom-code-tool",
      storage: createJSONStorage(() => throttledLocalStorage),
      partialize: (state) =>
        ({
          sessions: state.sessions,
          activeSessionId: state.activeSessionId,
          webSearchEnabled: state.webSearchEnabled,
          codeMode: state.codeMode,
        }) as unknown as CodeState,
    }
  )
);

async function runCommandStreaming(
  command: string,
  projectPath: string,
  onChunk: (content: string) => void,
): Promise<{ content: string; exitCode: number }> {
  const execId = crypto.randomUUID();
  let content = "";
  let exitCode = -1;
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((r) => { resolveDone = r; });

  const unlisten = await listen<ShellOutputPayload>("shell-output", (event) => {
    const p = event.payload;
    if (p.execId !== execId) return;
    if (p.done) { exitCode = p.exitCode ?? -1; resolveDone?.(); return; }
    content += (content ? "\n" : "") + p.chunk;
    onChunk(content);
  });

  try {
    await ipc.shellExecStream(command, execId, projectPath, 600);
    await done;
  } catch (e) {
    content += `\nHata: ${String(e)}`;
  } finally {
    unlisten();
  }
  return { content, exitCode };
}
