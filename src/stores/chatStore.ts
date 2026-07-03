import { create } from "zustand";
import { persist } from "zustand/middleware";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import * as chatDb from "../lib/chatDb";
import { buildNativeTools } from "../lib/toolRegistry";
import { envPromptBlock } from "../lib/envInfo";
import {
  applyAlwaysAllow,
  alwaysHintFor,
  scopeDirOf,
  type PermissionQueryLike,
} from "../lib/permissionUpdates";
import { useModelStore } from "./modelStore";
import { useDocumentStore } from "./documentStore";
import { useSkillStore } from "./skillStore";
import { useUserProfileStore } from "./userProfileStore";
import { useAppStore, executeAppTool } from "./appStore";
import { useApprovalStore } from "./approvalStore";
import { useSettingsStore } from "./settingsStore";
import { useOptimizationStore } from "./optimizationStore";
import { useTaskStore, type TaskStatus } from "./taskStore";
import { fitContext, estimateTokens } from "../lib/contextManager";
import { notifyResponseComplete } from "../lib/notify";
import type { ChatMessage as IpcChatMessage, DocumentAttachment, ToolAction } from "../types";

export const TOOL_SYSTEM_PROMPT = `# Araç Kullanımı

Aşağıdaki araçlara sahipsin. Gerektiğinde MUTLAKA kullan. Araç gerektiğinde açıklama yapma, direkt tool bloğunu yaz.

KRİTİK KURAL: Bir araç gerekiyorsa ÖNCE tool bloğunu yaz, SONRA kısa açıklama ekle. Asla "bakıyorum", "çekiyorum", "kontrol ediyorum" gibi yazıp tool bloğu yazmadan bırakma. Tool bloğu olmadan araç çağrılamaz.

## Ne zaman hangi aracı kullan:
- Hava durumu → weather
- Döviz/kur → currency
- Bilgi arama / kişi / konu → web_search
- Dosya okuma → read_file
- Dosya yazma → write_file
- Dizin listeleme → list_dir
- Dizin oluşturma → create_dir
- Komut çalıştırma → run_command
- Ayar okuma → get_settings
- Ayar değiştirme → change_setting
- Görev oluşturma → create_task
- Görevleri listeleme → list_tasks
- Görev güncelleme → update_task
- Görev tamamlama → complete_task
- Görev silme → delete_task
- Zamanlayıcı/alarm/hatırlatıcı → schedule_task

## Araç Formatları

\`\`\`tool:weather
city: Istanbul
\`\`\`

\`\`\`tool:currency
\`\`\`

\`\`\`tool:web_search
arama sorgusu
\`\`\`

\`\`\`tool:read_file
path: C:/Users/kullanici/dosya.txt
\`\`\`

\`\`\`tool:write_file
path: C:/Users/kullanici/dosya.txt
---
dosya içeriği
\`\`\`

\`\`\`tool:list_dir
path: C:/Users/kullanici
\`\`\`

\`\`\`tool:create_dir
path: C:/Users/kullanici/yeni-klasor
\`\`\`

\`\`\`tool:run_command
komut (örn: dir, node --version)
\`\`\`

\`\`\`tool:get_settings
\`\`\`

\`\`\`tool:change_setting
key: theme
value: light
\`\`\`

Değiştirilebilir ayarlar: theme (dark/light), fontSize (12-20), fontFamily (inter/system/jetbrains), launchAtStartup (true/false), notifyResponse (true/false), notifyModelDownload (true/false)

\`\`\`tool:create_task
title: Görev başlığı
description: Opsiyonel açıklama
priority: medium
\`\`\`

\`\`\`tool:list_tasks
status: pending
\`\`\`
status opsiyoneldir. Boş bırakılırsa tüm görevler listelenir.

\`\`\`tool:update_task
id: görev-id
title: Yeni başlık
status: running
priority: high
\`\`\`

\`\`\`tool:complete_task
id: görev-id
\`\`\`

\`\`\`tool:delete_task
id: görev-id
\`\`\`

\`\`\`tool:schedule_task
title: 5 dakikalık alarm
action: timer
delay: 5m
message: Süre doldu!
\`\`\`
action: timer | reminder | alarm | agent
delay: süre formatı — 30s, 5m, 1h, 1h30m, 2h gibi. "s" saniye, "m" dakika, "h" saat.
at: belirli bir saat — "HH:MM" (örn. "09:00") veya tam tarih "2026-07-01 09:00".
message: timer/reminder/alarm için bildirim metni; agent için arka planda çalışacak AI'ya verilecek **görev talimatı** (kullanılacak araçlar dahil).
recurring: once | daily | weekly (sadece agent türü için anlamlı; varsayılan once)
prompt: agent için system prompt (opsiyonel — kişilik/rol kuralları).

**ÖNEMLİ — action seçimi:**
- Sadece **bildirim/ses** çaldırmak yeterliyse → \`timer\`, \`reminder\`, \`alarm\`
- Belirli saatte/aralıkta **AI'nın çalışıp bir şey üretmesi veya bir aracı kullanması** gerekiyorsa → **\`agent\`** kullan
- "Her gün/sabah X yap", "her hafta X gönder", "saat X'de bana Y özetini at/yolla" → **mutlaka \`agent\`**
- Aynı görev için hem timer hem agent oluşturma — bir tane yeter ve doğrusu agent'tır

**Agent message alanı yazım kuralı:**
- Mesajda hangi araçların kullanılacağını **açıkça** belirt: "telegrama at", "mail taslağı oluştur", "takvime ekle" gibi.
- Çıktının nereye gideceğini yaz: telegram, mail, sadece bildirim, vb.
- Agent çalıştığında tüm araçlara (web_search, weather, telegram_send_message, gmail_*, calendar_*, vb.) erişebilir; mesajda söylersen onları kullanır.

**Agent görev örnekleri:**

Her sabah 9'da hava özetini Telegram'a yollasın:
\`\`\`tool:schedule_task
title: Sabah hava özeti — Telegram
action: agent
at: 09:00
recurring: daily
message: Trabzon'un bugünkü hava durumunu \`weather\` aracıyla al, kısa bir özet ve giyim tavsiyesi hazırla, ardından \`telegram_send_message\` ile chat'e gönder.
prompt: Sen Axiom'un günlük rutin asistanısın. Kısa, doğrudan, Türkçe yaz.
\`\`\`

Her pazartesi 08:30'da bugünün takvimini özetle:
\`\`\`tool:schedule_task
title: Haftalık takvim özeti
action: agent
at: 2026-07-06 08:30
recurring: weekly
message: \`calendar_today\` aracıyla bugünkü etkinlikleri al, başlık + saat olarak listele. Telegram'a yolla: \`telegram_send_message\`.
\`\`\`

**Kurallar:**
- Araç gerekiyorsa tool bloğunu HEMEN yaz, "bir saniye" / "bakayım" deme.
- Tool bloğunu yazarken **kullanıcıya "bu bloğu yazman gerek" gibi bir tarif gösterme** — sen yazıyorsun, sistem yürütüyor.
- Dosya yollarını tam yaz: \`C:/Users/...\`
- Araç gerekmiyorsa sadece metin yanıtla.
- Bir yanıtta birden fazla araç bloğu kullanabilirsin.
- Aynı işi yapan iki ayrı tool bloğu (timer + agent) oluşturma — sadece doğru olanı.
- Tool bloğunu her zaman \`\`\` ile düzgün kapat.

**Uygulama araçları (app_tool) için kritik format:**
- Telegram, Spotify, Gmail vb. araçlarını çağırırken **ASLA** \`\`\`tool:telegram_send_message\`\`\` veya \`\`\`tool:spotify_play\`\`\` gibi yazma.
- **Daima** \`\`\`tool:app_tool\`\`\` kullan, ardından \`app:\` ve \`tool:\` satırlarını ekle:

YANLIŞ:
\`\`\`tool:telegram_send_message
message: Merhaba!
\`\`\`

DOĞRU:
\`\`\`tool:app_tool
app: telegram
tool: telegram_send_message
text: Merhaba!
\`\`\`

Parametre adları tool tanımında ne yazıyorsa o (telegram için \`text\`, gmail_draft için \`to/subject/body\` vb.).`;

/**
 * Etkin uygulamaların (Telegram, Spotify, Gmail vb.) tool tanımlarını
 * markdown bir blok olarak üretir. Hem normal sohbette hem agent task
 * çalıştırılırken kullanılır — agent'ın telegram_send_message gibi
 * app tool'larını bilmemesi sorununu çözer.
 */
export function buildEnabledAppsPrompt(): string | null {
  const enabledApps = useAppStore.getState().apps.filter(
    (a) => a.enabled && a.tools?.length > 0,
  );
  if (enabledApps.length === 0) return null;

  const appSection = enabledApps
    .map((a) => {
      const toolDefs = a.tools
        .map((t) => {
          const example = t.parameters === "yok"
            ? `\`\`\`tool:app_tool\napp: ${a.id}\ntool: ${t.name}\n\`\`\``
            : `\`\`\`tool:app_tool\napp: ${a.id}\ntool: ${t.name}\n${t.parameters.split(", ").map((p) => `${p}: ...`).join("\n")}\n\`\`\``;
          return `### ${t.name}\n${t.description}\n${example}`;
        })
        .join("\n\n");
      return `## ${a.name} Araçları\n${toolDefs}`;
    })
    .join("\n\n");
  return "# Uygulama Araçları\n\n" + appSection;
}

const MODE_PROMPTS: Record<ChatMode, string | null> = {
  fast: "Hızlı ve kısa yanıt ver. Gereksiz detay verme, doğrudan cevapla. Mümkün olan en az kelimeyle açık ve net yanıt ver.",
  balanced: null,
  thinking: "Adım adım düşün. Problemi analiz et, farklı açılardan değerlendir, ardından sonuca var. Düşünme sürecini detaylı göster.",
};

