// Derin agent modu (Faz 5) — çok-adımlı otonom görev döngüsü.
//
// Akış: PLANLA (adım listesi JSON) → YÜRÜT (her adım: model → araç blokları →
// executeToolBlock → sonuç geri) → SENTEZLE (nihai rapor mesaj metnine).
// Mevcut araç yürütme yolu (parseToolBlocks/executeToolBlock + native tool_calls'un
// Rust'ta blok metnine çevrilmesi) AYNEN kullanılır; onay kapıları değişmez.
//
// Durdurma: requestAgentStop() — kart butonu ve chatStore.stopGeneration çağırır.
// Kalıcılık: agentRun, ChatMessage extras'ı olarak SQLite'a otomatik yazılır.

import { ipc } from "./ipc";
import { buildNativeTools } from "./toolRegistry";
import {
  useChatStore,
  parseToolBlocks,
  executeToolBlock,
  buildToolResultText,
  buildEnabledAppsPrompt,
  TOOL_SYSTEM_PROMPT,
  type AgentRun,
  type AgentStep,
  type ChatMessage as UiChatMessage,
} from "../stores/chatStore";
import { buildMcpToolsPrompt } from "../stores/mcpStore";
import { envPromptBlock } from "./envInfo";
import { useModelStore } from "../stores/modelStore";
import type { ChatMessage as LlmMessage, ToolAction } from "../types";

// ---- Sınırlar ---------------------------------------------------------------
const MAX_STEPS = 8; // plandan gelse bile üst sınır
const MAX_ITER_PER_STEP = 3; // adım içi araç turu üst sınırı
const TOOL_TIMEOUT_MS = 150_000; // onay kartı 120sn'yi kapsar (send ile aynı)
const TOTAL_TIMEOUT_MS = 15 * 60_000; // koşu tavanı

let stopRequested = false;

/** Aktif agent koşusunu nazikçe durdurur (adım sınırında kesilir). */
export function requestAgentStop() {
  stopRequested = true;
}

// ---- Yardımcılar ------------------------------------------------------------

function activeModel() {
  return useModelStore.getState().models.find((m) => m.isActive) ?? null;
}

/** Aktif sohbetteki agent mesajının agentRun alanını günceller (immutable). */
function patchRun(chatId: string, msgId: string, patch: (run: AgentRun) => AgentRun) {
  useChatStore.setState((s) => ({
    chats: s.chats.map((c) =>
      c.id === chatId
        ? {
            ...c,
            messages: c.messages.map((m) =>
              m.id === msgId && m.agentRun ? { ...m, agentRun: patch(m.agentRun) } : m,
            ),
          }
        : c,
    ),
  }));
}

function patchStep(chatId: string, msgId: string, idx: number, patch: Partial<AgentStep>) {
  patchRun(chatId, msgId, (run) => ({
    ...run,
    steps: run.steps.map((st, i) => (i === idx ? { ...st, ...patch } : st)),
  }));
}

function setMsgText(chatId: string, msgId: string, text: string) {
  useChatStore.setState((s) => ({
    chats: s.chats.map((c) =>
      c.id === chatId
        ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, text } : m)) }
        : c,
    ),
  }));
}

/** Model çıktısındaki ```tool:...``` bloklarını metinden ayıklar (nota girmesin). */
function stripToolBlocks(text: string): string {
  return text.replace(/```tool:[a-z_]+\n[\s\S]*?```/g, "").trim();
}

/** Planlama cevabından adım başlıklarını çıkarır — JSON dizi bekler, düşmezse
    satır-madde fallback. */
function parsePlan(raw: string): string[] {
  // JSON bloğu (```json ... ``` veya düz) ara
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr)) {
        const titles = arr
          .map((x) => (typeof x === "string" ? x : x?.title))
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim());
        if (titles.length > 0) return titles.slice(0, MAX_STEPS);
      }
    } catch {
      /* fallback'e düş */
    }
  }
  // Fallback: "1. ..." / "- ..." satırları
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter((l) => l.length > 3 && l.length < 200);
  return lines.slice(0, MAX_STEPS);
}

interface AgentEnv {
  chatId: string;
  interactive: boolean;
  /** Durdurma kontrolü — in-chat global bayrağı okur; detached'de hep false
      (sohbetteki "durdur" arka plan görevini kesmesin). */
  stopped: () => boolean;
  /** Sistem promptunun başına eklenecek persona (zamanlanmış görevler). */
  persona?: string;
  /** UI güncellemesi (detached modda no-op). */
  onRun?: (patch: (run: AgentRun) => AgentRun) => void;
  onStep?: (idx: number, patch: Partial<AgentStep>) => void;
}

