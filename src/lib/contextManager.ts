import type { ChatMessage as IpcChatMessage, OptimizationConfig } from "../types";

const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function totalTokens(messages: IpcChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export interface ContextResult {
  messages: IpcChatMessage[];
  effectiveCtx: number;
  trimmed: boolean;
  usedTokens: number;
  budgetTokens: number;
}

export function fitContext(
  messages: IpcChatMessage[],
  config: OptimizationConfig | null,
): ContextResult {
  const maxCtx = config?.numCtx ?? 4096;

  // Reserve 20% for model output
  const inputBudget = Math.floor(maxCtx * 0.8);

  const current = totalTokens(messages);

  // Auto-size: for short conversations, a smaller context is fine
  // Pick the smallest power-of-2 aligned context that fits
  const needed = current + Math.floor(maxCtx * 0.2);
  const steps = [2048, 4096, 8192, 16384, 32768, 65536, 131072];
  let effectiveCtx = maxCtx;
  for (const s of steps) {
    if (s >= needed && s <= maxCtx) {
      effectiveCtx = s;
      break;
    }
  }
  if (effectiveCtx < 2048) effectiveCtx = 2048;

  // If within budget, no trimming needed
  if (current <= inputBudget) {
    return { messages, effectiveCtx, trimmed: false, usedTokens: current, budgetTokens: inputBudget };
  }

  // Trim: keep system prompt(s), always keep last 6 messages
  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const systemTokens = totalTokens(systemMsgs);
  const remainingBudget = inputBudget - systemTokens;

  if (remainingBudget <= 0) {
    const truncated = systemMsgs.map((m) => ({
      ...m,
      content: m.content.slice(0, Math.floor(inputBudget * CHARS_PER_TOKEN)),
    }));
    const last = nonSystem.slice(-2);
    const finalMsgs = [...truncated, ...last];
    return { messages: finalMsgs, effectiveCtx: maxCtx, trimmed: true, usedTokens: totalTokens(finalMsgs), budgetTokens: inputBudget };
  }

  // Keep messages from the end until we fill the budget
  const kept: IpcChatMessage[] = [];
  let usedTokens = 0;
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(nonSystem[i].content);
    if (usedTokens + msgTokens > remainingBudget) break;
    kept.unshift(nonSystem[i]);
    usedTokens += msgTokens;
  }

  // Always keep at least the last 2 messages even if over budget
  if (kept.length < 2 && nonSystem.length >= 2) {
    kept.splice(0, kept.length, ...nonSystem.slice(-2));
  }

  const trimmedCount = nonSystem.length - kept.length;
  if (trimmedCount > 0 && kept.length > 0) {
    const notice: IpcChatMessage = {
      role: "system",
      content: `[Önceki ${trimmedCount} mesaj bağlam penceresine sığmadığı için kırpıldı.]`,
    };
    const finalMsgs = [...systemMsgs, notice, ...kept];
    return {
      messages: finalMsgs,
      effectiveCtx: maxCtx,
      trimmed: true,
      usedTokens: totalTokens(finalMsgs),
      budgetTokens: inputBudget,
    };
  }

  const finalMsgs = [...systemMsgs, ...kept];
  return { messages: finalMsgs, effectiveCtx: maxCtx, trimmed: true, usedTokens: totalTokens(finalMsgs), budgetTokens: inputBudget };
}