function buildSystemPrompt(chatId: string, toolUseEnabled: boolean, snapshotDocs?: DocumentAttachment[]): string | null {
  const parts: string[] = [];

  const now = new Date();
  const dateStr = now.toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  parts.push(`Bugünün tarihi: ${dateStr}, saat ${timeStr}. Bunu erekmedikçe vurgulama.`);

  parts.push(
    "Doğal ve samimi konuş. Kullanıcıyla sıcak bir sohbet havası kur. " +
    "Profil bilgilerini açıkça tekrarlama veya \"biliyorum ki\" diye başlama — bu bilgiler sadece arka planda yanıtlarını şekillendirmek için var. " +
    "Robotik veya aşırı resmi olma, karşındaki bir insan gibi konuş."
  );

  const mode = useChatStore.getState().chatMode;
  const modePrompt = MODE_PROMPTS[mode];
  if (modePrompt) {
    parts.push(modePrompt);
  }

  parts.push(
    "# İnteraktif Yanıtlar\n" +
    "İstek doğası gereği etkileşimliyse (test/quiz, anket, hesaplayıcı, form, mini oyun, adım adım öğretici, karşılaştırma aracı) SORMADAN doğrudan interaktif üret: yanıtına TEK bir ```html kod bloğu ekle — uygulama bunu canlı, tıklanabilir olarak render eder ve kullanıcı kodu değil bitmiş arayüzü görür. Kod bloğundan önce en fazla tek cümle yaz; kodun içeriğini metinde anlatma, tekrar etme.\n" +
    "Teknik kurallar: tamamen self-contained tek parça HTML (davranış <script> içinde inline); harici CDN/kaynak yok; sabit yükseklik verme, içerik doğal yüksekliğinde aksın; sade metnin yeterli olduğu yerde metin kal.\n" +
    "Quiz lerde her zaman ileri ve geri butonları olsun onların arasında soru sayacı olsun. \n"+
    "TASARIM KİMLİĞİ (uy, kendi kafana göre tasarlama):\n" +
    "- CEVABIN DEVAMI GİBİ: içeriği kendi büyük kenarlıklı/gölgeli KUTUSUNA SARMA. En dıştaki kapsayıcıya border, background, box-shadow verme — sohbet metninin doğal devamı gibi aksın. Kenarlığı yalnızca alt öğeleri (tek bir seçenek satırı, sonuç kutusu) hafifçe ayırmak için ince kullan; iç içe kart yığma.\n" +
    "- KOMPAKT: aşırı padding/margin verme. Dış kenarda yatay boşluk bırakma (içerik metinle aynı hizada başlasın). Öğeler arası boşluk küçük tut (8-12px). Butonlar zaten küçük ve zarif temalıdır — onları büyütme, ekstra padding ekleme.\n" +
    "- AŞAMALI AKIŞ: çok maddeli içerikte (test soruları, form adımları, anket) maddeleri alt alta LİSTELEME — tek seferde TEK adım göster; İleri/Geri kontrolü, üstte küçük ilerleme göstergesi (örn. 2/5 veya nokta dizisi), sonunda özet/sonuç ekranı olsun. Sonuç ekranını başta gösterme, yalnız bitince aç.\n" +
    "- GEÇİŞLER: adımlar arası yumuşak geçiş kullan (opacity + hafif translateY, ~0.25s ease). Şaşaalı animasyon yok.\n" +
    "- Renk paleti UYDURMA. Ortamda uygulamanın temasıyla otomatik eşleşen hazır CSS değişkenleri var, SADECE bunları kullan: var(--base) zemin, var(--surface) / var(--surface-2) / var(--surface-3) kart-panel katmanları, var(--border) kenarlık, var(--text) / var(--text-secondary) / var(--text-faint) metin tonları, var(--accent) vurgu, var(--success) / var(--warn) / var(--danger) durum renkleri, var(--radius) köşe yarıçapı.\n" +
    "- BUTONLARA RENK VERME: button etiketi zaten temalıdır, background/color yazma. Birincil aksiyon için class=\"primary\", quiz şıkkı / seçilebilir satır için class=\"option\" (durumları: .selected, .correct, .wrong) hazır sınıflarını kullan. var(--accent)'i ASLA geniş arkaplan olarak kullanma — bazı temalarda saf beyazdır ve bloğu patlatır. Vurgu gerekiyorsa var(--surface-2)/var(--surface-3) katmanları yeterli.\n" +
    "- YÜKSEKLİK: 100vh / min-height / sabit height verme; içeriği dikeyde ortalamaya çalışma — kap, içeriğin doğal yüksekliğine otomatik oturur (adım değişince küçülür de).\n" +
    "- Temel etiketler (button, input, select, table, h1-h4, pre) zaten otomatik temalıdır — <style>'ı yalnızca yerleşim (flex/grid/spacing) ve geçişler için yaz.\n" +
    "- Tasarım dili: sade ve düz renk (gradient yok, gölge yok), ince kenarlıklar, küçük köşe yarıçapı."
  );

  if (toolUseEnabled) {
    parts.push(TOOL_SYSTEM_PROMPT);

    // Gerçek ev dizini/özel klasörler — model kullanıcı adını görünen addan
    // tahmin edip var olmayan yollara (C:/Users/Fırat Tuna Arslan/...) gitmesin.
    const envBlock = envPromptBlock();
    if (envBlock) parts.push(envBlock);

    const currentTasks = useTaskStore.getState().tasks;
    if (currentTasks.length > 0) {
      const summary = currentTasks.slice(0, 20).map(t =>
        `- [${t.status}] ${t.title}${t.priority ? ` (${t.priority})` : ""} (ID: ${t.id})`
      ).join("\n");
      parts.push(
        `# Mevcut Görevler\nKullanıcının ${currentTasks.length} görevi var:\n${summary}` +
        (currentTasks.length > 20 ? `\n...ve ${currentTasks.length - 20} görev daha. Tamamını görmek için list_tasks kullan.` : "")
      );
    }

    const appsPrompt = buildEnabledAppsPrompt();
    if (appsPrompt) parts.push(appsPrompt);
  } else {
    const active = useModelStore.getState().models.find(m => m.isActive);
    if (active && !modelSupportsTools(active)) {
      parts.push(
        "Bu model araç çağrısını (tool calling) desteklemiyor. " +
        "Kullanıcı senden dosya okuma/yazma, komut çalıştırma, hava durumu, görev yönetimi, web araması gibi " +
        "araç gerektiren bir şey isterse, nazikçe bu modelin araç kullanamadığını ve " +
        "araç destekli bir modele (örn. Llama 3.1, Qwen 2.5, Gemma 3 veya cloud modeller) " +
        "geçmeleri gerektiğini belirt. Bunu her mesajda değil, yalnızca araç gerektiren bir istek geldiğinde söyle."
      );
    }
  }

  const activePrompts = useSkillStore.getState().getActivePrompts();
  if (activePrompts.length > 0) {
    parts.push(activePrompts.join("\n\n---\n\n"));
  }

  const profileInjection = useUserProfileStore.getState().getPromptInjection();
  if (profileInjection) {
    parts.push(profileInjection);
  }

  const docs = snapshotDocs ?? useDocumentStore.getState().getDocumentsForChat(chatId);
  const textDocs = docs.filter((d) => !d.base64Data);
  if (textDocs.length > 0) {
    const docContext = textDocs
      .map((d) => `[Belge: ${d.filename}]\n${d.extractedText}`)
      .join("\n\n---\n\n");
    parts.push(
      "Kullanıcı aşağıdaki belgeleri bağlam olarak ekledi. Yanıtlarında bu belgelerin içeriğini dikkate al:\n\n" +
        docContext
    );
  }
  const imageDocs = docs.filter((d) => !!d.base64Data);
  if (imageDocs.length > 0 && modelSupportsVision(useModelStore.getState().models.find(m => m.isActive))) {
    parts.push(
      `Kullanıcı mesajına ${imageDocs.length} adet resim ekledi. Resimler sana doğrudan iletildi, görebiliyorsun. ` +
      `Placeholder veya şablon metin KULLANMA — resimde gerçekten ne gördüğünü kendi cümlelerinle doğrudan anlat.`
    );
  }

  if (parts.length === 0) return null;

  let prompt = parts.join("\n---\n");
  if (prompt.length > 30000) {
    prompt = prompt.slice(0, 30000) + "\n\n[Bağlam çok uzun olduğu için kısaltıldı]";
  }
  return prompt;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type ChatMode = "fast" | "balanced" | "thinking";

/** Bir agent mesajının tek bir üretim sürümü (yeniden oluşturma geçmişi). */
export interface MessageVersion {
  text: string;
  thinkingContent?: string;
  toolActions?: ToolAction[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "search" | "card";
  text: string;
  toolActions?: ToolAction[];
  searchResults?: SearchResult[];
  fromToggle?: boolean;
  cardType?: "weather" | "currency";
  cardData?: unknown;
  thinkingContent?: string;
  images?: string[];
  imageCount?: number;
  /** Yeniden oluşturulan cevap sürümleri (eski→yeni). text/toolActions daima
      görüntülenen sürümü yansıtır; bu liste arşivdir. */
  alternates?: MessageVersion[];
  /** Görüntülenen sürümün alternates içindeki indeksi. */
  versionIndex?: number;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  compactedSummary?: string;
}

interface StreamTokenPayload {
  token: string;
  done: boolean;
  chatId: string;
  thinking?: string;
  doneReason?: string;
}

const MAX_TOOL_STEPS = 5;

export function modelSupportsTools(model: { capabilities?: string[] | null } | null | undefined): boolean {
  if (!model?.capabilities) return false;
  return model.capabilities.includes("tools");
}

export function modelSupportsVision(model: { capabilities?: string[] | null } | null | undefined): boolean {
  if (!model?.capabilities) return false;
  return model.capabilities.includes("vision");
}

export function computeContextUsage(
  messages: ChatMessage[],
  modelContextLength: number | null | undefined,
): ContextUsage {
  const maxCtx = modelContextLength ?? 4096;
  const used = messages
    .filter((m) => m.role !== "search" && m.role !== "card")
    .reduce((sum, m) => sum + estimateTokens(m.text), 0);
  return { used, total: maxCtx };
}


function matchAppCommand(text: string): { appId: string; query: string } | null {
  const match = text.match(/^\/(github|telegram|discord|notion|spotify|vscode|chrome)\s+([\s\S]+)/i);
  if (!match) return null;
  return { appId: match[1].toLowerCase(), query: match[2].trim() };
}

function buildAppCommandPrompt(appId: string, query: string): string | null {
  const app = useAppStore.getState().apps.find((a) => a.id === appId);
  if (!app || app.tools.length === 0) return null;

  const toolDefs = app.tools
    .map((t) => {
      const params = t.parameters === "yok"
        ? `\`\`\`tool:app_tool\napp: ${appId}\ntool: ${t.name}\n\`\`\``
        : `\`\`\`tool:app_tool\napp: ${appId}\ntool: ${t.name}\n${t.parameters.split(", ").map((p) => `${p}: ...`).join("\n")}\n\`\`\``;
      return `### ${t.name}\n${t.description}\n${params}`;
    })
    .join("\n\n");

  return `Sen ${app.name} asistanısın. Kullanıcının isteğini yerine getirmek için MUTLAKA aşağıdaki araçları kullan.

# ${app.name} Araçları

${toolDefs}

**Önemli:**
- İstenen görevi yerine getirmek için uygun aracı HEMEN kullan, soru sorma.
- Birden fazla araç gerekiyorsa hepsini tek yanıtta kullan.
- Araç sonuçlarını kullanıcıya düzgün formatlayarak aktar.

Kullanıcı isteği: ${query}`;
}

// ---- Tool-use helpers ----

function parseDelay(delay: string): number | null {
  let totalMs = 0;
  const pattern = /(\d+)\s*(h|m|s|sa|dk|sn|saat|dakika|saniye)/gi;
  let match;
  let matched = false;
  while ((match = pattern.exec(delay)) !== null) {
    matched = true;
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === "h" || unit === "sa" || unit === "saat") totalMs += val * 3_600_000;
    else if (unit === "m" || unit === "dk" || unit === "dakika") totalMs += val * 60_000;
    else if (unit === "s" || unit === "sn" || unit === "saniye") totalMs += val * 1_000;
  }
  if (!matched) {
    const num = parseInt(delay, 10);
    if (!isNaN(num)) totalMs = num * 60_000;
  }
  return totalMs > 0 ? totalMs : null;
}

/** "HH:MM" veya "YYYY-MM-DD HH:MM" → epoch ms. Saat geçmişte ise yarın aynı saate ilerletir. */
function parseAtTime(at: string): number | null {
  const trimmed = at.trim();
  // Full date-time
  const fullMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[\sT](\d{1,2}):(\d{2})$/);
  if (fullMatch) {
    const d = new Date(
      parseInt(fullMatch[1]),
      parseInt(fullMatch[2]) - 1,
      parseInt(fullMatch[3]),
      parseInt(fullMatch[4]),
      parseInt(fullMatch[5]),
      0,
      0,
    );
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  // HH:MM bugün, geçmişse yarın
  const hm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const hour = parseInt(hm[1]);
    const minute = parseInt(hm[2]);
    if (hour > 23 || minute > 59) return null;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime();
  }
  // Direct ISO
  const iso = new Date(trimmed);
  if (!isNaN(iso.getTime())) return iso.getTime();
  return null;
}