async function callModel(
  messages: LlmMessage[],
  opts: { maxTokens: number; temperature?: number; withTools?: boolean },
): Promise<string> {
  const model = activeModel();
  if (!model) throw new Error("Aktif model yok");
  const resp = await ipc.modelsChat({
    modelId: model.id,
    provider: model.provider,
    messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    ...(opts.withTools ? { tools: buildNativeTools(model) } : {}),
  });
  return resp.content ?? "";
}

/** Adımdaki araç bloklarını çalıştırır (zaman aşımı + hata yakalama send ile aynı). */
async function runBlocks(
  blocks: ReturnType<typeof parseToolBlocks>,
  interactive: boolean,
  stopped: () => boolean,
): Promise<ToolAction[]> {
  const actions: ToolAction[] = [];
  for (const block of blocks) {
    if (stopped()) break;
    try {
      const action = await Promise.race([
        executeToolBlock(block, { interactive }),
        new Promise<ToolAction>((_, reject) =>
          setTimeout(() => reject(new Error("Araç zaman aşımı")), TOOL_TIMEOUT_MS),
        ),
      ]);
      actions.push(action);
    } catch (e) {
      actions.push({
        kind: block.kind,
        path: block.path,
        command: block.command ?? block.query,
        content: `Hata: ${String(e)}`,
        collapsed: false,
      });
    }
  }
  return actions;
}

// ---- Çekirdek ---------------------------------------------------------------

/**
 * Hedefi planla-yürüt-sentezle döngüsüyle koşturur. Sohbetten bağımsız —
 * history kendi içinde; UI yansıtması env callback'leriyle. Nihai raporu döner.
 */
async function runAgentCore(goal: string, env: AgentEnv): Promise<string> {
  const startedAt = Date.now();
  const timedOut = () => Date.now() - startedAt > TOTAL_TIMEOUT_MS;

  // Sistem promptu: send'inkine paralel — ARAÇ TARİFİ ŞART. Native tools yolu
  // olmayan modeller (Gemini vb.) araçları yalnızca bu blok tarifinden öğrenir;
  // TOOL_SYSTEM_PROMPT olmadan model "araçlara erişimim yok" der. envPromptBlock
  // gerçek ev/Belgeler yollarını verir (model kullanıcı adı tahmin etmesin).
  const appsPrompt = buildEnabledAppsPrompt();
  const mcpPrompt = buildMcpToolsPrompt();
  const envBlock = envPromptBlock();
  const system =
    (env.persona ? `${env.persona}\n\n` : "") +
    "Sen Axiom'un otonom görev ajanısın. Sana bir HEDEF ve bir PLAN verilir; " +
    "her seferinde yalnızca istenen adımı yerine getirirsin. Araç gerekiyorsa " +
    "araç çağrısı yap; araç sonuçları sana geri verilir. Kısa ve öz yaz." +
    `\n\n${TOOL_SYSTEM_PROMPT}` +
    (envBlock ? `\n\n${envBlock}` : "") +
    (appsPrompt ? `\n\n${appsPrompt}` : "") +
    (mcpPrompt ? `\n\n${mcpPrompt}` : "");

  const history: LlmMessage[] = [{ role: "system", content: system }];

  // 1) PLANLAMA ---------------------------------------------------------------
  env.onRun?.((r) => ({ ...r, status: "planning" }));
  const planRaw = await callModel(
    [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `HEDEF: ${goal}\n\n` +
          `Bu hedefi en fazla ${MAX_STEPS} somut, sıralı adıma böl. Her adım tek ` +
          `cümle olsun ve araçlarla (dosya okuma/yazma, komut, web araması vb.) ` +
          `yürütülebilir olsun. SADECE JSON dizi döndür, başka hiçbir şey yazma. ` +
          `Örnek: [{"title":"..."},{"title":"..."}]`,
      },
    ],
    { maxTokens: 600, temperature: 0.2 },
  );
  if (env.stopped()) throw new AgentStopped();

  let titles = parsePlan(planRaw);
  if (titles.length === 0) titles = [goal]; // plan çıkmadıysa tek adım: hedefin kendisi

  const steps: AgentStep[] = titles.map((title) => ({ title, status: "pending" }));
  env.onRun?.((r) => ({ ...r, status: "running", steps }));

  history.push({ role: "user", content: `HEDEF: ${goal}\nPLAN:\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}` });

  // 2) YÜRÜTME ---------------------------------------------------------------
  for (let i = 0; i < steps.length; i++) {
    if (env.stopped()) throw new AgentStopped();
    if (timedOut()) throw new Error("Toplam süre tavanı aşıldı");

    env.onStep?.(i, { status: "running" });
    const stepActions: ToolAction[] = [];

    try {
      history.push({
        role: "user",
        content:
          `Şimdi SADECE ${i + 1}. adımı yap: "${titles[i]}". ` +
          `Gerekli araç çağrılarını yap; adım tamamlanınca kısa bir sonuç özeti yaz.`,
      });

      let note = "";
      for (let iter = 0; iter < MAX_ITER_PER_STEP; iter++) {
        if (env.stopped()) throw new AgentStopped();
        const reply = await callModel(history, { maxTokens: 2048, withTools: true });
        history.push({ role: "assistant", content: reply });

        const blocks = parseToolBlocks(reply);
        note = stripToolBlocks(reply) || note;
        if (blocks.length === 0) break; // araç istenmedi → adım bitti

        const actions = await runBlocks(blocks, env.interactive, env.stopped);
        stepActions.push(...actions);
        env.onStep?.(i, { actions: [...stepActions] });
        history.push({ role: "user", content: "Araç sonuçları:\n" + buildToolResultText(actions) });

        if (iter === MAX_ITER_PER_STEP - 1) {
          history.push({ role: "user", content: "Bu adım için araç turu sınırına ulaşıldı — eldeki sonuçlarla adımı özetle." });
          const wrap = await callModel(history, { maxTokens: 512 });
          history.push({ role: "assistant", content: wrap });
          note = stripToolBlocks(wrap) || note;
        }
      }

      env.onStep?.(i, {
        status: "done",
        note: note.slice(0, 500),
        actions: stepActions.length ? stepActions : undefined,
      });
    } catch (e) {
      if (e instanceof AgentStopped) throw e;
      env.onStep?.(i, { status: "failed", note: String(e).slice(0, 300) });
      history.push({ role: "user", content: `${i + 1}. adım hata verdi (${String(e).slice(0, 200)}). Sonraki adıma geç, gerekiyorsa bunu telafi et.` });
    }
  }

  // 3) SENTEZ ------------------------------------------------------------------
  if (env.stopped()) throw new AgentStopped();
  env.onRun?.((r) => ({ ...r, status: "synthesizing" }));
  history.push({
    role: "user",
    content:
      "Tüm adımlar tamamlandı. HEDEFE dair nihai, derli toplu raporu yaz " +
      "(markdown kullanabilirsin). Araç çağrısı YAPMA.",
  });
  const report = await callModel(history, { maxTokens: 4096 });
  return stripToolBlocks(report);
}