function formatScheduleLabel(epoch: number): string {
  const diffMs = epoch - Date.now();
  if (diffMs > 0 && diffMs < 24 * 3_600_000) {
    const mins = Math.round(diffMs / 60_000);
    return mins >= 60 ? `${Math.floor(mins / 60)}sa ${mins % 60}dk sonra` : `${mins}dk sonra`;
  }
  return new Date(epoch).toLocaleString("tr-TR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

type ToolBlock = {
  kind: "read_file" | "write_file" | "run_command" | "list_dir" | "create_dir" | "web_search" | "app_tool" | "get_settings" | "change_setting" | "weather" | "currency" | "create_task" | "list_tasks" | "update_task" | "complete_task" | "delete_task" | "schedule_task";
  path?: string;
  content?: string;
  command?: string;
  query?: string;
  appId?: string;
  appToolName?: string;
  appParams?: Record<string, string>;
  settingKey?: string;
  settingValue?: string;
  city?: string;
  taskTitle?: string;
  taskDescription?: string;
  taskId?: string;
  taskStatus?: string;
  taskPriority?: "low" | "medium" | "high";
  scheduleDelay?: string;
  scheduleAction?: string;
  scheduleMessage?: string;
  scheduleAt?: string;        // ISO veya HH:MM
  scheduleRecurring?: string; // once|daily|weekly
  schedulePrompt?: string;    // agent için sistem promptu
};

/**
 * Modelin yanlış format üretmesi durumuna karşı koruma:
 * `tool:telegram_send_message` gibi doğrudan app tool adıyla yazılmış blokları,
 * etkin uygulamalarda eşleşme varsa otomatik olarak `tool:app_tool` blokuna
 * dönüştürür. Bu adımı parseToolBlocks parse etmeden önce çalıştırırız.
 */
function rewriteAppToolBlocks(text: string): string {
  const apps = useAppStore.getState().apps;
  // Tool adı → app id eşlemesi (yalnız etkin app'ler; tüm app'leri de fallback olarak ekle)
  const toolToApp = new Map<string, string>();
  for (const app of apps) {
    for (const t of app.tools) {
      if (!toolToApp.has(t.name)) toolToApp.set(t.name, app.id);
    }
  }
  if (toolToApp.size === 0) return text;

  return text.replace(
    /```tool:([a-z][a-z0-9_]*)\n([\s\S]*?)```/g,
    (full, kind: string, body: string) => {
      // Bilinen built-in kindler ve app_tool aynen kalsın
      const builtin = new Set([
        "read_file", "write_file", "run_command", "list_dir", "create_dir",
        "web_search", "app_tool", "get_settings", "change_setting",
        "weather", "currency",
        "create_task", "list_tasks", "update_task", "complete_task",
        "delete_task", "schedule_task",
      ]);
      if (builtin.has(kind)) return full;
      const appId = toolToApp.get(kind);
      if (!appId) return full;
      // Yeniden yaz: tool:app_tool\napp: ...\ntool: ...\n<orig body>
      return "```tool:app_tool\napp: " + appId + "\ntool: " + kind + "\n" + body.trim() + "\n```";
    },
  );
}

export function parseToolBlocks(text: string): ToolBlock[] {
  const blocks: ToolBlock[] = [];
  const normalized = rewriteAppToolBlocks(text);
  const regex = /```tool:(read_file|write_file|run_command|list_dir|create_dir|web_search|app_tool|get_settings|change_setting|weather|currency|create_task|list_tasks|update_task|complete_task|delete_task|schedule_task)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const kind = match[1] as ToolBlock["kind"];
    const body = match[2].trim();
    if (kind === "read_file" || kind === "list_dir" || kind === "create_dir") {
      const pathMatch = body.match(/^path:\s*(.+)/m);
      if (pathMatch) blocks.push({ kind, path: pathMatch[1].trim() });
    } else if (kind === "write_file") {
      const pathMatch = body.match(/^path:\s*(.+)/m);
      const sepIdx = body.indexOf("---");
      if (pathMatch && sepIdx !== -1) {
        blocks.push({ kind, path: pathMatch[1].trim(), content: body.slice(sepIdx + 3).trim() });
      }
    } else if (kind === "run_command") {
      blocks.push({ kind, command: body });
    } else if (kind === "web_search") {
      blocks.push({ kind, query: body });
    } else if (kind === "weather") {
      const cityMatch = body.match(/^city:\s*(.+)/m);
      blocks.push({ kind, city: cityMatch ? cityMatch[1].trim() : "Istanbul" });
    } else if (kind === "currency") {
      blocks.push({ kind });
    } else if (kind === "app_tool") {
      const appIdMatch = body.match(/^app:\s*(.+)/m);
      const toolMatch = body.match(/^tool:\s*(.+)/m);
      if (appIdMatch && toolMatch) {
        const params: Record<string, string> = {};
        for (const line of body.split("\n")) {
          const m = line.match(/^(\w+):\s*(.+)/);
          if (m && m[1] !== "app" && m[1] !== "tool") {
            params[m[1]] = m[2].trim();
          }
        }
        blocks.push({ kind, appId: appIdMatch[1].trim(), appToolName: toolMatch[1].trim(), appParams: params });
      }
    } else if (kind === "get_settings") {
      blocks.push({ kind });
    } else if (kind === "change_setting") {
      const keyMatch = body.match(/^key:\s*(.+)/m);
      const valueMatch = body.match(/^value:\s*(.+)/m);
      if (keyMatch && valueMatch) {
        blocks.push({ kind, settingKey: keyMatch[1].trim(), settingValue: valueMatch[1].trim() });
      }
    } else if (kind === "create_task") {
      const titleMatch = body.match(/^title:\s*(.+)/m);
      const descMatch = body.match(/^description:\s*(.+)/m);
      const prioMatch = body.match(/^priority:\s*(.+)/m);
      if (titleMatch) {
        blocks.push({
          kind,
          taskTitle: titleMatch[1].trim(),
          taskDescription: descMatch ? descMatch[1].trim() : "",
          taskPriority: prioMatch ? prioMatch[1].trim() as "low" | "medium" | "high" : undefined,
        });
      }
    } else if (kind === "list_tasks") {
      const statusMatch = body.match(/^status:\s*(.+)/m);
      blocks.push({
        kind,
        taskStatus: statusMatch ? statusMatch[1].trim() : undefined,
      });
    } else if (kind === "update_task") {
      const idMatch = body.match(/^id:\s*(.+)/m);
      const titleMatch = body.match(/^title:\s*(.+)/m);
      const descMatch = body.match(/^description:\s*(.+)/m);
      const statusMatch = body.match(/^status:\s*(.+)/m);
      const prioMatch = body.match(/^priority:\s*(.+)/m);
      if (idMatch) {
        blocks.push({
          kind,
          taskId: idMatch[1].trim(),
          taskTitle: titleMatch ? titleMatch[1].trim() : undefined,
          taskDescription: descMatch ? descMatch[1].trim() : undefined,
          taskStatus: statusMatch ? statusMatch[1].trim() : undefined,
          taskPriority: prioMatch ? prioMatch[1].trim() as "low" | "medium" | "high" : undefined,
        });
      }
    } else if (kind === "complete_task") {
      const idMatch = body.match(/^id:\s*(.+)/m);
      if (idMatch) blocks.push({ kind, taskId: idMatch[1].trim() });
    } else if (kind === "delete_task") {
      const idMatch = body.match(/^id:\s*(.+)/m);
      if (idMatch) blocks.push({ kind, taskId: idMatch[1].trim() });
    } else if (kind === "schedule_task") {
      const titleMatch = body.match(/^title:\s*(.+)/m);
      const actionMatch = body.match(/^action:\s*(.+)/m);
      const delayMatch = body.match(/^delay:\s*(.+)/m);
      const atMatch = body.match(/^at:\s*(.+)/m);
      const messageMatch = body.match(/^message:\s*(.+)/m);
      const recurringMatch = body.match(/^recurring:\s*(.+)/m);
      const promptMatch = body.match(/^prompt:\s*(.+)/m);
      if (titleMatch && (delayMatch || atMatch)) {
        blocks.push({
          kind,
          taskTitle: titleMatch[1].trim(),
          scheduleAction: actionMatch ? actionMatch[1].trim() : "timer",
          scheduleDelay: delayMatch ? delayMatch[1].trim() : undefined,
          scheduleAt: atMatch ? atMatch[1].trim() : undefined,
          scheduleMessage: messageMatch ? messageMatch[1].trim() : undefined,
          scheduleRecurring: recurringMatch ? recurringMatch[1].trim() : undefined,
          schedulePrompt: promptMatch ? promptMatch[1].trim() : undefined,
        });
      }
    }
  }
  return blocks;
}

export interface ToolExecOptions {
  /**
   * Kullanıcı başında mı? Sohbet penceresi = true (varsayılan).
   * Zamanlanmış agent görevleri ve Telegram auto-mode = false — bu bağlamlarda
   * "confirm" gerektiren izinler SORULMAZ, otomatik reddedilir; aksi halde
   * kullanıcının haberi olmadan onay kartı asılı kalır ya da (daha kötüsü)
   * uzaktan gelen bir istek sessizce sistem erişimi kazanır.
   */
  interactive?: boolean;
}

export async function executeToolBlock(
  block: ToolBlock,
  opts: ToolExecOptions = {},
): Promise<ToolAction> {
  const interactive = opts.interactive ?? true;

  // İzin kontrolü: deny → engelle; confirm → kullanıcıya sor (interaktifse);
  // allow → geç. Dönen msg, model'e tool sonucu olarak iletilir.
  // "Her zaman izin ver" kararı kalıcı kurala çevrilir (permissionUpdates) —
  // İzinler sayfası aynı config'i okuduğu için karar orada da görünür.
  async function checkPermission(
    query: PermissionQueryLike,
    prompt: { title: string; detail: string; scopeDir?: string },
  ): Promise<{ ok: boolean; msg: string }> {
    try {
      const decision = await ipc.permissionsCheck(query as unknown as Record<string, unknown>);
      if (decision.kind === "allow") return { ok: true, msg: "" };
      if (decision.kind === "deny") {
        return { ok: false, msg: `İzin reddedildi: ${decision.reason}` };
      }
      // confirm
      if (!interactive) {
        return {
          ok: false,
          msg: "İzin gerekli: bu işlem arka planda onaysız çalıştırılamaz. Kullanıcıdan uygulama içinden çalıştırmasını iste.",
        };
      }
      const choice = await useApprovalStore
        .getState()
        .request(prompt.title, prompt.detail, {
          alwaysHint: alwaysHintFor(query, prompt.scopeDir),
        });
      if (choice === "deny") return { ok: false, msg: "Kullanıcı bu işlemi reddetti." };
      if (choice === "always") await applyAlwaysAllow(query, prompt.scopeDir);
      return { ok: true, msg: "" };
    } catch {
      return { ok: false, msg: "İzin kontrolü yapılamadı; işlem engellendi." };
    }
  }

  try {
    switch (block.kind) {
      case "read_file": {
        const perm = await checkPermission(
          { action: "fs_read", path: block.path! },
          { title: "Dosya okuma izni", detail: block.path!, scopeDir: scopeDirOf(block.path!, false) },
        );
        if (!perm.ok) return { kind: "read_file", path: block.path, content: perm.msg, collapsed: false };
        const dir = block.path!.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || "/";
        const result = await ipc.fsReadFile(block.path!, dir);
        return { kind: "read_file", path: block.path, content: result.content, collapsed: true };
      }
      case "write_file": {
        const perm = await checkPermission(
          { action: "fs_write", path: block.path! },
          { title: "Dosya yazma izni", detail: block.path!, scopeDir: scopeDirOf(block.path!, false) },
        );
        if (!perm.ok) return { kind: "write_file", path: block.path, content: perm.msg, collapsed: false };
        const dir = block.path!.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || "/";
        await ipc.fsWriteFile(block.path!, block.content!, dir);
        return { kind: "write_file", path: block.path, content: block.content, collapsed: true };
      }
      case "list_dir": {
        const perm = await checkPermission(
          { action: "fs_read", path: block.path! },
          { title: "Dizin okuma izni", detail: block.path!, scopeDir: scopeDirOf(block.path!, true) },
        );
        if (!perm.ok) return { kind: "list_dir", path: block.path, content: perm.msg, collapsed: false };
        const entries = await ipc.fsReadDir(block.path!, block.path!, 2);
        const tree = entries.map((e) => `${e.isDir ? "📁" : "📄"} ${e.name}`).join("\n");
        return { kind: "list_dir", path: block.path, content: tree || "(boş dizin)", collapsed: true };
      }
      case "create_dir": {
        const perm = await checkPermission(
          { action: "fs_write", path: block.path! },
          { title: "Dizin oluşturma izni", detail: block.path!, scopeDir: scopeDirOf(block.path!, true) },
        );
        if (!perm.ok) return { kind: "create_dir", path: block.path, content: perm.msg, collapsed: false };
        await ipc.fsCreateDir(block.path!, block.path!);
        return { kind: "create_dir", path: block.path, content: `Dizin oluşturuldu: ${block.path}`, collapsed: true };
      }
      case "run_command": {
        const perm = await checkPermission(
          { action: "shell_execute", command: block.command! },
          { title: "Komut çalıştırma izni", detail: block.command! },
        );
        if (!perm.ok) return { kind: "run_command", command: block.command, content: perm.msg, collapsed: false };
        const output = await ipc.shellExec(block.command!);
        return {
          kind: "run_command",
          command: block.command,
          content: output.stdout + (output.stderr ? "\n" + output.stderr : ""),
          exitCode: output.exitCode,
          collapsed: false,
        };
      }
      case "web_search": {
        const perm = await checkPermission(
          { action: "network_outbound", host: "search" },
          { title: "Web araması izni", detail: block.query! },
        );
        if (!perm.ok) return { kind: "web_search", command: block.query, content: perm.msg, collapsed: false };
        const results = await ipc.webSearch(block.query!, 5);
        const formatted = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
        return { kind: "web_search", command: block.query, content: formatted || "Sonuç bulunamadı.", collapsed: true };
      }
      case "weather": {
        const perm = await checkPermission(
          { action: "network_outbound", host: "weather" },
          { title: "Hava durumu sorgusu izni", detail: block.city || "Istanbul" },
        );
        if (!perm.ok) return { kind: "weather", command: block.city, content: perm.msg, collapsed: false };
        const data = await ipc.weatherFetch(block.city || "Istanbul");
        const summary = `${data.city}: ${Math.round(data.tempC)}°C (hissedilen ${Math.round(data.feelsLikeC)}°C), ${data.description}, nem %${data.humidity}, rüzgar ${Math.round(data.windKph)} km/s`;
        return { kind: "weather", command: block.city, content: summary, collapsed: true, cardType: "weather", cardData: data };
      }
      case "currency": {
        const perm = await checkPermission(
          { action: "network_outbound", host: "currency" },
          { title: "Döviz kuru sorgusu izni", detail: "exchangerate API" },
        );
        if (!perm.ok) return { kind: "currency", content: perm.msg, collapsed: false };
        const data = await ipc.currencyFetch();
        const summary = data.rates
          .map((r) => `${r.code}: ${r.rate} TRY`)
          .join("\n");
        return { kind: "currency", content: summary || "Kur verisi alınamadı.", collapsed: true, cardType: "currency", cardData: data };
      }
      case "app_tool": {
        if (!block.appId || !block.appToolName) {
          return { kind: "app_tool", command: "?", content: "Hata: app ve tool parametreleri gerekli.", collapsed: false };
        }
        const result = await executeAppTool(block.appId, block.appToolName, block.appParams || {});
        return { kind: "app_tool", command: `${block.appId}/${block.appToolName}`, content: result, collapsed: false };
      }
      case "get_settings": {
        const s = await ipc.settingsGet();
        const summary = [
          `theme: ${s.theme}`,
          `fontSize: ${s.fontSize}px`,
          `fontFamily: ${s.fontFamily}`,
          `launchAtStartup: ${s.launchAtStartup}`,
        ].join("\n");
        return { kind: "get_settings", content: summary, collapsed: false };
      }
      case "change_setting": {
        const key = block.settingKey!;
        const rawValue = block.settingValue!;
        const allowed = ["theme", "fontSize", "fontFamily", "launchAtStartup"];
        if (!allowed.includes(key)) {
          return { kind: "change_setting", command: `${key}=${rawValue}`, content: `Hata: '${key}' bilinmeyen veya değiştirilemez ayar. İzin verilenler: ${allowed.join(", ")}`, collapsed: false };
        }
        let parsed: string | number | boolean = rawValue;
        if (key === "fontSize") parsed = parseInt(rawValue, 10);
        if (key === "launchAtStartup") parsed = rawValue === "true";
        await useSettingsStore.getState().update({ [key]: parsed } as Partial<import("../types").AppSettings>);
        return { kind: "change_setting", command: `${key} → ${rawValue}`, content: `Ayar değiştirildi.`, collapsed: true };
      }
      case "create_task": {
        const chatId = useChatStore.getState().activeChatId;
        useTaskStore.getState().addTask(block.taskTitle!, block.taskDescription || "", "agent", chatId ?? undefined);
        if (block.taskPriority) {
          const newest = useTaskStore.getState().tasks[0];
          if (newest) useTaskStore.getState().updateTask(newest.id, { priority: block.taskPriority });
        }
        const created = useTaskStore.getState().tasks[0];
        return { kind: "create_task", content: `Görev oluşturuldu: "${block.taskTitle}" (ID: ${created?.id})`, collapsed: true };
      }
      case "list_tasks": {
        const allTasks = useTaskStore.getState().tasks;
        const filtered = block.taskStatus
          ? allTasks.filter(t => t.status === block.taskStatus)
          : allTasks;
        if (filtered.length === 0) {
          return { kind: "list_tasks", content: "Görev bulunamadı.", collapsed: true };
        }
        const list = filtered.map(t =>
          `- [${t.status}] ${t.title}${t.priority ? ` (${t.priority})` : ""} (ID: ${t.id})${t.description ? ` — ${t.description}` : ""}`
        ).join("\n");
        return { kind: "list_tasks", content: `${filtered.length} görev:\n${list}`, collapsed: true };
      }
      case "update_task": {
        const store = useTaskStore.getState();
        const existing = store.tasks.find(t => t.id === block.taskId);
        if (!existing) return { kind: "update_task", content: `Hata: "${block.taskId}" ID'li görev bulunamadı.`, collapsed: false };
        const patch: Partial<{ title: string; description: string; status: TaskStatus; priority: "low" | "medium" | "high" }> = {};
        if (block.taskTitle) patch.title = block.taskTitle;
        if (block.taskDescription) patch.description = block.taskDescription;
        if (block.taskStatus) patch.status = block.taskStatus as TaskStatus;
        if (block.taskPriority) patch.priority = block.taskPriority;
        store.updateTask(block.taskId!, patch);
        return { kind: "update_task", content: `Görev güncellendi: "${existing.title}"`, collapsed: true };
      }
      case "complete_task": {
        const store = useTaskStore.getState();
        const existing = store.tasks.find(t => t.id === block.taskId);
        if (!existing) return { kind: "complete_task", content: `Hata: "${block.taskId}" ID'li görev bulunamadı.`, collapsed: false };
        store.moveTask(block.taskId!, "completed");
        return { kind: "complete_task", content: `Görev tamamlandı: "${existing.title}"`, collapsed: true };
      }
      case "delete_task": {
        const store = useTaskStore.getState();
        const existing = store.tasks.find(t => t.id === block.taskId);
        if (!existing) return { kind: "delete_task", content: `Hata: "${block.taskId}" ID'li görev bulunamadı.`, collapsed: false };
        store.deleteTask(block.taskId!);
        return { kind: "delete_task", content: `Görev silindi: "${existing.title}"`, collapsed: true };
      }
      case "schedule_task": {
        // Zaman çözümle: önce `at` (mutlak), sonra `delay` (göreli).
        let scheduledAt: number | null = null;
        if (block.scheduleAt) {
          scheduledAt = parseAtTime(block.scheduleAt);
        } else if (block.scheduleDelay) {
          const delayMs = parseDelay(block.scheduleDelay);
          if (delayMs) scheduledAt = Date.now() + delayMs;
        }
        if (!scheduledAt) {
          return {
            kind: "schedule_task",
            content: `Hata: Geçersiz zaman. "delay" veya "at" girilmeli (örn. delay: 5m, at: 09:00).`,
            collapsed: false,
          };
        }
        const rawAction = (block.scheduleAction || "timer").toLowerCase();
        const actionType =
          rawAction === "reminder" || rawAction === "alarm" || rawAction === "agent"
            ? (rawAction as "reminder" | "alarm" | "agent")
            : ("timer" as const);
        const recurring =
          block.scheduleRecurring === "daily" || block.scheduleRecurring === "weekly"
            ? (block.scheduleRecurring as "daily" | "weekly")
            : ("once" as const);
        const chatId = useChatStore.getState().activeChatId;
        const id = useTaskStore.getState().scheduleTask({
          title: block.taskTitle!,
          actionType,
          actionMessage: block.scheduleMessage,
          agentPrompt: block.schedulePrompt,
          recurring,
          scheduledAt,
          source: "agent",
          chatId: chatId ?? undefined,
        });
        const whenLabel = formatScheduleLabel(scheduledAt);
        const typeLabel =
          actionType === "agent"
            ? `Agent görevi (${recurring === "once" ? "tek sefer" : recurring === "daily" ? "her gün" : "her hafta"})`
            : "Zamanlayıcı";
        return {
          kind: "schedule_task",
          content: `${typeLabel} kuruldu: "${block.taskTitle}" — ${whenLabel} (ID: ${id})`,
          collapsed: true,
        };
      }
    }
  } catch (e) {
    return { kind: block.kind, path: block.path, command: block.command ?? block.query, content: `Hata: ${String(e)}`, collapsed: false };
  }
}

export function buildToolResultText(actions: ToolAction[]): string {
  return actions.map((a) => {
    switch (a.kind) {
      case "read_file": return `Dosya okundu (${a.path}):\n\`\`\`\n${a.content}\n\`\`\``;
      case "write_file": return `Dosya yazıldı: ${a.path}`;
      case "run_command": return `Komut çalıştırıldı: ${a.command}\nÇıkış kodu: ${a.exitCode}\nÇıktı:\n\`\`\`\n${a.content}\n\`\`\``;
      case "list_dir": return `Dizin listelendi (${a.path}):\n${a.content}`;
      case "create_dir": return `Dizin oluşturuldu: ${a.path}`;
      case "web_search": return `Web araması yapıldı (${a.command}):\n${a.content}`;
      case "weather": return `Hava durumu alındı:\n${a.content}`;
      case "currency": return `Döviz kurları alındı (TRY bazında):\n${a.content}`;
      case "app_tool": return `Uygulama aracı: ${a.command}\n${a.content}`;
      case "get_settings": return `Mevcut uygulama ayarları:\n${a.content}`;
      case "change_setting": return `Ayar değiştirildi (${a.command}): ${a.content}`;
      case "create_task": return `Görev oluşturuldu:\n${a.content}`;
      case "list_tasks": return `Görev listesi:\n${a.content}`;
      case "update_task": return `Görev güncellendi:\n${a.content}`;
      case "complete_task": return `Görev tamamlandı:\n${a.content}`;
      case "delete_task": return `Görev silindi:\n${a.content}`;
      case "schedule_task": return `Zamanlayıcı kuruldu:\n${a.content}`;
      default: return `${a.kind}: ${a.content}`;
    }
  }).join("\n\n");
}