class AgentStopped extends Error {
  constructor() {
    super("stopped");
  }
}

// ---- Sohbet içi giriş noktası ----------------------------------------------

/**
 * /agent komutu — aktif sohbete AgentRunCard'lı mesaj ekler ve döngüyü koşturur.
 * Çağıran, kullanıcı mesajını zaten eklemiş olmalı (chatStore.send yapar).
 */
export async function runAgentInChat(goal: string): Promise<void> {
  const chatId = useChatStore.getState().activeChatId;
  if (!chatId) return;
  stopRequested = false;

  const msgId = crypto.randomUUID();
  const initial: UiChatMessage = {
    id: msgId,
    role: "agent",
    text: "",
    agentRun: { goal, status: "planning", steps: [] },
  };
  useChatStore.setState((s) => ({
    thinking: true,
    thinkingStatus: "Plan yapılıyor...",
    chats: s.chats.map((c) =>
      c.id === chatId ? { ...c, messages: [...c.messages, initial] } : c,
    ),
  }));

  const env: AgentEnv = {
    chatId,
    interactive: true,
    stopped: () => stopRequested,
    onRun: (patch) => patchRun(chatId, msgId, patch),
    onStep: (idx, patch) => patchStep(chatId, msgId, idx, patch),
  };

  try {
    const report = await runAgentCore(goal, env);
    setMsgText(chatId, msgId, report);
    patchRun(chatId, msgId, (r) => ({ ...r, status: "done" }));
  } catch (e) {
    if (e instanceof AgentStopped) {
      patchRun(chatId, msgId, (r) => ({ ...r, status: "stopped" }));
    } else {
      patchRun(chatId, msgId, (r) => ({ ...r, status: "failed", error: String(e).slice(0, 300) }));
    }
  } finally {
    stopRequested = false;
    // thinking=false → chatStore güvenlik ağı aktif sohbeti SQLite'a yazar.
    useChatStore.setState({ thinking: false, thinkingStatus: "" });
  }
}

// ---- Arka plan giriş noktası (Faz 5.3) ---------------------------------------

/**
 * Sohbete dokunmadan koşar (TaskBoard / zamanlanmış görevler). interactive:false —
 * onay gerektiren araçlar sessizce reddedilir, model açıklamayı görür.
 * Sohbetteki "durdur" bu koşuyu ETKİLEMEZ (stopped hep false).
 * Nihai raporu string döner; hata fırlatabilir.
 */
export async function runAgentDetached(
  goal: string,
  opts: { persona?: string } = {},
): Promise<string> {
  return runAgentCore(goal, {
    chatId: "",
    interactive: false,
    stopped: () => false,
    persona: opts.persona,
  });
}