// ---- Store types ----

export interface ContextUsage {
  used: number;
  total: number;
}

const TR_CITIES = [
  "Adana","Adıyaman","Afyon","Ağrı","Aksaray","Amasya","Ankara","Antalya","Ardahan",
  "Artvin","Aydın","Balıkesir","Bartın","Batman","Bayburt","Bilecik","Bingöl","Bitlis",
  "Bolu","Burdur","Bursa","Çanakkale","Çankırı","Çorum","Denizli","Diyarbakır","Düzce",
  "Edirne","Elazığ","Erzincan","Erzurum","Eskişehir","Gaziantep","Giresun","Gümüşhane",
  "Hakkari","Hatay","Iğdır","Isparta","İstanbul","İzmir","Kahramanmaraş","Karabük",
  "Karaman","Kars","Kastamonu","Kayseri","Kırıkkale","Kırklareli","Kırşehir","Kilis",
  "Kocaeli","Konya","Kütahya","Malatya","Manisa","Mardin","Mersin","Muğla","Muş",
  "Nevşehir","Niğde","Ordu","Osmaniye","Rize","Sakarya","Samsun","Siirt","Sinop",
  "Sivas","Şanlıurfa","Şırnak","Tekirdağ","Tokat","Trabzon","Tunceli","Uşak","Van",
  "Yalova","Yozgat","Zonguldak",
];

function extractTurkishCity(text: string): string | null {
  const normalized = text.replace(/[''`]/g, "'");
  for (const city of TR_CITIES) {
    const pattern = new RegExp(`\\b${city}(?:'?(?:da|de|ta|te|dan|den|tan|ten|a|e|ya|ye|ın|in|un|ün|nın|nin|nun|nün|ı|i|u|ü|daki|deki|taki|teki|lı|li|lu|lü))?\\b`, "i");
    if (pattern.test(normalized)) return city;
  }
  return null;
}

interface ChatState {
  chats: Chat[];
  activeChatId: string | null;
  thinking: boolean;
  thinkingStatus: string;
  toolUseEnabled: boolean;
  chatMode: ChatMode;
  contextUsage: ContextUsage;
  /** SQLite'tan yükleme tamamlandı mı (App açılışında beklenir). */
  hydrated: boolean;

  activeChat: () => Chat | undefined;
  /** Açılışta: gerekirse localStorage'dan göç eder, sohbetleri SQLite'tan yükler. */
  loadFromDb: () => Promise<void>;
  newChat: () => void;
  /** Aktif sohbete asistan rolünde bir mesaj ekle (gönderim olmadan). */
  injectAssistantMessage: (text: string, title?: string) => void;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  toggleToolCollapse: (chatId: string, msgId: string, actionIdx: number) => void;
  setToolUseEnabled: (v: boolean) => void;
  setChatMode: (mode: ChatMode) => void;
  send: (text: string, opts?: { skipUserMessage?: boolean }) => Promise<void>;
  stopGeneration: () => void;
  compactChat: () => Promise<void>;
  editMessage: (chatId: string, msgId: string, newText: string) => Promise<void>;
  deleteMessage: (chatId: string, msgId: string) => void;
  /** Agent mesajını yeniden üretir; eski cevap sürüm arşivine düşer. */
  regenerateMessage: (chatId: string, msgId: string) => Promise<void>;
  /** Sürümler arasında geçiş (dir: -1 önceki, +1 sonraki). */
  switchMessageVersion: (chatId: string, msgId: string, dir: 1 | -1) => void;
}

let streamUnlisten: UnlistenFn | null = null;
let stopRequested = false;
let currentStreamResolve: (() => void) | null = null;

/** Aktif regenerate işleminin taşıdığı eski sürüm arşivi. send() bitişinde
    yeni üretilen agent mesajına iliştirilir ve temizlenir. */
let regenerateStash: MessageVersion[] | null = null;

function generateTitle(chat: Chat) {
  const firstUser = chat.messages.find((m) => m.role === "user");
  if (!firstUser) return;
  const active = useModelStore.getState().models.find((m) => m.isActive);
  if (!active) return;

  const prompt = `Aşağıdaki mesaj için 3-5 kelimelik kısa bir sohbet başlığı üret. SADECE başlığı yaz — başka hiçbir metin yazma, tırnak veya noktalama işareti koyma.

"${firstUser.text.slice(0, 300)}"`;

  ipc
    .modelsChat({
      modelId: active.id,
      provider: active.provider,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 30,
    })
    .then((resp) => {
      const title = resp.content
        .split("\n")[0]
        .replace(/^(title\s*:\s*|başlık\s*:\s*)/i, "")
        .replace(/^["'`*]+|["'`*]+$/g, "")
        .trim();
      if (title && title.length > 0 && title.length < 60) {
        useChatStore.getState().renameChat(chat.id, title);
      }
    })
    .catch(() => {});
}

/**
 * Kaydedilen son sohbet nesneleri (referans karşılaştırması). Zustand her
 * mutasyonda yeni nesne ürettiği için "referans aynıysa değişmemiştir"
 * güvenli — gereksiz DB yazımlarını eler.
 */
const lastPersisted = new Map<string, Chat>();

function persistChatObj(chat: Chat) {
  if (lastPersisted.get(chat.id) === chat) return;
  lastPersisted.set(chat.id, chat);
  void chatDb.saveChat(chat);
}

/** Sohbetin güncel halini SQLite'a yaz (fire-and-forget; hatalar loglanır). */
function persistById(chatId: string | null | undefined) {
  if (!chatId) return;
  const chat = useChatStore.getState().chats.find((c) => c.id === chatId);
  if (chat) persistChatObj(chat);
}

/**
 * Sohbetin resimlerini DB'den store'a doldur. Mesajlar diskte resimsiz
 * (imageCount ile) durur; resim verisi sohbete geçildiğinde bir kez yüklenir.
 */
async function hydrateImages(chatId: string) {
  const chat = useChatStore.getState().chats.find((c) => c.id === chatId);
  if (!chat) return;
  if (!chat.messages.some((m) => m.imageCount && !m.images?.length)) return;
  const map = await chatDb.loadChatImages(chatId);
  if (Object.keys(map).length === 0) return;
  useChatStore.setState((s) => ({
    chats: s.chats.map((c) =>
      c.id === chatId
        ? {
            ...c,
            messages: c.messages.map((m) =>
              map[m.id] ? { ...m, images: map[m.id] } : m,
            ),
          }
        : c,
    ),
  }));
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeChatId: null,
      thinking: false,
      thinkingStatus: "",
      toolUseEnabled: true,
      chatMode: "balanced" as ChatMode,
      contextUsage: { used: 0, total: 4096 },
      hydrated: false,

      activeChat: () => {
        const { chats, activeChatId } = get();
        return chats.find((c) => c.id === activeChatId);
      },

      loadFromDb: async () => {
        const chats = await chatDb.loadAllChats();
        // Yeni yüklenenler zaten diskte — açılışta geri yazılmasınlar
        for (const c of chats) lastPersisted.set(c.id, c);
        set({ chats, activeChatId: chats[0]?.id ?? null, hydrated: true });
        // Açılış her zaman boş bir sohbette başlar (eski onRehydrate davranışı):
        // ilk sohbet boşsa onu kullan, doluysa yeni oluştur.
        get().newChat();
        const activeId = get().activeChatId;
        if (activeId) void hydrateImages(activeId);
      },

      newChat: () => {
        const { chats } = get();
        const first = chats[0];
        if (first && first.messages.length === 0) {
          set({ activeChatId: first.id, thinking: false });
          return;
        }
        const id = crypto.randomUUID();
        const chat: Chat = {
          id,
          title: "Yeni Sohbet",
          messages: [],
          createdAt: Date.now(),
        };
        set((s) => ({
          chats: [chat, ...s.chats],
          activeChatId: id,
          thinking: false,
        }));
        void chatDb.saveChat(chat);
        if (streamUnlisten) {
          streamUnlisten();
          streamUnlisten = null;
        }
      },

      injectAssistantMessage: (text, title) => {
        const { activeChatId } = get();
        if (!activeChatId) return;
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "agent",
          text,
        };
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === activeChatId
              ? {
                  ...c,
                  title: title && c.title === "Yeni Sohbet" ? title : c.title,
                  messages: [...c.messages, msg],
                }
              : c,
          ),
        }));
        persistById(activeChatId);
      },

      switchChat: (id) => {
        if (streamUnlisten) {
          streamUnlisten();
          streamUnlisten = null;
        }
        set({ activeChatId: id, thinking: false });
        void hydrateImages(id);
      },

      deleteChat: (id) => {
        set((s) => {
          const remaining = s.chats.filter((c) => c.id !== id);
          const needSwitch = s.activeChatId === id;
          return {
            chats: remaining,
            activeChatId: needSwitch
              ? remaining[0]?.id ?? null
              : s.activeChatId,
          };
        });
        // Sohbet silinince kalıcı kopya, FTS ve bellek kayıtları da temizlenir.
        void chatDb.deleteChat(id);
        void ipc.chatHistoryClear(id).catch(() => {});
        void ipc.memoryClearChat(id).catch(() => {});
      },

      renameChat: (id, title) => {
        set((s) => ({
          chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)),
        }));
        persistById(id);
      },

      toggleToolCollapse: (chatId, msgId, actionIdx) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId
                      ? {
                          ...m,
                          toolActions: m.toolActions?.map((a, i) =>
                            i === actionIdx ? { ...a, collapsed: !a.collapsed } : a
                          ),
                        }
                      : m
                  ),
                }
              : c
          ),
        }));
      },

      setToolUseEnabled: (v) => set({ toolUseEnabled: v }),
      setChatMode: (mode) => set({ chatMode: mode }),

      stopGeneration: () => {
        stopRequested = true;
        regenerateStash = null;
        // Bekleyen tool onay kartları varsa reddet — döngü onları beklemesin
        useApprovalStore.getState().denyAll();
        if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
        // Bekleyen stream promise'ini çöz ki send döngüsü askıda kalmasın
        if (currentStreamResolve) { currentStreamResolve(); currentStreamResolve = null; }
        set({ thinking: false, thinkingStatus: "" });
      },

      send: async (text, opts = {}) => {
        stopRequested = false;
        // Normal gönderim, yarım kalmış bir regenerate arşivini devralmasın
        if (!opts.skipUserMessage) regenerateStash = null;
        let { activeChatId } = get();

        if (!activeChatId) {
          get().newChat();
          activeChatId = get().activeChatId!;
        }

        // Grab images synchronously before any await — caller clears docs right after calling send()
        const snapshotDocs = useDocumentStore.getState().getDocumentsForChat(activeChatId);
        const snapshotImages = snapshotDocs
          .filter((d) => !!d.base64Data)
          .map((d) => d.base64Data!);

        const summaryMatch = text.match(/^\/(summary|özet|compact)\s*$/i);
        if (summaryMatch) {
          await get().compactChat();
          return;
        }

        const appCommand = matchAppCommand(text);

        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text,
          ...(snapshotImages.length > 0 ? { images: snapshotImages } : {}),
        };

        // Regenerate akışı kullanıcı mesajını YENİDEN eklemez — mevcut soru
        // için yalnızca yeni bir cevap üretilir.
        if (!opts.skipUserMessage) {
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? { ...c, messages: [...c.messages, userMsg] }
                : c
            ),
            thinking: true,
            thinkingStatus: "Düşünüyor...",
          }));
          // Kullanıcı mesajını (resimleriyle) hemen kalıcılaştır — üretim
          // sırasında uygulama kapanırsa mesaj kaybolmasın.
          persistById(activeChatId);
        } else {
          set({ thinking: true, thinkingStatus: "Yeniden oluşturuluyor..." });
        }

        // App command: /github, /telegram vb. → check early
        if (appCommand) {
          const appData = useAppStore.getState().apps.find((a) => a.id === appCommand.appId);
          let appError: string | null = null;
          if (!appData) {
            appError = `${appCommand.appId} uygulaması bulunamadı.`;
          } else if (!appData.enabled) {
            appError = `${appData.name} entegrasyonu etkin değil. Uygulamalar sekmesinden etkinleştir ve yapılandır.`;
          } else if (appData.tools.length === 0) {
            appError = `${appData.name} için henüz araç tanımlı değil.`;
          } else if (Object.keys(appData.config).length === 0) {
            appError = `${appData.name} yapılandırılmamış. Uygulamalar sekmesinden API anahtarını veya token'ı gir.`;
          }
          if (appError) {
            const errMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: "agent",
              text: appError,
            };
            set((s) => ({
              chats: s.chats.map((c) =>
                c.id === activeChatId
                  ? { ...c, messages: [...c.messages, errMsg] }
                  : c
              ),
              thinking: false,
            }));
            return;
          }
        }

        const modelStore = useModelStore.getState();
        const active = modelStore.models.find((m) => m.isActive);

        if (!active) {
          const errMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "agent",
            text: "Aktif model seçilmedi. Modeller sekmesinden bir model seç.",
          };
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? { ...c, messages: [...c.messages, errMsg] }
                : c
            ),
            thinking: false,
          }));
          return;
        }

        // Resim var ama model görsel (vision) desteklemiyorsa → halüsinasyonu önle, kullanıcıyı uyar
        const hasVisionCap = modelSupportsVision(active);
        if (snapshotImages.length > 0 && !hasVisionCap) {
          const warnMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "agent",
            text:
              `**${active.displayName || active.id}** modeli görselleri okuyamıyor (vision desteği yok), bu yüzden resmin içeriğini göremem.\n\n` +
              `Resim analizi için görsel destekli bir modele geç — örn. **llava**, **llama3.2-vision**, **gemma3** (vision varyantı), **qwen2.5-vl** veya bir cloud model (Gemini, GPT-4o).`,
          };
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? { ...c, messages: [...c.messages, warnMsg] }
                : c
            ),
            thinking: false,
            thinkingStatus: "",
          }));
          return;
        }

        // App command ise → focused app prompt, tool-use zorla açık
        const forceToolUse = !!appCommand;
        const { toolUseEnabled } = get();
        const hasToolCap = modelSupportsTools(active);
        const effectiveToolUse = hasToolCap && (toolUseEnabled || forceToolUse);

        const chat = get().chats.find((c) => c.id === activeChatId)!;
        const conversationHistory: IpcChatMessage[] = [];

        if (chat.compactedSummary) {
          conversationHistory.push({
            role: "system",
            content: `[Önceki konuşma özeti]\n${chat.compactedSummary}`,
          });
        }

        const userAssistantMsgs = chat.messages
          .filter((m) => m.role !== "search" && m.role !== "card")
          .map((m) => ({
            role: m.role === "agent" ? "assistant" : "user",
            content: m.text,
          }));
        conversationHistory.push(...userAssistantMsgs);

        if (snapshotImages.length > 0) {
          const lastUserMsg = [...conversationHistory].reverse().find((m) => m.role === "user");
          if (lastUserMsg) {
            lastUserMsg.images = snapshotImages;
            console.log(`[Axiom] ${snapshotImages.length} resim eklendi (${snapshotImages.map(i => Math.round(i.length/1024) + "KB").join(", ")})`);
          }
        }

        if (appCommand) {
          const appPrompt = buildAppCommandPrompt(appCommand.appId, appCommand.query);
          if (appPrompt) {
            conversationHistory.unshift({ role: "system", content: appPrompt });
          }
        } else {
          const systemPrompt = buildSystemPrompt(activeChatId, effectiveToolUse, snapshotDocs);
          if (systemPrompt) {
            conversationHistory.unshift({ role: "system", content: systemPrompt });
          }
        }

        // ---- Memory recall ----------------------------------------------------
        // Look up semantically related prior turns and inject them as a system
        // hint *before* fitContext trims. We swallow errors so a missing
        // embedding model doesn't break the chat.
        const memoryCfg = useSettingsStore.getState().settings?.memory;
        if (memoryCfg?.enabled && !appCommand && text.trim().length > 0) {
          try {
            const hits = await ipc.memoryRecall({
              query: text,
              embeddingModel: memoryCfg.embeddingModel,
              topK: memoryCfg.topK,
              excludeChatId: memoryCfg.crossChat ? activeChatId : undefined,
              onlyChatId: memoryCfg.crossChat ? undefined : activeChatId,
            });
            const filtered = hits.filter((h) => h.score >= memoryCfg.scoreThreshold);
            if (filtered.length > 0) {
              const lines = filtered
                .map((h, i) => {
                  const when = new Date(h.createdAt).toLocaleDateString("tr-TR");
                  const who = h.role === "user" ? "Kullanıcı" : "Sen";
                  return `${i + 1}. [${when} · ${who}] ${h.text.slice(0, 280)}`;
                })
                .join("\n");
              conversationHistory.unshift({
                role: "system",
                content:
                  "[ANI] Geçmiş konuşmalardan kullanıcıyla ilgili hatırlanan bilgiler. " +
                  "Sadece alakalıysa kullan, alaka yoksa görmezden gel.\n" +
                  lines,
              });
            }
          } catch (e) {
            console.warn("memory recall failed:", e);
          }
        }
        // ----------------------------------------------------------------------

        // Context kırpma — uzun konuşmalarda eski mesajları düşür
        const optConfig = useOptimizationStore.getState().config;
        const ctxResult = fitContext(conversationHistory, optConfig);
        conversationHistory.splice(0, conversationHistory.length, ...ctxResult.messages);

        const maxCtx = optConfig?.numCtx ?? 4096;
        set({ contextUsage: { used: ctxResult.usedTokens, total: Math.floor(maxCtx * 0.8) } });

        // Tool-use loop — max MAX_TOOL_STEPS adım
        let lastAgentMsgId = "";
        let lastAgentText = "";

        for (let step = 0; step < MAX_TOOL_STEPS; step++) {
          if (stopRequested) break;
          const agentMsgId = crypto.randomUUID();
          lastAgentMsgId = agentMsgId;
          let fullText = "";
          let fullThinking = "";
          const currentMode = get().chatMode;

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      { id: agentMsgId, role: "agent" as const, text: "", toolActions: [] },
                    ],
                  }
                : c
            ),
          }));

          if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }

          const streamId = crypto.randomUUID();
          let streamResolve: (() => void) | null = null;
          const streamDone = new Promise<void>((resolve) => { streamResolve = resolve; });
          currentStreamResolve = streamResolve;
          let lastDoneReason: string | undefined;

          streamUnlisten = await listen<StreamTokenPayload>("chat-token", (event) => {
            if (event.payload.chatId !== streamId) return;
            if (event.payload.done) { lastDoneReason = event.payload.doneReason; streamResolve?.(); return; }
            if (event.payload.thinking) {
              fullThinking += event.payload.thinking;
              set((s) => ({
                thinkingStatus: "",
                chats: s.chats.map((c) =>
                  c.id === activeChatId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === agentMsgId ? { ...m, thinkingContent: fullThinking } : m
                        ),
                      }
                    : c
                ),
              }));
              return;
            }
            fullText += event.payload.token;
            set((s) => ({
              chats: s.chats.map((c) =>
                c.id === activeChatId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === agentMsgId ? { ...m, text: fullText } : m
                      ),
                    }
                  : c
              ),
            }));
          });

          try {
            await ipc.modelsChatStream({
              modelId: active.id,
              provider: active.provider,
              messages: conversationHistory,
              maxTokens: 4096,
              think: currentMode === "thinking" ? true : undefined,
              // Native function calling: model "tools" yeteneğine sahipse
              // yapısal şema gönder (Rust, tool_calls'u blok metnine çevirir;
              // regex fallback yeteneksiz modeller için aynen çalışır).
              tools: effectiveToolUse ? buildNativeTools(active) : undefined,
            }, streamId);
            await streamDone;
            currentStreamResolve = null;
          } catch (e) {
            currentStreamResolve = null;
            if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
            set((s) => ({
              chats: s.chats.map((c) =>
                c.id === activeChatId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === agentMsgId ? { ...m, text: fullText || `Hata: ${String(e)}` } : m
                      ),
                    }
                  : c
              ),
              thinking: false,
            }));
            return;
          }

          if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }

          // Yarım kalan tool bloğunu tamir et
          const unclosedMatch = fullText.match(/```tool:(\w+)\n([\s\S]+?)$/);
          if (unclosedMatch) {
            const afterLast = fullText.lastIndexOf("```tool:");
            const closingAfter = fullText.indexOf("```", afterLast + 8);
            if (closingAfter === -1) {
              fullText = fullText + "\n```";
              set((s) => ({
                chats: s.chats.map((c) =>
                  c.id === activeChatId
                    ? { ...c, messages: c.messages.map((m) => m.id === agentMsgId ? { ...m, text: fullText } : m) }
                    : c
                ),
              }));
            }
          }

          // Yarıda kalan yanıtı tespit et ve devam ettir — sadece token limiti aşıldığında
          const truncatedByLength = lastDoneReason === "length";
          if (step > 0 && truncatedByLength && fullText.length > 20) {
            {
              const prevText = fullText;
              conversationHistory.push({ role: "assistant", content: fullText });
              conversationHistory.push({ role: "user", content: "Yanıtın yarım kaldı. Kaldığın yerden DEVAM ET, baştan başlama, sadece devamını yaz." });
              set({ thinkingStatus: "Devam ediyor..." });

              const contStreamId = crypto.randomUUID();
              let contResolve: (() => void) | null = null;
              const contDone = new Promise<void>((resolve) => { contResolve = resolve; });
              let contText = "";

              const contUnlisten = await listen<StreamTokenPayload>("chat-token", (event) => {
                if (event.payload.chatId !== contStreamId) return;
                if (event.payload.done) { contResolve?.(); return; }
                if (event.payload.thinking) return;
                contText += event.payload.token;
                const merged = prevText + contText;
                set((s) => ({
                  chats: s.chats.map((c) =>
                    c.id === activeChatId
                      ? { ...c, messages: c.messages.map((m) => m.id === agentMsgId ? { ...m, text: merged } : m) }
                      : c
                  ),
                }));
              });

              try {
                await ipc.modelsChatStream({
                  modelId: active.id,
                  provider: active.provider,
                  messages: conversationHistory,
                  maxTokens: 4096,
                }, contStreamId);
                await contDone;
              } catch { /* devam hatası yok say */ }
              contUnlisten();

              fullText = prevText + contText;
            }
          }

          lastAgentText = fullText;

          // Kullanıcı durdurduysa tool çalıştırma, çık
          if (stopRequested) break;

          // Tool-use kapalıysa veya tool blok yoksa bitir
          if (!effectiveToolUse) break;
          let toolBlocks = parseToolBlocks(fullText);

          // Fallback: model tool bloğu yazmadıysa ama KULLANICI mesajı açıkça tool gerektiriyorsa otomatik çağır.
          // Not: yalnızca kullanıcı metnine bakılır (model çıktısına değil) ve kelime sınırı kullanılır —
          // aksi halde "havalı", "havaalanı" gibi kelimeler yanlışlıkla weather tetikler.
          if (toolBlocks.length === 0 && step === 0) {
            const userLower = text.toLowerCase();
            if (/\b(hava durumu|hava nasıl|hava kaç|sıcaklık|kaç derece|weather)\b/.test(userLower)) {
              const city = extractTurkishCity(text) || "Istanbul";
              toolBlocks = [{ kind: "weather", city }];
            } else if (/\b(döviz|kur|euro|dolar|dollar|usd|eur|gbp|sterlin)\b/.test(userLower)) {
              toolBlocks = [{ kind: "currency" }];
            }
          }

          if (toolBlocks.length === 0) break;

          set({ thinkingStatus: `Araçlar çalışıyor (${step + 1}/${MAX_TOOL_STEPS})...` });

          const actions: ToolAction[] = [];
          for (const block of toolBlocks) {
            try {
              // Zaman aşımı onay bekleme süresini de kapsar: onay kartının
              // kendi zaman aşımı 120sn olduğundan buradaki üst sınır onun
              // üzerinde olmalı — yoksa kart ekranda dururken araç "zaman
              // aşımı" ile düşer.
              const action = await Promise.race([
                executeToolBlock(block),
                new Promise<ToolAction>((_, reject) => setTimeout(() => reject(new Error("Araç zaman aşımı")), 150000)),
              ]);
              actions.push(action);
            } catch (e) {
              actions.push({ kind: block.kind, path: block.path, command: block.command ?? block.query, content: `Hata: ${String(e)}`, collapsed: false });
            }
          }

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === agentMsgId ? { ...m, toolActions: actions } : m
                    ),
                  }
                : c
            ),
            thinkingStatus: "Düşünüyor...",
          }));

          conversationHistory.push({ role: "assistant", content: fullText });
          conversationHistory.push({ role: "user", content: "Araç sonuçları:\n" + buildToolResultText(actions) });
        }

        // Regenerate: eski sürüm arşivini yeni üretilen mesaja iliştir
        if (regenerateStash && lastAgentMsgId) {
          const stash = regenerateStash;
          regenerateStash = null;
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === lastAgentMsgId
                        ? {
                            ...m,
                            alternates: [
                              ...stash,
                              { text: m.text, thinkingContent: m.thinkingContent, toolActions: m.toolActions },
                            ],
                            versionIndex: stash.length,
                          }
                        : m
                    ),
                  }
                : c
            ),
          }));
        }
        regenerateStash = null;

        set({ thinking: false });
        void notifyResponseComplete(lastAgentText?.slice(0, 100));

        // Başlık oluştur ve profil güncelle
        const doneChat = get().chats.find((c) => c.id === activeChatId);
        if (doneChat && doneChat.title === "Yeni Sohbet") generateTitle(doneChat);
        if (lastAgentText) {
          useUserProfileStore.getState().extractFromTurn(text, lastAgentText).catch(() => {});
        }

        // ---- Memory store (background, fire-and-forget) -----------------------
        // Embed user input + final assistant reply so they're recallable later.
        // Errors are silenced — a missing embedding model shouldn't poison UX.
        const memCfgStore = useSettingsStore.getState().settings?.memory;
        if (memCfgStore?.enabled && activeChatId) {
          // Regenerate'te kullanıcı mesajı zaten ilk gönderimde kaydedildi
          if (!opts.skipUserMessage) {
            void ipc
              .memoryStore({
                chatId: activeChatId,
                messageId: userMsg.id,
                role: "user",
                text,
                embeddingModel: memCfgStore.embeddingModel,
              })
              .catch((e) => console.warn("memory store user failed:", e));
          }
          if (lastAgentText && lastAgentMsgId) {
            void ipc
              .memoryStore({
                chatId: activeChatId,
                messageId: lastAgentMsgId,
                role: "assistant",
                text: lastAgentText,
                embeddingModel: memCfgStore.embeddingModel,
              })
              .catch((e) => console.warn("memory store assistant failed:", e));
          }
        }
        // ----------------------------------------------------------------------

        // ---- Auto-TTS: settings.tts.autoSpeak ON ise son yanıtı seslendir -----
        const ttsCfg = useSettingsStore.getState().settings?.tts;
        if (
          ttsCfg?.enabled &&
          ttsCfg.autoSpeak &&
          lastAgentText &&
          typeof window !== "undefined" &&
          "speechSynthesis" in window
        ) {
          // Dinamik import — TTS yardımcısı küçük, ama chat store'u sade tutmak için ayrı.
          import("../hooks/useTTS")
            .then(({ speakOnce }) => speakOnce(lastAgentText, { voice: ttsCfg.voice, rate: ttsCfg.rate }))
            .catch(() => {});
        }
        // ----------------------------------------------------------------------

        // ---- FTS index (independent of memory feature) ------------------------
        if (activeChatId) {
          const indexedChat = get().chats.find((c) => c.id === activeChatId);
          const chatTitle = indexedChat?.title ?? null;
          if (!opts.skipUserMessage) {
            void ipc
              .chatHistoryIndex({
                chatId: activeChatId,
                chatTitle,
                messageId: userMsg.id,
                role: "user",
                text,
              })
              .catch((e) => console.warn("chat history index user failed:", e));
          }
          if (lastAgentText && lastAgentMsgId) {
            void ipc
              .chatHistoryIndex({
                chatId: activeChatId,
                chatTitle,
                messageId: lastAgentMsgId,
                role: "assistant",
                text: lastAgentText,
              })
              .catch((e) => console.warn("chat history index assistant failed:", e));
          }
        }
        // ----------------------------------------------------------------------

        // Auto-compact: context %80'i aşınca otomatik sıkıştır
        const usage = get().contextUsage;
        if (usage.total > 0 && usage.used / usage.total > 0.8) {
          get().compactChat().catch(() => {});
        }

        void lastAgentMsgId;
      },

      compactChat: async () => {
        const { activeChatId } = get();
        if (!activeChatId) return;

        const chat = get().chats.find((c) => c.id === activeChatId);
        if (!chat || chat.messages.length < 4) return;

        const modelStore = useModelStore.getState();
        const active = modelStore.models.find((m) => m.isActive);
        if (!active) return;

        set({ thinking: true, thinkingStatus: "Konuşma sıkıştırılıyor..." });

        const transcript = chat.messages
          .filter((m) => m.role === "user" || m.role === "agent")
          .map((m) => `${m.role === "user" ? "Kullanıcı" : "Asistan"}: ${m.text.slice(0, 500)}`)
          .join("\n\n");

        const summaryPrompt: IpcChatMessage[] = [
          {
            role: "system",
            content: "Verilen konuşmayı kısa ve öz bir şekilde özetle. Önemli konuları, kararları ve sonuçları içer. Özet Türkçe olsun. Sadece özeti yaz, başka bir şey ekleme.",
          },
          {
            role: "user",
            content: `Şu konuşmayı özetle:\n\n${transcript.slice(0, 6000)}`,
          },
        ];

        try {
          const resp = await ipc.modelsChat({
            modelId: active.id,
            provider: active.provider,
            messages: summaryPrompt,
            temperature: 0.3,
            maxTokens: 1024,
          });

          const summaryText = resp.content.trim();

          const compactNotice: ChatMessage = {
            id: crypto.randomUUID(),
            role: "agent",
            text: "Konuşma sıkıştırıldı — önceki bağlam özetlendi.",
          };

          const recentMessages = chat.messages.slice(-4);

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? { ...c, compactedSummary: summaryText, messages: [compactNotice, ...recentMessages] }
                : c
            ),
            thinking: false,
          }));
          persistById(activeChatId);
        } catch (e) {
          const errMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "agent",
            text: `Sıkıştırma hatası: ${String(e)}`,
          };
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === activeChatId
                ? { ...c, messages: [...c.messages, errMsg] }
                : c
            ),
            thinking: false,
          }));
          persistById(activeChatId);
        }
      },

      editMessage: async (chatId, msgId, newText) => {
        const chat = get().chats.find((c) => c.id === chatId);
        if (!chat) return;
        const msgIndex = chat.messages.findIndex((m) => m.id === msgId);
        if (msgIndex === -1) return;

        set((s) => ({
          activeChatId: chatId,
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.slice(0, msgIndex) }
              : c
          ),
        }));
        persistById(chatId);

        await get().send(newText);
      },

      deleteMessage: (chatId, msgId) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) }
              : c
          ),
        }));
        persistById(chatId);
      },

      regenerateMessage: async (chatId, msgId) => {
        if (get().thinking) return;
        const chat = get().chats.find((c) => c.id === chatId);
        if (!chat) return;
        const idx = chat.messages.findIndex((m) => m.id === msgId);
        if (idx === -1 || chat.messages[idx].role !== "agent") return;

        // Bu cevabı üreten kullanıcı mesajını bul (geriye doğru ilk user)
        const userMsg = [...chat.messages.slice(0, idx)]
          .reverse()
          .find((m) => m.role === "user");
        if (!userMsg) return;

        const target = chat.messages[idx];
        // Mevcut sürümleri arşive al: alternates zaten varsa görüntülenen
        // sürüm dahil hepsi korunur; yoksa tek sürüm mevcut cevaptır.
        regenerateStash = target.alternates?.length
          ? target.alternates
          : [{ text: target.text, thinkingContent: target.thinkingContent, toolActions: target.toolActions }];

        // Hedef agent mesajını (ve varsa sonrasını) kaldır — send yeni mesaj üretir
        set((s) => ({
          activeChatId: chatId,
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, messages: c.messages.slice(0, idx) } : c
          ),
        }));

        await get().send(userMsg.text, { skipUserMessage: true });
      },

      switchMessageVersion: (chatId, msgId, dir) => {
        set((s) => ({
          chats: s.chats.map((c) => {
            if (c.id !== chatId) return c;
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id !== msgId || !m.alternates?.length) return m;
                const cur = m.versionIndex ?? m.alternates.length - 1;
                const next = Math.max(0, Math.min(m.alternates.length - 1, cur + dir));
                if (next === cur) return m;
                const v = m.alternates[next];
                return {
                  ...m,
                  text: v.text,
                  thinkingContent: v.thinkingContent,
                  toolActions: v.toolActions,
                  versionIndex: next,
                };
              }),
            };
          }),
        }));
        persistById(chatId);
      },

    }),
    {
      // Sohbet verisi artık SQLite'ta (src/lib/chatDb.ts) — localStorage'da
      // yalnızca küçük UI tercihleri kalır.
      name: "axiom-chat-prefs",
      partialize: (state) =>
        ({
          toolUseEnabled: state.toolUseEnabled,
          chatMode: state.chatMode,
        }) as unknown as ChatState,
    }
  )
);

// Güvenlik ağı: send() içindeki tüm bitiş/hata yollarını tek tek kovalamak
// yerine, üretim bittiğinde (thinking=false) aktif sohbet değiştiyse kaydet.
// Referans karşılaştırması gereksiz yazımı engeller; stream sırasındaki
// token-başına set'ler thinking=true olduğu için elenir.
useChatStore.subscribe((state) => {
  if (state.thinking || !state.hydrated) return;
  const chat = state.chats.find((c) => c.id === state.activeChatId);
  if (chat) persistChatObj(chat);
});
